from __future__ import annotations

import csv
from io import BytesIO, StringIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_session
from app.importer import enqueue_search_run
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
    LawyerRead,
    PartyRead,
    ProcessDetail,
    ProcessListItem,
    SearchRunCreate,
    SearchRunRead,
    cpf_to_masked,
)
from app.utils import mask_cpf, normalize_name

router = APIRouter(prefix="/api")


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
        .order_by(ClientProcess.last_movement_at.desc().nullslast(), Process.numero_processo.asc())
    )
    if client_id:
        statement = statement.where(ClientProcess.client_id == client_id)
    result = await session.execute(statement)
    return [_process_item(process, client_process) for process, client_process in result.all()]


@router.get("/processes/{process_id}", response_model=ProcessDetail)
async def get_process(process_id: str, session: AsyncSession = Depends(get_session)) -> ProcessDetail:
    result = await session.execute(
        select(Process)
        .where(Process.id == process_id)
        .options(
            selectinload(Process.communications).selectinload(Communication.parties),
            selectinload(Process.communications)
            .selectinload(Communication.communication_lawyers)
            .selectinload(CommunicationLawyer.lawyer),
            selectinload(Process.client_processes),
        )
    )
    process = result.scalar_one_or_none()
    if not process:
        raise HTTPException(status_code=404, detail="Processo nao encontrado")
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
        "link",
        "texto",
    ]
    sheet.append(fieldnames)
    for row in rows:
        sheet.append([row[field] for field in fieldnames])
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()
