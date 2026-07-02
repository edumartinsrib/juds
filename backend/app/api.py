from __future__ import annotations

import csv
from datetime import datetime
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
    SearchRun,
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
    SearchRunCreate,
    SearchRunRead,
    cpf_to_masked,
)
from app.utils import get_first, mask_cpf, normalize_name

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


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


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
        .options(selectinload(Process.communications).selectinload(Communication.parties))
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
            detail="Rate limit do DJEN; tente novamente em alguns instantes",
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


def _process_item(process: Process, client_process: ClientProcess | None) -> ProcessListItem:
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
    )


async def _export_rows(session: AsyncSession, client_id: str) -> list[dict[str, str]]:
    result = await session.execute(
        select(Process, ClientProcess, Communication)
        .join(ClientProcess, ClientProcess.process_id == Process.id)
        .join(Communication, Communication.process_id == Process.id)
        .where(ClientProcess.client_id == client_id)
        .order_by(Process.numero_processo.asc(), Communication.data_disponibilizacao.asc())
    )
    rows = []
    for process, client_process, communication in result.all():
        rows.append(
            {
                "processo": process.formatted_number,
                "tribunal": process.tribunal or "",
                "classe": process.process_class or "",
                "orgao": communication.nome_orgao or process.agency or "",
                "data_disponibilizacao": communication.data_disponibilizacao.isoformat(),
                "tipo_comunicacao": communication.tipo_comunicacao or "",
                "cpf_status": client_process.cpf_status,
                "polo": client_process.polo or "",
                "datajud_status": process.datajud_status or "pending",
                "datajud_ajuizamento": _datetime_to_text(process.datajud_filed_at),
                "datajud_ultima_atualizacao": _datetime_to_text(
                    process.datajud_source_updated_at
                ),
                "datajud_ultima_movimentacao": _datetime_to_text(
                    process.datajud_last_movement_at
                ),
                "datajud_grau": process.datajud_degree or "",
                "datajud_sistema": process.datajud_system or "",
                "datajud_formato": process.datajud_format or "",
                "datajud_sigilo": _optional_int_to_text(process.datajud_secrecy_level),
                "datajud_assuntos": "; ".join(datajud_subject_names(process.datajud_payload)),
                "datajud_movimentos_count": str(process.datajud_movements_count or 0),
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
        "tipo_comunicacao",
        "cpf_status",
        "polo",
        "datajud_status",
        "datajud_ajuizamento",
        "datajud_ultima_atualizacao",
        "datajud_ultima_movimentacao",
        "datajud_grau",
        "datajud_sistema",
        "datajud_formato",
        "datajud_sigilo",
        "datajud_assuntos",
        "datajud_movimentos_count",
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
        "tipo_comunicacao",
        "cpf_status",
        "polo",
        "datajud_status",
        "datajud_ajuizamento",
        "datajud_ultima_atualizacao",
        "datajud_ultima_movimentacao",
        "datajud_grau",
        "datajud_sistema",
        "datajud_formato",
        "datajud_sigilo",
        "datajud_assuntos",
        "datajud_movimentos_count",
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
