from __future__ import annotations

import csv
from collections.abc import Callable
from datetime import datetime, timezone
from io import BytesIO, StringIO
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.db import get_session
from app.datajud import DataJudClient, datajud_movements, datajud_subject_names
from app.djen import DjenClient, DjenRateLimitError
from app.importer import DjenImporter, enqueue_search_run
from app.models import (
    Client,
    ClientProcess,
    Communication,
    CommunicationLawyer,
    CommunicationParty,
    Lawyer,
    Process,
    CommunicationRiskMatch,
    RiskKeyword,
    SearchRun,
    WorkerInstance,
)
from app.risk import (
    RISK_LEVEL_ORDER,
    normalize_risk_term,
    reprocess_all_risk_matches,
    risk_keyword_match_counts,
)
from app.schemas import (
    ClientCreate,
    ClientRead,
    CommunicationListItem,
    CommunicationRead,
    DataJudMovementRead,
    DataJudRead,
    LawyerRead,
    PartyRead,
    ProcessDetail,
    ProcessEnrichmentCreate,
    ProcessEnrichmentRead,
    ProcessListItem,
    ProcessPartyRead,
    RiskKeywordCreate,
    RiskKeywordMutationRead,
    RiskKeywordRead,
    RiskKeywordUpdate,
    RiskMatchRead,
    RiskReprocessRead,
    SearchRunCreate,
    SearchRunRead,
    WorkerDashboardRead,
    WorkerRead,
    WorkerRunRead,
    WorkerStartCreate,
    cpf_to_masked,
)
from app.utils import get_first, mask_cpf, normalize_name
from app.worker_control import (
    WORKER_HEARTBEAT_STALE_SECONDS,
    WORKER_STATUS_FAILED,
    WORKER_STATUS_IDLE,
    WORKER_STATUS_STOPPED,
    WORKER_STATUS_WORKING,
    create_worker_instance,
    start_api_worker,
)

router = APIRouter(prefix="/api")


def get_djen_client() -> DjenClient:
    settings = get_settings()
    return DjenClient(settings.djen_base_url)


def get_datajud_client() -> DataJudClient | None:
    settings = get_settings()
    if not settings.datajud_api_key:
        return None
    return DataJudClient(
        settings.datajud_base_url,
        settings.datajud_api_key,
        timeout=settings.datajud_timeout_seconds,
    )


def get_worker_starter() -> Callable[..., None]:
    return start_api_worker


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/workers", response_model=WorkerDashboardRead)
async def list_workers(session: AsyncSession = Depends(get_session)) -> WorkerDashboardRead:
    result = await session.execute(
        select(WorkerInstance)
        .options(selectinload(WorkerInstance.current_run).selectinload(SearchRun.client))
        .order_by(WorkerInstance.created_at.desc(), WorkerInstance.name.asc())
    )
    workers = [_worker_read(worker) for worker in result.scalars().all()]
    queued_runs = await _count_runs_by_status(session, "queued")
    running_runs = await _count_runs_by_status(session, "running")
    failed_runs = await _count_runs_by_status(session, "failed")
    return WorkerDashboardRead(
        workers=workers,
        active_workers=sum(
            1
            for worker in workers
            if worker.effective_status not in {WORKER_STATUS_STOPPED, WORKER_STATUS_FAILED, "stale"}
        ),
        working_workers=sum(1 for worker in workers if worker.effective_status == WORKER_STATUS_WORKING),
        idle_workers=sum(1 for worker in workers if worker.effective_status == WORKER_STATUS_IDLE),
        stale_workers=sum(1 for worker in workers if worker.effective_status == "stale"),
        queued_runs=queued_runs,
        running_runs=running_runs,
        failed_runs=failed_runs,
    )


@router.post("/workers", response_model=WorkerRead, status_code=201)
async def start_worker(
    payload: WorkerStartCreate,
    session: AsyncSession = Depends(get_session),
    worker_starter: Callable[..., None] = Depends(get_worker_starter),
) -> WorkerRead:
    worker = await create_worker_instance(
        session,
        name=payload.name,
        kind="api",
        poll_interval_seconds=payload.poll_interval_seconds,
    )
    worker_starter(
        worker.id,
        max_jobs=payload.max_jobs,
        poll_interval_seconds=payload.poll_interval_seconds,
    )
    return _worker_read(worker)


@router.post("/workers/{worker_id}/stop", response_model=WorkerRead)
async def stop_worker(worker_id: str, session: AsyncSession = Depends(get_session)) -> WorkerRead:
    worker = await _get_worker_for_read(session, worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker nao encontrado")
    worker.stop_requested = True
    if worker.status in {WORKER_STATUS_IDLE, "starting"}:
        worker.status = WORKER_STATUS_STOPPED
        worker.stopped_at = datetime.now(timezone.utc)
        worker.current_run_id = None
    await session.commit()
    refreshed = await _get_worker_for_read(session, worker_id)
    if not refreshed:
        raise HTTPException(status_code=404, detail="Worker nao encontrado")
    return _worker_read(refreshed)


@router.get("/risk-keywords", response_model=list[RiskKeywordRead])
async def list_risk_keywords(session: AsyncSession = Depends(get_session)) -> list[RiskKeywordRead]:
    result = await session.execute(
        select(RiskKeyword).order_by(RiskKeyword.category.asc(), RiskKeyword.term.asc())
    )
    keywords = result.scalars().all()
    counts = await risk_keyword_match_counts(session)
    return [_risk_keyword_read(keyword, counts.get(keyword.id, 0)) for keyword in keywords]


@router.post("/risk-keywords", response_model=RiskKeywordMutationRead, status_code=201)
async def create_risk_keyword(
    payload: RiskKeywordCreate,
    session: AsyncSession = Depends(get_session),
) -> RiskKeywordMutationRead:
    normalized_term = normalize_risk_term(payload.term)
    await _ensure_unique_risk_keyword(session, normalized_term)
    keyword = RiskKeyword(
        term=payload.term,
        normalized_term=normalized_term,
        category=payload.category,
        risk_level=payload.risk_level,
        description=payload.description,
        active=payload.active,
    )
    session.add(keyword)
    await session.flush()
    reprocess = await reprocess_all_risk_matches(session)
    await session.commit()
    await session.refresh(keyword)
    counts = await risk_keyword_match_counts(session)
    return RiskKeywordMutationRead(
        keyword=_risk_keyword_read(keyword, counts.get(keyword.id, 0)),
        reprocess=_risk_reprocess_read(reprocess),
    )


@router.patch("/risk-keywords/{keyword_id}", response_model=RiskKeywordMutationRead)
async def update_risk_keyword(
    keyword_id: str,
    payload: RiskKeywordUpdate,
    session: AsyncSession = Depends(get_session),
) -> RiskKeywordMutationRead:
    keyword = await session.get(RiskKeyword, keyword_id)
    if not keyword:
        raise HTTPException(status_code=404, detail="Palavra de risco nao encontrada")

    fields = payload.model_fields_set
    if "term" in fields and payload.term is not None:
        normalized_term = normalize_risk_term(payload.term)
        await _ensure_unique_risk_keyword(session, normalized_term, keyword_id=keyword.id)
        keyword.term = payload.term
        keyword.normalized_term = normalized_term
    if "category" in fields and payload.category is not None:
        keyword.category = payload.category
    if "risk_level" in fields and payload.risk_level is not None:
        keyword.risk_level = payload.risk_level
    if "description" in fields:
        keyword.description = payload.description
    if "active" in fields and payload.active is not None:
        keyword.active = payload.active

    await session.flush()
    reprocess = await reprocess_all_risk_matches(session)
    await session.commit()
    await session.refresh(keyword)
    counts = await risk_keyword_match_counts(session)
    return RiskKeywordMutationRead(
        keyword=_risk_keyword_read(keyword, counts.get(keyword.id, 0)),
        reprocess=_risk_reprocess_read(reprocess),
    )


@router.delete("/risk-keywords/{keyword_id}", response_model=RiskKeywordMutationRead)
async def delete_risk_keyword(
    keyword_id: str,
    session: AsyncSession = Depends(get_session),
) -> RiskKeywordMutationRead:
    keyword = await session.get(RiskKeyword, keyword_id)
    if not keyword:
        raise HTTPException(status_code=404, detail="Palavra de risco nao encontrada")
    await session.delete(keyword)
    await session.flush()
    reprocess = await reprocess_all_risk_matches(session)
    await session.commit()
    return RiskKeywordMutationRead(keyword=None, reprocess=_risk_reprocess_read(reprocess))


@router.post("/risk-keywords/reprocess", response_model=RiskReprocessRead)
async def reprocess_risk_keywords(session: AsyncSession = Depends(get_session)) -> RiskReprocessRead:
    reprocess = await reprocess_all_risk_matches(session)
    await session.commit()
    return _risk_reprocess_read(reprocess)


@router.post("/clients", response_model=ClientRead, status_code=201)
async def create_client(payload: ClientCreate, session: AsyncSession = Depends(get_session)) -> ClientRead:
    client = Client(name=payload.name, normalized_name=normalize_name(payload.name), cpf=payload.cpf)
    session.add(client)
    await session.commit()
    await session.refresh(client)
    return await _client_read(session, client)


@router.get("/clients", response_model=list[ClientRead])
async def list_clients(session: AsyncSession = Depends(get_session)) -> list[ClientRead]:
    result = await session.execute(select(Client).order_by(Client.created_at.desc(), Client.name.asc()))
    clients = result.scalars().all()
    return [await _client_read(session, client) for client in clients]


@router.post("/clients/{client_id}/search-runs", response_model=SearchRunRead, status_code=201)
async def create_search_run(
    client_id: str,
    payload: SearchRunCreate,
    session: AsyncSession = Depends(get_session),
) -> SearchRunRead:
    client = await session.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Cliente nao encontrado")
    if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
        raise HTTPException(status_code=422, detail="Data inicial deve ser anterior a data final")
    run = await enqueue_search_run(
        session,
        client_id=client_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    return _search_run_read(run)


@router.get("/search-runs/{run_id}", response_model=SearchRunRead)
async def get_search_run(run_id: str, session: AsyncSession = Depends(get_session)) -> SearchRunRead:
    run = await session.get(SearchRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Busca nao encontrada")
    return _search_run_read(run)


@router.get("/processes", response_model=list[ProcessListItem])
async def list_processes(
    client_id: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> list[ProcessListItem]:
    statement = (
        select(Process, ClientProcess)
        .join(ClientProcess, ClientProcess.process_id == Process.id)
        .options(
            selectinload(Process.communications).selectinload(Communication.parties),
            selectinload(Process.communications)
            .selectinload(Communication.risk_matches)
            .selectinload(CommunicationRiskMatch.keyword),
        )
        .order_by(ClientProcess.last_movement_at.desc().nullslast(), Process.numero_processo.asc())
    )
    if client_id:
        statement = statement.where(ClientProcess.client_id == client_id)
    result = await session.execute(statement)
    return [_process_item(process, client_process) for process, client_process in result.all()]


@router.get("/processes/{process_id}", response_model=ProcessDetail)
async def get_process(process_id: str, session: AsyncSession = Depends(get_session)) -> ProcessDetail:
    process = await _get_process_for_detail(session, process_id)
    if not process:
        raise HTTPException(status_code=404, detail="Processo nao encontrado")
    return _process_detail(process)


@router.post("/processes/{process_id}/enrich", response_model=ProcessEnrichmentRead)
async def enrich_process(
    process_id: str,
    payload: ProcessEnrichmentCreate,
    session: AsyncSession = Depends(get_session),
    djen_client: DjenClient = Depends(get_djen_client),
    datajud_client: DataJudClient | None = Depends(get_datajud_client),
) -> ProcessEnrichmentRead:
    process = await _get_process_for_detail(session, process_id)
    if not process:
        raise HTTPException(status_code=404, detail="Processo nao encontrado")
    if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
        raise HTTPException(status_code=422, detail="Data inicial deve ser anterior a data final")

    clients = [client_process.client for client_process in process.client_processes]
    importer = DjenImporter(session, djen_client, datajud_client=datajud_client)
    try:
        result = await importer.enrich_process_by_number(
            process,
            clients,
            start_date=payload.start_date,
            end_date=payload.end_date,
            force_datajud=payload.force_datajud,
        )
    except DjenRateLimitError as exc:
        raise HTTPException(
            status_code=429,
            detail="Rate limit da fonte de movimentacoes; tente novamente em alguns instantes",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await session.commit()
    refreshed = await _get_process_for_detail(session, result.process.id)
    if not refreshed:
        raise HTTPException(status_code=404, detail="Processo nao encontrado")
    return ProcessEnrichmentRead(
        process=_process_detail(refreshed),
        start_date=result.start_date,
        end_date=result.end_date,
        datajud_attempted=result.datajud_attempted,
        djen_items_found=result.djen_items_found,
        djen_imported=result.djen_imported,
        djen_pages=result.djen_pages,
        rate_limit_limit=result.rate_limit_limit,
        rate_limit_remaining=result.rate_limit_remaining,
    )


async def _get_process_for_detail(session: AsyncSession, process_id: str) -> Process | None:
    result = await session.execute(
        select(Process)
        .where(Process.id == process_id)
        .options(
            selectinload(Process.communications).selectinload(Communication.parties),
            selectinload(Process.communications)
            .selectinload(Communication.risk_matches)
            .selectinload(CommunicationRiskMatch.keyword),
            selectinload(Process.communications)
            .selectinload(Communication.communication_lawyers)
            .selectinload(CommunicationLawyer.lawyer),
            selectinload(Process.client_processes).selectinload(ClientProcess.client),
        )
    )
    return result.scalar_one_or_none()


def _process_detail(process: Process) -> ProcessDetail:
    client_process = process.client_processes[0] if process.client_processes else None
    timeline = sorted(process.communications, key=lambda item: (item.data_disponibilizacao, item.id))
    parties = [party for communication in timeline for party in communication.parties]
    lawyers = {
        link.lawyer.id: link.lawyer
        for communication in timeline
        for link in communication.communication_lawyers
    }
    base = _process_item(process, client_process)
    return ProcessDetail(
        **base.model_dump(),
        datajud=_datajud_read(process),
        parties=[_party_read(party) for party in parties],
        lawyers=[_lawyer_read(lawyer) for lawyer in lawyers.values()],
        timeline=[_communication_item(communication) for communication in timeline],
    )


@router.get("/communications/{communication_id}", response_model=CommunicationRead)
async def get_communication(
    communication_id: str, session: AsyncSession = Depends(get_session)
) -> CommunicationRead:
    result = await session.execute(
        select(Communication)
        .where(Communication.id == communication_id)
        .options(
            selectinload(Communication.parties),
            selectinload(Communication.risk_matches).selectinload(CommunicationRiskMatch.keyword),
            selectinload(Communication.communication_lawyers).selectinload(CommunicationLawyer.lawyer),
        )
    )
    communication = result.scalar_one_or_none()
    if not communication:
        raise HTTPException(status_code=404, detail="Movimentacao nao encontrada")
    lawyers = [link.lawyer for link in communication.communication_lawyers]
    return CommunicationRead(
        **_communication_item(communication).model_dump(),
        numero_processo=communication.numero_processo,
        raw_text=communication.raw_text,
        raw_payload=communication.raw_payload,
        parties=[_party_read(party) for party in communication.parties],
        lawyers=[_lawyer_read(lawyer) for lawyer in lawyers],
    )


@router.get("/exports")
async def export_client(
    client_id: str,
    format: str = Query(pattern="^(csv|xlsx)$"),
    session: AsyncSession = Depends(get_session),
):
    client = await session.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Cliente nao encontrado")
    rows = await _export_rows(session, client_id)
    if format == "csv":
        content = _export_csv(rows)
        return StreamingResponse(
            iter([content]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="juds-export.csv"'},
        )
    content = _export_xlsx(rows)
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="juds-export.xlsx"'},
    )


async def _client_read(session: AsyncSession, client: Client) -> ClientRead:
    process_count = await session.scalar(
        select(func.count(ClientProcess.id)).where(ClientProcess.client_id == client.id)
    )
    communication_count = await session.scalar(
        select(func.coalesce(func.sum(ClientProcess.communications_count), 0)).where(
            ClientProcess.client_id == client.id
        )
    )
    pending_runs = await session.scalar(
        select(func.count(SearchRun.id)).where(
            SearchRun.client_id == client.id,
            SearchRun.status.in_(["queued", "running"]),
        )
    )
    return ClientRead(
        id=client.id,
        name=client.name,
        cpf_masked=mask_cpf(client.cpf),
        process_count=int(process_count or 0),
        communication_count=int(communication_count or 0),
        pending_runs=int(pending_runs or 0),
        created_at=client.created_at,
    )


def _search_run_read(run: SearchRun) -> SearchRunRead:
    return SearchRunRead(
        id=run.id,
        client_id=run.client_id,
        status=run.status,
        start_date=run.start_date,
        end_date=run.end_date,
        current_date=run.current_date,
        current_page=run.current_page,
        total_imported=run.total_imported,
        rate_limit_limit=run.rate_limit_limit,
        rate_limit_remaining=run.rate_limit_remaining,
        error_message=run.error_message,
        created_at=run.created_at,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


async def _count_runs_by_status(session: AsyncSession, status: str) -> int:
    count = await session.scalar(select(func.count(SearchRun.id)).where(SearchRun.status == status))
    return int(count or 0)


async def _get_worker_for_read(session: AsyncSession, worker_id: str) -> WorkerInstance | None:
    result = await session.execute(
        select(WorkerInstance)
        .where(WorkerInstance.id == worker_id)
        .options(selectinload(WorkerInstance.current_run).selectinload(SearchRun.client))
    )
    return result.scalar_one_or_none()


def _worker_read(worker: WorkerInstance) -> WorkerRead:
    last_seen_seconds = _worker_last_seen_seconds(worker)
    return WorkerRead(
        id=worker.id,
        name=worker.name,
        kind=worker.kind,
        status=worker.status,
        effective_status=_worker_effective_status(worker, last_seen_seconds),
        hostname=worker.hostname,
        process_id=worker.process_id,
        started_at=worker.started_at,
        heartbeat_at=worker.heartbeat_at,
        stopped_at=worker.stopped_at,
        last_seen_seconds=last_seen_seconds,
        stop_requested=worker.stop_requested,
        processed_runs=worker.processed_runs,
        poll_interval_seconds=worker.poll_interval_seconds,
        last_error=worker.last_error,
        current_run=_worker_run_read(worker.current_run) if worker.current_run else None,
        created_at=worker.created_at,
        updated_at=worker.updated_at,
    )


def _worker_run_read(run: SearchRun) -> WorkerRunRead:
    return WorkerRunRead(
        id=run.id,
        client_id=run.client_id,
        client_name=run.client.name if run.client else "Cliente nao encontrado",
        status=run.status,
        start_date=run.start_date,
        end_date=run.end_date,
        current_date=run.current_date,
        current_page=run.current_page,
        total_imported=run.total_imported,
        rate_limit_limit=run.rate_limit_limit,
        rate_limit_remaining=run.rate_limit_remaining,
        error_message=run.error_message,
        created_at=run.created_at,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


def _worker_last_seen_seconds(worker: WorkerInstance) -> int | None:
    if not worker.heartbeat_at:
        return None
    heartbeat = worker.heartbeat_at
    if heartbeat.tzinfo is None:
        heartbeat = heartbeat.replace(tzinfo=timezone.utc)
    return max(0, int((datetime.now(timezone.utc) - heartbeat).total_seconds()))


def _worker_effective_status(worker: WorkerInstance, last_seen_seconds: int | None) -> str:
    if worker.status in {WORKER_STATUS_STOPPED, WORKER_STATUS_FAILED}:
        return worker.status
    if last_seen_seconds is not None and last_seen_seconds > WORKER_HEARTBEAT_STALE_SECONDS:
        return "stale"
    return worker.status


def _process_item(process: Process, client_process: ClientProcess | None) -> ProcessListItem:
    risk_matches = _process_risk_matches(process)
    return ProcessListItem(
        id=process.id,
        numero_processo=process.numero_processo,
        formatted_number=process.formatted_number,
        tribunal=process.tribunal,
        process_class=process.process_class,
        agency=process.agency,
        external_link=process.external_link,
        cpf_status=client_process.cpf_status if client_process else "ausente_no_djen",
        polo=client_process.polo if client_process else None,
        communications_count=client_process.communications_count if client_process else 0,
        last_movement_at=client_process.last_movement_at if client_process else process.last_communication_at,
        datajud_status=process.datajud_status or "pending",
        datajud_synced_at=process.datajud_synced_at,
        datajud_last_movement_at=process.datajud_last_movement_at,
        process_parties=_process_parties(process),
        risk_matches_count=len(risk_matches),
        highest_risk_level=_highest_risk_level(risk_matches),
        risk_matches=risk_matches,
    )


def _process_parties(process: Process) -> list[ProcessPartyRead]:
    parties = [
        ProcessPartyRead(
            name=party.name,
            polo=_normalize_polo(party.polo),
            source="djen",
        )
        for communication in process.communications
        for party in communication.parties
        if _to_str(party.name)
    ]
    parties.extend(_datajud_process_parties(process.datajud_payload))
    return _dedupe_process_parties(parties)


def _datajud_process_parties(source: dict[str, Any] | None) -> list[ProcessPartyRead]:
    if not isinstance(source, dict):
        return []
    payload = source.get("_source") if isinstance(source.get("_source"), dict) else source
    parties: list[ProcessPartyRead] = []
    for key in ("partes", "envolvidos"):
        parties.extend(_datajud_party_values(payload.get(key), None))
    for key in ("poloAtivo", "polo_ativo", "ativo"):
        parties.extend(_datajud_party_values(payload.get(key), "A"))
    for key in ("poloPassivo", "polo_passivo", "passivo"):
        parties.extend(_datajud_party_values(payload.get(key), "P"))
    return _dedupe_process_parties(parties)


def _datajud_party_values(value: Any, default_polo: str | None) -> list[ProcessPartyRead]:
    if value is None:
        return []
    if isinstance(value, list):
        return [
            party
            for item in value
            for party in _datajud_party_values(item, default_polo)
        ]
    if isinstance(value, str):
        name = _to_str(value)
        return [
            ProcessPartyRead(name=name, polo=_normalize_polo(default_polo), source="datajud")
        ] if name else []
    if not isinstance(value, dict):
        return []

    polo = _normalize_polo(
        _to_str(get_first(value, "polo", "tipoPolo", "tipo_polo", "lado")) or default_polo
    )
    name = _datajud_party_name(value)
    if name:
        return [ProcessPartyRead(name=name, polo=polo, source="datajud")]

    parties: list[ProcessPartyRead] = []
    for key, key_polo in (
        ("poloAtivo", "A"),
        ("polo_ativo", "A"),
        ("ativo", "A"),
        ("poloPassivo", "P"),
        ("polo_passivo", "P"),
        ("passivo", "P"),
        ("partes", default_polo),
        ("envolvidos", default_polo),
        ("pessoas", default_polo),
        ("items", default_polo),
    ):
        parties.extend(_datajud_party_values(value.get(key), key_polo))
    return parties


def _datajud_party_name(value: dict[str, Any]) -> str | None:
    direct_name = _to_str(
        get_first(
            value,
            "nome",
            "name",
            "nomeParte",
            "nome_parte",
            "nomePessoa",
            "nome_pessoa",
            "razaoSocial",
            "razao_social",
        )
    )
    if direct_name:
        return direct_name
    for key in ("pessoa", "parte", "pessoaFisica", "pessoaJuridica"):
        nested = value.get(key)
        if isinstance(nested, dict):
            nested_name = _datajud_party_name(nested)
            if nested_name:
                return nested_name
    return None


def _dedupe_process_parties(parties: list[ProcessPartyRead]) -> list[ProcessPartyRead]:
    by_name: dict[str, ProcessPartyRead] = {}
    for party in parties:
        normalized_name = normalize_name(party.name)
        if not normalized_name:
            continue
        current = by_name.get(normalized_name)
        if current is None or _party_preference(party) < _party_preference(current):
            by_name[normalized_name] = party
    return sorted(
        by_name.values(),
        key=lambda party: (
            {"A": 0, "P": 1}.get(party.polo or "", 2),
            normalize_name(party.name),
        ),
    )


def _party_preference(party: ProcessPartyRead) -> tuple[int, int]:
    return (0 if party.polo in {"A", "P"} else 1, 0 if party.source == "djen" else 1)


def _normalize_polo(value: str | None) -> str | None:
    text = _to_str(value)
    if not text:
        return None
    normalized = normalize_name(text)
    if normalized in {"A", "ATIVO", "POLO ATIVO", "AUTOR", "REQUERENTE", "EXEQUENTE"}:
        return "A"
    if normalized in {"P", "PASSIVO", "POLO PASSIVO", "REU", "REQUERIDO", "EXECUTADO"}:
        return "P"
    return text


def _datajud_read(process: Process) -> DataJudRead:
    movements = [
        DataJudMovementRead(
            codigo=_to_int(movement.get("codigo")),
            nome=_to_str(movement.get("nome")),
            data_hora=movement.get("data_hora"),
            orgao_julgador=_to_str(movement.get("orgao_julgador")),
            complementos=[
                complement
                for complement in movement.get("complementos", [])
                if isinstance(complement, str)
            ],
        )
        for movement in datajud_movements(process.datajud_payload)
    ]
    return DataJudRead(
        status=process.datajud_status or "pending",
        alias=process.datajud_alias,
        synced_at=process.datajud_synced_at,
        source_updated_at=process.datajud_source_updated_at,
        filed_at=process.datajud_filed_at,
        last_movement_at=process.datajud_last_movement_at,
        degree=process.datajud_degree,
        secrecy_level=process.datajud_secrecy_level,
        system=process.datajud_system,
        format=process.datajud_format,
        subjects=datajud_subject_names(process.datajud_payload),
        movements_count=process.datajud_movements_count or 0,
        error=process.datajud_error,
        movements=movements,
    )


def _party_read(party: CommunicationParty) -> PartyRead:
    return PartyRead(
        id=party.id,
        communication_id=party.communication_id,
        name=party.name,
        cpf_cnpj_masked=cpf_to_masked(party.cpf_cnpj) if party.cpf_cnpj and len(party.cpf_cnpj) == 11 else None,
        polo=party.polo,
        is_client_match=party.is_client_match,
        cpf_status=party.cpf_status,
    )


def _lawyer_read(lawyer: Lawyer) -> LawyerRead:
    return LawyerRead(
        id=lawyer.id,
        name=lawyer.name,
        oab_number=lawyer.oab_number,
        oab_state=lawyer.oab_state,
    )


def _communication_item(communication: Communication) -> CommunicationListItem:
    return CommunicationListItem(
        id=communication.id,
        djen_id=communication.djen_id,
        djen_hash=communication.djen_hash,
        data_disponibilizacao=communication.data_disponibilizacao,
        sigla_tribunal=communication.sigla_tribunal,
        tipo_comunicacao=communication.tipo_comunicacao,
        nome_orgao=communication.nome_orgao,
        nome_classe=communication.nome_classe,
        meio=communication.meio,
        external_link=communication.external_link,
        plain_text=communication.plain_text,
        risk_matches=_risk_matches_read(communication.risk_matches),
    )


async def _ensure_unique_risk_keyword(
    session: AsyncSession,
    normalized_term: str,
    *,
    keyword_id: str | None = None,
) -> None:
    statement = select(RiskKeyword).where(RiskKeyword.normalized_term == normalized_term)
    if keyword_id:
        statement = statement.where(RiskKeyword.id != keyword_id)
    existing = (await session.execute(statement)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Palavra de risco ja cadastrada")


def _risk_keyword_read(keyword: RiskKeyword, match_count: int) -> RiskKeywordRead:
    return RiskKeywordRead(
        id=keyword.id,
        term=keyword.term,
        normalized_term=keyword.normalized_term,
        category=keyword.category,
        risk_level=keyword.risk_level,
        description=keyword.description,
        active=keyword.active,
        match_count=match_count,
        created_at=keyword.created_at,
        updated_at=keyword.updated_at,
    )


def _risk_reprocess_read(reprocess) -> RiskReprocessRead:
    return RiskReprocessRead(
        scanned_communications=reprocess.scanned_communications,
        matched_communications=reprocess.matched_communications,
        matches_created=reprocess.matches_created,
    )


def _process_risk_matches(process: Process) -> list[RiskMatchRead]:
    return _risk_matches_read(
        [
            match
            for communication in process.communications
            for match in communication.risk_matches
        ]
    )


def _risk_matches_read(matches: list[CommunicationRiskMatch]) -> list[RiskMatchRead]:
    return [
        _risk_match_read(match)
        for match in sorted(
            matches,
            key=lambda item: (
                -RISK_LEVEL_ORDER.get(item.keyword.risk_level if item.keyword else "", 0),
                item.keyword.category if item.keyword else "",
                item.keyword.term if item.keyword else "",
                item.source,
            ),
        )
    ]


def _risk_match_read(match: CommunicationRiskMatch) -> RiskMatchRead:
    keyword = match.keyword
    return RiskMatchRead(
        id=match.id,
        keyword_id=match.risk_keyword_id,
        keyword=keyword.term if keyword else "Palavra removida",
        category=keyword.category if keyword else "Geral",
        risk_level=keyword.risk_level if keyword else "medio",
        source=match.source,
        matched_text=match.matched_text,
        excerpt=match.excerpt,
        created_at=match.created_at,
    )


def _highest_risk_level(matches: list[RiskMatchRead]) -> str | None:
    if not matches:
        return None
    return max(matches, key=lambda match: RISK_LEVEL_ORDER.get(match.risk_level, 0)).risk_level


async def _export_rows(session: AsyncSession, client_id: str) -> list[dict[str, str]]:
    result = await session.execute(
        select(Process, ClientProcess, Communication)
        .join(ClientProcess, ClientProcess.process_id == Process.id)
        .join(Communication, Communication.process_id == Process.id)
        .where(ClientProcess.client_id == client_id)
        .options(selectinload(Communication.risk_matches).selectinload(CommunicationRiskMatch.keyword))
        .order_by(Process.numero_processo.asc(), Communication.data_disponibilizacao.asc())
    )
    rows = []
    for process, client_process, communication in result.all():
        risk_matches = _risk_matches_read(communication.risk_matches)
        rows.append(
            {
                "processo": process.formatted_number,
                "tribunal": process.tribunal or "",
                "classe": process.process_class or "",
                "orgao": communication.nome_orgao or process.agency or "",
                "data_disponibilizacao": communication.data_disponibilizacao.isoformat(),
                "tipo_movimentacao": communication.tipo_comunicacao or "",
                "cpf_status": client_process.cpf_status,
                "polo": client_process.polo or "",
                "detalhamento_status": process.datajud_status or "pending",
                "ajuizamento": _datetime_to_text(process.datajud_filed_at),
                "ultima_atualizacao": _datetime_to_text(
                    process.datajud_source_updated_at
                ),
                "ultima_movimentacao": _datetime_to_text(
                    process.datajud_last_movement_at
                ),
                "grau": process.datajud_degree or "",
                "sistema": process.datajud_system or "",
                "formato": process.datajud_format or "",
                "sigilo": _optional_int_to_text(process.datajud_secrecy_level),
                "assuntos": "; ".join(datajud_subject_names(process.datajud_payload)),
                "movimentos_count": str(process.datajud_movements_count or 0),
                "risco_nivel": _highest_risk_level(risk_matches) or "",
                "risco_palavras": "; ".join(
                    f"{match.keyword} ({match.risk_level})" for match in risk_matches
                ),
                "risco_evidencias": " | ".join(match.excerpt for match in risk_matches),
                "link": communication.external_link or "",
                "texto": communication.plain_text,
            }
        )
    return rows


def _export_csv(rows: list[dict[str, str]]) -> str:
    output = StringIO()
    fieldnames = [
        "processo",
        "tribunal",
        "classe",
        "orgao",
        "data_disponibilizacao",
        "tipo_movimentacao",
        "cpf_status",
        "polo",
        "detalhamento_status",
        "ajuizamento",
        "ultima_atualizacao",
        "ultima_movimentacao",
        "grau",
        "sistema",
        "formato",
        "sigilo",
        "assuntos",
        "movimentos_count",
        "risco_nivel",
        "risco_palavras",
        "risco_evidencias",
        "link",
        "texto",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def _export_xlsx(rows: list[dict[str, str]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "JUDS"
    fieldnames = [
        "processo",
        "tribunal",
        "classe",
        "orgao",
        "data_disponibilizacao",
        "tipo_movimentacao",
        "cpf_status",
        "polo",
        "detalhamento_status",
        "ajuizamento",
        "ultima_atualizacao",
        "ultima_movimentacao",
        "grau",
        "sistema",
        "formato",
        "sigilo",
        "assuntos",
        "movimentos_count",
        "risco_nivel",
        "risco_palavras",
        "risco_evidencias",
        "link",
        "texto",
    ]
    sheet.append(fieldnames)
    for row in rows:
        sheet.append([row[field] for field in fieldnames])
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def _datetime_to_text(value: datetime | None) -> str:
    return value.isoformat() if value else ""


def _optional_int_to_text(value: int | None) -> str:
    return "" if value is None else str(value)


def _to_str(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _to_int(value) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
