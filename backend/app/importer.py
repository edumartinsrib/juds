from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Select, and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.datajud import (
    DATAJUD_STATUS_ERROR,
    DATAJUD_STATUS_NEEDS_REVIEW,
    DATAJUD_STATUS_NOT_FOUND,
    DATAJUD_STATUS_PENDING,
    DATAJUD_STATUS_SYNCED,
    DataJudClient,
    DataJudHit,
    DataJudSearchResult,
    datajud_object_name,
    datajud_movements,
    latest_datajud_movement_datetime,
    parse_datajud_datetime,
    select_datajud_hit,
)
from app.djen import DjenClient, DjenPage, DjenRateLimitError
from app.models import (
    Client,
    ClientCommunication,
    ClientProcess,
    Communication,
    CommunicationLawyer,
    CommunicationParty,
    Lawyer,
    Process,
    ProcessAuditIssue,
    ProcessEvent,
    ProcessSource,
    SearchRun,
    SourceSnapshot,
    WorkerInstance,
    CommunicationRiskMatch,
    CommunicationVersion,
)
from app.risk import classify_communication_risk
from app.utils import (
    ASSOCIATION_REJECTED,
    CPF_STATUS_ABSENT,
    ClientAssociationMatch,
    classify_party_cpf,
    classify_client_association,
    djen_fingerprint,
    format_process_number,
    get_first,
    html_to_text,
    is_valid_cnj_number,
    merge_association_status,
    merge_cpf_status,
    normalize_cpf,
    normalize_document,
    normalize_name,
    normalize_process_number,
    parse_djen_date,
)

SleepFunc = Callable[[float], Awaitable[None]]
logger = logging.getLogger("juds.importer")

DJEN_RATE_LIMIT_MESSAGE = "Rate limit da fonte de movimentacoes; retomando apos pausa."
DJEN_RATE_LIMIT_WAIT_MESSAGE = "Fonte de movimentacoes sem saldo de requisicoes; aguardando nova janela."


@dataclass(frozen=True)
class ProcessEnrichmentResult:
    process: Process
    start_date: date
    end_date: date
    datajud_attempted: bool
    djen_items_found: int
    djen_imported: int
    djen_pages: int
    rate_limit_limit: int | None
    rate_limit_remaining: int | None


@dataclass(frozen=True)
class ExistingCommunicationMatch:
    communication: Communication | None
    collision_ids: tuple[str, ...] = ()


def default_search_window() -> tuple[date, date]:
    settings = get_settings()
    end_date = date.today()
    start_date = end_date - timedelta(days=max(settings.search_window_days - 1, 0))
    return start_date, end_date


def default_process_enrichment_window(process: Process | None = None) -> tuple[date, date]:
    settings = get_settings()
    end_date = date.today()
    if process and process.datajud_filed_at:
        return process.datajud_filed_at.date(), end_date
    start_date = end_date - timedelta(days=max(settings.process_enrichment_window_days - 1, 0))
    return start_date, end_date


async def enqueue_search_run(
    session: AsyncSession,
    *,
    client_id: str,
    start_date: date | None = None,
    end_date: date | None = None,
) -> SearchRun:
    default_start, default_end = default_search_window()
    run = SearchRun(
        client_id=client_id,
        status="queued",
        start_date=start_date or default_start,
        end_date=end_date or default_end,
        current_page=1,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


class DjenImporter:
    def __init__(
        self,
        session: AsyncSession,
        djen_client: DjenClient,
        datajud_client: DataJudClient | None = None,
        *,
        sleep: SleepFunc = asyncio.sleep,
        rate_limit_sleep_seconds: int | None = None,
        datajud_refresh_hours: int | None = None,
    ) -> None:
        self.session = session
        self.djen_client = djen_client
        self.datajud_client = datajud_client
        self.sleep = sleep
        self.rate_limit_sleep_seconds = (
            get_settings().rate_limit_sleep_seconds
            if rate_limit_sleep_seconds is None
            else rate_limit_sleep_seconds
        )
        self.datajud_refresh_hours = (
            get_settings().datajud_refresh_hours
            if datajud_refresh_hours is None
            else datajud_refresh_hours
        )
        self._datajud_checked_process_ids: set[str] = set()

    async def process_run(self, run_id: str) -> SearchRun:
        run = await self.session.get(SearchRun, run_id)
        if not run:
            raise ValueError("Search run not found")
        client = await self.session.get(Client, run.client_id)
        if not client:
            raise ValueError("Client not found")

        run.status = "running"
        run.started_at = run.started_at or datetime.now(timezone.utc)
        run.error_message = None
        await self.session.commit()

        cursor = run.current_date or run.start_date
        page = run.current_page or 1
        logger.info(
            "Iniciando busca de movimentacoes run_id=%s client_id=%s nome=%r periodo=%s..%s data_atual=%s pagina=%s",
            run.id,
            client.id,
            client.name,
            run.start_date,
            run.end_date,
            cursor,
            page,
        )
        try:
            while cursor <= run.end_date:
                run.current_date = cursor
                run.current_page = page
                await self.session.commit()

                while True:
                    try:
                        djen_page = await self.djen_client.fetch_comunicacoes(
                            nome_parte=client.name,
                            start_date=cursor,
                            end_date=cursor,
                            page=page,
                        )
                    except DjenRateLimitError as exc:
                        run.rate_limit_limit = exc.limit
                        run.rate_limit_remaining = exc.remaining
                        run.error_message = DJEN_RATE_LIMIT_MESSAGE
                        await self.session.commit()
                        logger.warning(
                            "Fonte de movimentacoes respondeu 429 run_id=%s client_id=%s nome=%r data=%s pagina=%s "
                            "limite=%s restante=%s aguardando=%ss",
                            run.id,
                            client.id,
                            client.name,
                            cursor,
                            page,
                            exc.limit,
                            exc.remaining,
                            self.rate_limit_sleep_seconds,
                        )
                        await self.sleep(self.rate_limit_sleep_seconds)
                        continue

                    self._record_rate_limit(run, djen_page)
                    logger.info(
                        "Pagina de movimentacoes processada run_id=%s client_id=%s nome=%r data=%s pagina=%s "
                        "itens=%s total_dia=%s limite=%s restante=%s",
                        run.id,
                        client.id,
                        client.name,
                        cursor,
                        page,
                        len(djen_page.items),
                        djen_page.count,
                        djen_page.rate_limit_limit,
                        djen_page.rate_limit_remaining,
                    )
                    imported = await self.import_items(client, djen_page.items)
                    run.total_imported = (run.total_imported or 0) + imported
                    if run.error_message in (DJEN_RATE_LIMIT_MESSAGE, DJEN_RATE_LIMIT_WAIT_MESSAGE):
                        run.error_message = None
                    await self.session.commit()

                    if len(djen_page.items) < 100 or page * 100 >= djen_page.count:
                        break
                    page += 1
                    run.current_page = page

                    await self._sleep_if_rate_limit_depleted(run, client, cursor, page)

                cursor += timedelta(days=1)
                page = 1
                if cursor <= run.end_date:
                    await self._sleep_if_rate_limit_depleted(run, client, cursor, page)

            run.status = "completed"
            run.current_date = run.end_date
            run.current_page = 1
            if run.error_message in (DJEN_RATE_LIMIT_MESSAGE, DJEN_RATE_LIMIT_WAIT_MESSAGE):
                run.error_message = None
            run.finished_at = datetime.now(timezone.utc)
            await self.session.commit()
            await self.session.refresh(run)
            logger.info(
                "Busca de movimentacoes concluida run_id=%s client_id=%s nome=%r importadas=%s limite=%s restante=%s",
                run.id,
                client.id,
                client.name,
                run.total_imported,
                run.rate_limit_limit,
                run.rate_limit_remaining,
            )
            return run
        except Exception as exc:
            run.status = "failed"
            run.error_message = str(exc)
            run.finished_at = datetime.now(timezone.utc)
            await self.session.commit()
            logger.exception(
                "Busca de movimentacoes falhou run_id=%s client_id=%s nome=%r data=%s pagina=%s",
                run.id,
                client.id,
                client.name,
                run.current_date,
                run.current_page,
            )
            raise

    async def enrich_process_by_number(
        self,
        process: Process,
        clients: list[Client],
        *,
        start_date: date | None = None,
        end_date: date | None = None,
        force_datajud: bool = True,
    ) -> ProcessEnrichmentResult:
        datajud_attempted = await self._maybe_enrich_process_with_datajud(
            process,
            force=force_datajud,
        )
        default_start, default_end = default_process_enrichment_window(process)
        cursor_start = start_date or default_start
        cursor_end = end_date or default_end
        if cursor_start > cursor_end:
            raise ValueError("Data inicial deve ser anterior a data final")

        djen_items_found = 0
        djen_imported = 0
        djen_pages = 0
        rate_limit_limit: int | None = None
        rate_limit_remaining: int | None = None
        page = 1

        while True:
            djen_page = await self.djen_client.fetch_comunicacoes_por_processo(
                numero_processo=process.numero_processo,
                start_date=cursor_start,
                end_date=cursor_end,
                page=page,
                sigla_tribunal=process.tribunal,
            )
            djen_pages += 1
            djen_items_found = max(djen_items_found, djen_page.count)
            rate_limit_limit = djen_page.rate_limit_limit
            rate_limit_remaining = djen_page.rate_limit_remaining

            matching_items = [
                item
                for item in djen_page.items
                if self._process_number_from_item(item) == process.numero_processo
            ]
            djen_imported += await self._import_items_for_clients(clients, matching_items)
            await self.session.flush()

            if len(djen_page.items) < 100 or page * 100 >= djen_page.count:
                break
            page += 1
            if djen_page.rate_limit_remaining == 0:
                await self.sleep(self.rate_limit_sleep_seconds)

        await self.session.refresh(process)
        return ProcessEnrichmentResult(
            process=process,
            start_date=cursor_start,
            end_date=cursor_end,
            datajud_attempted=datajud_attempted,
            djen_items_found=djen_items_found,
            djen_imported=djen_imported,
            djen_pages=djen_pages,
            rate_limit_limit=rate_limit_limit,
            rate_limit_remaining=rate_limit_remaining,
        )

    def _record_rate_limit(self, run: SearchRun, page: DjenPage) -> None:
        run.rate_limit_limit = page.rate_limit_limit
        run.rate_limit_remaining = page.rate_limit_remaining

    async def _sleep_if_rate_limit_depleted(
        self,
        run: SearchRun,
        client: Client,
        next_date: date,
        next_page: int,
    ) -> None:
        if run.rate_limit_remaining != 0:
            return

        run.error_message = DJEN_RATE_LIMIT_WAIT_MESSAGE
        await self.session.commit()
        logger.info(
            "Fonte de movimentacoes informou saldo zero; pausa preventiva run_id=%s client_id=%s nome=%r "
            "proxima_data=%s proxima_pagina=%s limite=%s aguardando=%ss",
            run.id,
            client.id,
            client.name,
            next_date,
            next_page,
            run.rate_limit_limit,
            self.rate_limit_sleep_seconds,
        )
        await self.sleep(self.rate_limit_sleep_seconds)

    async def import_items(self, client: Client, items: list[dict[str, Any]]) -> int:
        imported = 0
        for item in items:
            process_number = self._process_number_from_item(item)
            if not is_valid_cnj_number(process_number):
                await self._record_audit_issue(
                    issue_key=f"invalid-cnj:djen:{djen_fingerprint(item)}",
                    issue_type="invalid_cnj_number",
                    severity="high",
                    summary="Comunicacao DJEN ignorada por numero CNJ invalido",
                    details={
                        "numero_recebido": process_number,
                        "djen_id": _to_int(get_first(item, "id", "numeroComunicacao")),
                        "djen_hash": _to_str(get_first(item, "hash")),
                        "source_fingerprint": djen_fingerprint(item),
                    },
                )
                continue

            match = await self._find_existing_communication(item)
            if match.collision_ids:
                await self._record_audit_issue(
                    issue_key=f"djen-collision:{djen_fingerprint(item)}",
                    issue_type="djen_identifier_collision",
                    severity="critical",
                    summary="Identificadores DJEN apontam para comunicacoes diferentes",
                    details={
                        "communication_ids": list(match.collision_ids),
                        "djen_id": _to_int(get_first(item, "id", "numeroComunicacao")),
                        "djen_hash": _to_str(get_first(item, "hash")),
                        "source_fingerprint": djen_fingerprint(item),
                    },
                )
                continue

            communication = match.communication
            if communication:
                await self._reconcile_existing_communication(
                    client,
                    communication,
                    item,
                    process_number,
                )
                continue
            await self._create_communication(client, item, process_number=process_number)
            imported += 1
        return imported

    async def _find_existing_communication(
        self,
        item: dict[str, Any],
    ) -> ExistingCommunicationMatch:
        djen_id = _to_int(get_first(item, "id", "numeroComunicacao"))
        djen_hash = _to_str(get_first(item, "hash"))
        fingerprint = djen_fingerprint(item)
        matched: dict[str, Communication] = {}
        matched_by_identifier: dict[str, set[str]] = {}
        filters = [("source_fingerprint", Communication.source_fingerprint == fingerprint)]
        if djen_id is not None:
            filters.append(("djen_id", Communication.djen_id == djen_id))
        if djen_hash:
            filters.append(("djen_hash", Communication.djen_hash == djen_hash))
        for identifier, condition in filters:
            rows = (await self.session.execute(select(Communication).where(condition))).scalars()
            matched_by_identifier[identifier] = set()
            for communication in rows.all():
                matched[communication.id] = communication
                matched_by_identifier[identifier].add(communication.id)
        if len(matched) > 1:
            return ExistingCommunicationMatch(
                communication=None,
                collision_ids=tuple(sorted(matched)),
            )
        if (
            djen_id is not None
            and matched
            and not matched_by_identifier.get("djen_id")
        ):
            return ExistingCommunicationMatch(
                communication=None,
                collision_ids=tuple(sorted(matched)),
            )
        return ExistingCommunicationMatch(
            communication=next(iter(matched.values()), None),
        )

    async def _create_communication(
        self,
        client: Client,
        item: dict[str, Any],
        *,
        process_number: str | None = None,
    ) -> Communication:
        process_number = process_number or self._process_number_from_item(item)
        if not is_valid_cnj_number(process_number):
            raise ValueError("Movimentacao sem numero CNJ valido")

        movement_date = parse_djen_date(
            get_first(item, "data_disponibilizacao", "datadisponibilizacao")
        )
        process = await self._get_or_create_process(item, process_number, movement_date)
        await self._maybe_enrich_process_with_datajud(process)

        raw_text = _to_str(get_first(item, "texto")) or ""
        communication = Communication(
            process_id=process.id,
            djen_id=_to_int(get_first(item, "id", "numeroComunicacao")),
            djen_hash=_to_str(get_first(item, "hash")),
            source_fingerprint=djen_fingerprint(item),
            numero_processo=process_number,
            data_disponibilizacao=movement_date,
            sigla_tribunal=_to_str(get_first(item, "siglaTribunal", "sigla_tribunal")),
            tipo_comunicacao=_to_str(get_first(item, "tipoComunicacao", "tipo_comunicacao")),
            nome_orgao=_to_str(get_first(item, "nomeOrgao", "orgao")),
            tipo_documento=_to_str(get_first(item, "tipoDocumento", "tipo_documento")),
            nome_classe=_to_str(get_first(item, "nomeClasse", "nome_classe")),
            meio=_to_str(get_first(item, "meio", "meiocompleto")),
            external_link=_to_str(get_first(item, "link")),
            raw_text=raw_text,
            plain_text=html_to_text(raw_text),
            raw_payload=item,
        )
        self.session.add(communication)
        await self.session.flush()

        association = self._classify_client_in_item(client, item)
        cpf_status, polo = await self._create_parties(
            client,
            communication,
            item,
            association=association,
        )
        await self._create_lawyers(communication, item)
        await self._upsert_client_communication(client, communication, association)
        if association.status != ASSOCIATION_REJECTED:
            await self._upsert_client_process(
                client,
                process,
                movement_date,
                cpf_status,
                polo,
                association,
            )
        await self._upsert_djen_event(communication)
        await self.session.flush()
        await classify_communication_risk(self.session, communication.id)
        return communication

    async def _reconcile_existing_communication(
        self,
        client: Client,
        communication: Communication,
        item: dict[str, Any],
        process_number: str,
    ) -> None:
        current_process = await self.session.get(Process, communication.process_id)
        if current_process is None:
            await self._record_audit_issue(
                issue_key=f"orphan-communication:{communication.id}",
                issue_type="orphan_communication",
                severity="critical",
                summary="Comunicacao existente aponta para processo ausente",
                communication_id=communication.id,
                details={"process_id": communication.process_id},
            )
            return

        changed_fields = self._communication_changed_fields(communication, item, process_number)
        if changed_fields:
            await self._create_communication_version(
                communication,
                change_reason=(
                    "process_number_rectified"
                    if communication.numero_processo != process_number
                    else "source_metadata_updated"
                ),
            )

        previous_process = current_process
        target_process = current_process
        movement_date = parse_djen_date(
            get_first(item, "data_disponibilizacao", "datadisponibilizacao")
        )
        if communication.numero_processo != process_number:
            target_process = await self._get_or_create_process(item, process_number, movement_date)
            communication.process_id = target_process.id
            communication.numero_processo = process_number
            await self._record_audit_issue(
                issue_key=f"djen-rectification:{communication.id}:{process_number}",
                issue_type="djen_process_rectification",
                severity="medium",
                status="resolved",
                summary="Retificacao DJEN reconciliada e versionada",
                process_id=target_process.id,
                communication_id=communication.id,
                details={
                    "processo_anterior": previous_process.numero_processo,
                    "processo_atual": process_number,
                    "campos_alterados": changed_fields,
                },
            )

        affected_client_ids = set(
            (
                await self.session.execute(
                    select(ClientCommunication.client_id).where(
                        ClientCommunication.communication_id == communication.id
                    )
                )
            ).scalars().all()
        )
        affected_client_ids.update(
            (
                await self.session.execute(
                    select(ClientProcess.client_id).where(
                        ClientProcess.process_id.in_(
                            {previous_process.id, target_process.id}
                        )
                    )
                )
            ).scalars().all()
        )
        affected_client_ids.add(client.id)

        self._apply_communication_fields(communication, item, process_number)
        await self.session.execute(
            delete(CommunicationParty).where(
                CommunicationParty.communication_id == communication.id
            )
        )
        await self.session.execute(
            delete(CommunicationLawyer).where(
                CommunicationLawyer.communication_id == communication.id
            )
        )
        await self.session.execute(
            delete(CommunicationRiskMatch).where(
                CommunicationRiskMatch.communication_id == communication.id
            )
        )
        association = self._classify_client_in_item(client, item)
        cpf_status, polo = await self._create_parties(
            client,
            communication,
            item,
            association=association,
        )
        await self._create_lawyers(communication, item)
        await self._upsert_djen_event(communication)
        await classify_communication_risk(self.session, communication.id)

        affected_clients = (
            await self.session.execute(
                select(Client).where(Client.id.in_(affected_client_ids))
            )
        ).scalars().all()
        for affected_client in affected_clients:
            affected_association = (
                association
                if affected_client.id == client.id
                else self._classify_client_in_item(affected_client, item)
            )
            affected_cpf_status, affected_polo = (
                (cpf_status, polo)
                if affected_client.id == client.id
                else self._cpf_status_for_association(
                    affected_client,
                    item,
                    affected_association,
                )
            )
            await self._upsert_client_communication(
                affected_client,
                communication,
                affected_association,
            )
            if affected_association.status != ASSOCIATION_REJECTED:
                await self._upsert_client_process(
                    affected_client,
                    target_process,
                    movement_date,
                    affected_cpf_status,
                    affected_polo,
                    affected_association,
                )
        await self._recalculate_client_processes(previous_process.id)
        if target_process.id != previous_process.id:
            await self._recalculate_client_processes(target_process.id)
        await self._refresh_process_cover_from_djen(previous_process)
        await self._refresh_process_cover_from_djen(target_process)
        await self._maybe_enrich_process_with_datajud(target_process)
        await self.session.flush()

    def _communication_changed_fields(
        self,
        communication: Communication,
        item: dict[str, Any],
        process_number: str,
    ) -> list[str]:
        expected = {
            "numero_processo": process_number,
            "djen_id": _to_int(get_first(item, "id", "numeroComunicacao")),
            "djen_hash": _to_str(get_first(item, "hash")),
            "data_disponibilizacao": parse_djen_date(
                get_first(item, "data_disponibilizacao", "datadisponibilizacao")
            ),
            "sigla_tribunal": _to_str(get_first(item, "siglaTribunal", "sigla_tribunal")),
            "tipo_comunicacao": _to_str(
                get_first(item, "tipoComunicacao", "tipo_comunicacao")
            ),
            "nome_orgao": _to_str(get_first(item, "nomeOrgao", "orgao")),
            "tipo_documento": _to_str(get_first(item, "tipoDocumento", "tipo_documento")),
            "nome_classe": _to_str(get_first(item, "nomeClasse", "nome_classe")),
            "meio": _to_str(get_first(item, "meio", "meiocompleto")),
            "external_link": _to_str(get_first(item, "link")),
            "raw_text": _to_str(get_first(item, "texto")) or "",
            "source_fingerprint": djen_fingerprint(item),
        }
        return [
            field
            for field, value in expected.items()
            if getattr(communication, field) != value
        ]

    def _apply_communication_fields(
        self,
        communication: Communication,
        item: dict[str, Any],
        process_number: str,
    ) -> None:
        raw_text = _to_str(get_first(item, "texto")) or ""
        communication.djen_id = _to_int(get_first(item, "id", "numeroComunicacao"))
        communication.djen_hash = _to_str(get_first(item, "hash"))
        communication.source_fingerprint = djen_fingerprint(item)
        communication.numero_processo = process_number
        communication.data_disponibilizacao = parse_djen_date(
            get_first(item, "data_disponibilizacao", "datadisponibilizacao")
        )
        communication.sigla_tribunal = _to_str(
            get_first(item, "siglaTribunal", "sigla_tribunal")
        )
        communication.tipo_comunicacao = _to_str(
            get_first(item, "tipoComunicacao", "tipo_comunicacao")
        )
        communication.nome_orgao = _to_str(get_first(item, "nomeOrgao", "orgao"))
        communication.tipo_documento = _to_str(
            get_first(item, "tipoDocumento", "tipo_documento")
        )
        communication.nome_classe = _to_str(get_first(item, "nomeClasse", "nome_classe"))
        communication.meio = _to_str(get_first(item, "meio", "meiocompleto"))
        communication.external_link = _to_str(get_first(item, "link"))
        communication.raw_text = raw_text
        communication.plain_text = html_to_text(raw_text)
        communication.raw_payload = item

    async def _create_communication_version(
        self,
        communication: Communication,
        *,
        change_reason: str,
    ) -> None:
        current_version = await self.session.scalar(
            select(func.max(CommunicationVersion.version_number)).where(
                CommunicationVersion.communication_id == communication.id
            )
        )
        self.session.add(
            CommunicationVersion(
                communication_id=communication.id,
                version_number=int(current_version or 0) + 1,
                change_reason=change_reason,
                previous_process_id=communication.process_id,
                previous_numero_processo=communication.numero_processo,
                previous_djen_hash=communication.djen_hash,
                previous_fingerprint=communication.source_fingerprint,
                previous_payload=communication.raw_payload,
            )
        )

    async def _refresh_process_cover_from_djen(self, process: Process) -> None:
        latest = (
            await self.session.execute(
                select(Communication)
                .where(Communication.process_id == process.id)
                .order_by(
                    Communication.data_disponibilizacao.desc(),
                    Communication.updated_at.desc(),
                    Communication.id.desc(),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if latest is None:
            process.last_communication_at = None
            return
        process.last_communication_at = latest.data_disponibilizacao
        if process.datajud_status != DATAJUD_STATUS_SYNCED:
            process.tribunal = latest.sigla_tribunal or process.tribunal
            process.process_class = latest.nome_classe or process.process_class
            process.agency = latest.nome_orgao or process.agency
        process.external_link = latest.external_link or process.external_link

    async def _get_or_create_process(
        self, item: dict[str, Any], process_number: str, movement_date: date
    ) -> Process:
        result = await self.session.execute(
            select(Process).where(Process.numero_processo == process_number)
        )
        process = result.scalar_one_or_none()
        if process is None:
            process = Process(
                numero_processo=process_number,
                formatted_number=format_process_number(process_number),
                tribunal=_to_str(get_first(item, "siglaTribunal", "sigla_tribunal")),
                process_class=_to_str(get_first(item, "nomeClasse", "nome_classe")),
                agency=_to_str(get_first(item, "nomeOrgao", "orgao")),
                external_link=_to_str(get_first(item, "link")),
                last_communication_at=movement_date,
                datajud_status=DATAJUD_STATUS_PENDING,
            )
            self.session.add(process)
            await self.session.flush()
            return process

        is_latest = (
            process.last_communication_at is None
            or movement_date >= process.last_communication_at
        )
        if is_latest and process.datajud_status != DATAJUD_STATUS_SYNCED:
            process.tribunal = (
                _to_str(get_first(item, "siglaTribunal", "sigla_tribunal"))
                or process.tribunal
            )
            process.process_class = (
                _to_str(get_first(item, "nomeClasse", "nome_classe"))
                or process.process_class
            )
            process.agency = _to_str(get_first(item, "nomeOrgao", "orgao")) or process.agency
        if is_latest:
            process.external_link = _to_str(get_first(item, "link")) or process.external_link
            process.last_communication_at = movement_date
        return process

    async def _create_parties(
        self,
        client: Client,
        communication: Communication,
        item: dict[str, Any],
        *,
        association: ClientAssociationMatch,
    ) -> tuple[str, str | None]:
        parties = item.get("destinatarios") or []
        status = CPF_STATUS_ABSENT
        matched_polo = association.polo

        for party in parties:
            name = _to_str(get_first(party, "nome", "nomeParte", "nome_parte")) or ""
            if not name:
                continue
            cpf_cnpj = normalize_document(
                _to_str(get_first(party, "cpf_cnpj", "cpfCnpj", "documento", "cpf"))
            )
            is_match = (
                association.party_name is not None
                and normalize_name(association.party_name) == normalize_name(name)
            )
            party_status = classify_party_cpf(client.cpf, cpf_cnpj) if is_match else CPF_STATUS_ABSENT
            if is_match:
                status = merge_cpf_status(status, party_status)
                matched_polo = matched_polo or _to_str(get_first(party, "polo"))
            self.session.add(
                CommunicationParty(
                    communication_id=communication.id,
                    name=name,
                    normalized_name=normalize_name(name),
                    cpf_cnpj=cpf_cnpj,
                    polo=_to_str(get_first(party, "polo")),
                    is_client_match=is_match,
                    cpf_status=party_status,
                )
            )
        return status, matched_polo

    def _classify_client_in_item(
        self,
        client: Client,
        item: dict[str, Any],
    ) -> ClientAssociationMatch:
        parties = item.get("destinatarios") or []
        return classify_client_association(client.name, client.cpf, parties)

    def _cpf_status_for_association(
        self,
        client: Client,
        item: dict[str, Any],
        association: ClientAssociationMatch,
    ) -> tuple[str, str | None]:
        status = CPF_STATUS_ABSENT
        for party in item.get("destinatarios") or []:
            name = _to_str(get_first(party, "nome", "nomeParte", "nome_parte"))
            if (
                not name
                or not association.party_name
                or normalize_name(name) != normalize_name(association.party_name)
            ):
                continue
            document = normalize_document(
                _to_str(get_first(party, "cpf_cnpj", "cpfCnpj", "documento", "cpf"))
            )
            status = merge_cpf_status(
                status,
                classify_party_cpf(client.cpf, document),
            )
        return status, association.polo

    async def _create_lawyers(self, communication: Communication, item: dict[str, Any]) -> None:
        raw_lawyers = item.get("destinatarioadvogados") or item.get("advogados") or []
        linked_lawyer_ids: set[str] = set()
        for entry in raw_lawyers:
            lawyer_payload = entry.get("advogado") if isinstance(entry, dict) else None
            lawyer_payload = lawyer_payload or entry
            if not isinstance(lawyer_payload, dict):
                continue
            name = _to_str(get_first(lawyer_payload, "nome", "name"))
            if not name:
                continue
            oab_number = _to_str(get_first(lawyer_payload, "numero_oab", "numeroOab", "oab"))
            oab_state = _to_str(get_first(lawyer_payload, "uf_oab", "ufOab"))
            lawyer = await self._get_or_create_lawyer(name, oab_number, oab_state)
            if lawyer.id in linked_lawyer_ids:
                logger.info(
                    "Advogado duplicado ignorado na comunicacao communication_id=%s lawyer_id=%s nome=%r",
                    communication.id,
                    lawyer.id,
                    name,
                )
                continue
            linked_lawyer_ids.add(lawyer.id)
            self.session.add(CommunicationLawyer(communication_id=communication.id, lawyer_id=lawyer.id))

    async def _get_or_create_lawyer(
        self, name: str, oab_number: str | None, oab_state: str | None
    ) -> Lawyer:
        result = await self.session.execute(
            select(Lawyer).where(
                and_(
                    Lawyer.name == name,
                    Lawyer.oab_number.is_(None) if oab_number is None else Lawyer.oab_number == oab_number,
                    Lawyer.oab_state.is_(None) if oab_state is None else Lawyer.oab_state == oab_state,
                )
            )
        )
        lawyer = result.scalar_one_or_none()
        if lawyer:
            return lawyer
        lawyer = Lawyer(name=name, oab_number=oab_number, oab_state=oab_state)
        self.session.add(lawyer)
        await self.session.flush()
        return lawyer

    async def _upsert_client_process(
        self,
        client: Client,
        process: Process,
        movement_date: date,
        cpf_status: str,
        polo: str | None,
        association: ClientAssociationMatch,
    ) -> ClientProcess:
        result = await self.session.execute(
            select(ClientProcess).where(
                ClientProcess.client_id == client.id,
                ClientProcess.process_id == process.id,
            )
        )
        client_process = result.scalar_one_or_none()
        communications_count = await self._count_process_communications(
            process.id,
            client_id=client.id,
        )
        if client_process is None:
            client_process = ClientProcess(
                client_id=client.id,
                process_id=process.id,
                cpf_status=cpf_status,
                polo=polo,
                association_status=association.status,
                association_reason=association.reason,
                communications_count=communications_count,
                last_movement_at=movement_date,
            )
            self.session.add(client_process)
            return client_process

        client_process.cpf_status = merge_cpf_status(client_process.cpf_status, cpf_status)
        client_process.polo = client_process.polo or polo
        client_process.association_status = merge_association_status(
            client_process.association_status,
            association.status,
        )
        client_process.association_reason = association.reason
        client_process.communications_count = communications_count
        if client_process.last_movement_at is None or movement_date > client_process.last_movement_at:
            client_process.last_movement_at = movement_date
        return client_process

    async def _count_process_communications(
        self,
        process_id: str,
        *,
        client_id: str | None = None,
    ) -> int:
        statement = select(func.count(Communication.id)).where(
            Communication.process_id == process_id
        )
        if client_id:
            statement = statement.join(
                ClientCommunication,
                ClientCommunication.communication_id == Communication.id,
            ).where(
                ClientCommunication.client_id == client_id,
                ClientCommunication.association_status != ASSOCIATION_REJECTED,
            )
        count = await self.session.scalar(statement)
        return int(count or 0)

    async def _upsert_client_communication(
        self,
        client: Client,
        communication: Communication,
        association: ClientAssociationMatch,
    ) -> ClientCommunication:
        existing = (
            await self.session.execute(
                select(ClientCommunication).where(
                    ClientCommunication.client_id == client.id,
                    ClientCommunication.communication_id == communication.id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            existing = ClientCommunication(
                client_id=client.id,
                communication_id=communication.id,
                association_status=association.status,
                match_reason=association.reason,
                matched_party_name=association.party_name,
                matched_document=association.party_document,
            )
            self.session.add(existing)
        else:
            existing.association_status = association.status
            existing.match_reason = association.reason
            existing.matched_party_name = association.party_name
            existing.matched_document = association.party_document
        await self.session.flush()
        if association.status in {"uncertain", "rejected"}:
            await self._record_audit_issue(
                issue_key=(
                    f"client-association:{client.id}:{communication.id}:"
                    f"{association.status}"
                ),
                issue_type="uncertain_client_association",
                severity="medium",
                summary="Associacao cliente-comunicacao requer revisao",
                process_id=communication.process_id,
                communication_id=communication.id,
                details={
                    "client_id": client.id,
                    "status": association.status,
                    "reason": association.reason,
                    "party_name": association.party_name,
                    "party_document": association.party_document,
                },
            )
        return existing

    async def _recalculate_client_processes(self, process_id: str) -> None:
        client_ids = (
            await self.session.execute(
                select(ClientProcess.client_id).where(
                    ClientProcess.process_id == process_id
                )
            )
        ).scalars().all()
        for client_id in client_ids:
            client = await self.session.get(Client, client_id)
            if client is None:
                continue
            client_process = (
                await self.session.execute(
                    select(ClientProcess).where(
                        ClientProcess.client_id == client_id,
                        ClientProcess.process_id == process_id,
                    )
                )
            ).scalar_one_or_none()
            if client_process is None:
                continue
            association_rows = (
                await self.session.execute(
                    select(
                        ClientCommunication.association_status,
                        ClientCommunication.match_reason,
                        Communication,
                    )
                    .join(
                        Communication,
                        Communication.id == ClientCommunication.communication_id,
                    )
                    .where(
                        ClientCommunication.client_id == client_id,
                        Communication.process_id == process_id,
                        ClientCommunication.association_status != ASSOCIATION_REJECTED,
                    )
                )
            ).all()
            if not association_rows:
                await self.session.delete(client_process)
                continue
            best_status = None
            recalculated_cpf_status = CPF_STATUS_ABSENT
            latest_date = None
            best_reason = None
            latest_polo = None
            for status, reason, communication in association_rows:
                next_status = merge_association_status(best_status, status)
                if next_status != best_status:
                    best_status = next_status
                    best_reason = reason
                association = self._classify_client_in_item(
                    client,
                    communication.raw_payload,
                )
                cpf_status, polo = self._cpf_status_for_association(
                    client,
                    communication.raw_payload,
                    association,
                )
                recalculated_cpf_status = merge_cpf_status(
                    recalculated_cpf_status,
                    cpf_status,
                )
                occurred_on = communication.data_disponibilizacao
                if latest_date is None or occurred_on > latest_date:
                    latest_date = occurred_on
                    latest_polo = polo
            client_process.communications_count = len(association_rows)
            client_process.last_movement_at = latest_date
            client_process.association_status = best_status or "uncertain"
            client_process.association_reason = best_reason
            client_process.cpf_status = recalculated_cpf_status
            client_process.polo = latest_polo

    async def _upsert_djen_event(self, communication: Communication) -> ProcessEvent:
        source_record_id = (
            str(communication.djen_id)
            if communication.djen_id is not None
            else communication.djen_hash or communication.source_fingerprint
        )
        source_event_id = f"djen:{source_record_id}"
        event = (
            await self.session.execute(
                select(ProcessEvent).where(
                    ProcessEvent.source == "DJEN",
                    ProcessEvent.source_event_id == source_event_id,
                )
            )
        ).scalar_one_or_none()
        occurred_at = datetime.combine(
            communication.data_disponibilizacao,
            datetime.min.time(),
            tzinfo=timezone.utc,
        )
        if event is None:
            event = ProcessEvent(
                process_id=communication.process_id,
                communication_id=communication.id,
                source="DJEN",
                source_record_id=source_record_id,
                source_event_id=source_event_id,
                event_type="publication",
                occurred_at=occurred_at,
                raw_payload=communication.raw_payload,
            )
            self.session.add(event)
        event.process_id = communication.process_id
        event.communication_id = communication.id
        event.source_record_id = source_record_id
        event.event_type = "publication"
        event.occurred_at = occurred_at
        event.tribunal = communication.sigla_tribunal
        event.degree = None
        event.process_class = communication.nome_classe
        event.agency = communication.nome_orgao
        event.title = communication.tipo_comunicacao or "Publicacao"
        event.text = communication.plain_text
        event.complements = []
        event.external_link = communication.external_link
        event.raw_payload = communication.raw_payload
        await self.session.flush()
        return event

    async def _record_audit_issue(
        self,
        *,
        issue_key: str,
        issue_type: str,
        severity: str,
        summary: str,
        details: dict[str, Any],
        status: str = "open",
        process_id: str | None = None,
        communication_id: str | None = None,
    ) -> ProcessAuditIssue:
        issue = (
            await self.session.execute(
                select(ProcessAuditIssue).where(
                    ProcessAuditIssue.issue_key == issue_key[:255]
                )
            )
        ).scalar_one_or_none()
        if issue is None:
            issue = ProcessAuditIssue(
                issue_key=issue_key[:255],
                issue_type=issue_type,
                severity=severity,
                status=status,
                summary=summary,
                details=details,
                process_id=process_id,
                communication_id=communication_id,
                resolved_at=datetime.now(timezone.utc) if status == "resolved" else None,
            )
            self.session.add(issue)
        else:
            issue.issue_type = issue_type
            issue.severity = severity
            issue.status = status
            issue.summary = summary
            issue.details = details
            issue.process_id = process_id or issue.process_id
            issue.communication_id = communication_id or issue.communication_id
            issue.resolved_at = (
                datetime.now(timezone.utc) if status == "resolved" else None
            )
        await self.session.flush()
        return issue

    async def _import_items_for_clients(self, clients: list[Client], items: list[dict[str, Any]]) -> int:
        imported = 0
        unique_clients = list({client.id: client for client in clients}.values())
        for index, client in enumerate(unique_clients):
            client_imported = await self.import_items(client, items)
            if index == 0:
                imported += client_imported
        return imported

    def _process_number_from_item(self, item: dict[str, Any]) -> str:
        raw_process_number = _to_str(
            get_first(item, "numero_processo", "numeroProcesso", "numeroprocessocommascara")
        )
        return normalize_process_number(raw_process_number)

    async def _maybe_enrich_process_with_datajud(self, process: Process, *, force: bool = False) -> bool:
        if not self.datajud_client or (not force and not self._should_refresh_datajud(process)):
            return False
        if not force and process.id in self._datajud_checked_process_ids:
            return False
        self._datajud_checked_process_ids.add(process.id)

        try:
            result = await self.datajud_client.fetch_process(
                process.numero_processo,
                tribunal=process.tribunal,
            )
        except Exception as exc:
            self._record_datajud_error(process, exc)
            await self.session.flush()
            return True

        await self._apply_datajud_result(process, result)
        await self.session.flush()
        return True

    def _should_refresh_datajud(self, process: Process) -> bool:
        if process.datajud_status == DATAJUD_STATUS_PENDING or process.datajud_synced_at is None:
            return True
        if self.datajud_refresh_hours <= 0:
            return True
        synced_at = process.datajud_synced_at
        if synced_at.tzinfo is None:
            synced_at = synced_at.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - synced_at >= timedelta(hours=self.datajud_refresh_hours)

    async def _apply_datajud_result(
        self,
        process: Process,
        result: DataJudSearchResult,
    ) -> None:
        process.datajud_alias = result.alias
        process.datajud_synced_at = datetime.now(timezone.utc)
        process.datajud_error = None
        process.datajud_hit_count = result.total

        all_hits = result.hits
        hits = tuple(
            hit
            for hit in all_hits
            if normalize_process_number(_to_str(hit.source.get("numeroProcesso")))
            == process.numero_processo
        )
        selected, selection_reason = select_datajud_hit(
            hits,
            expected_tribunal=process.tribunal,
        )

        persisted_sources: dict[str, ProcessSource] = {}
        exact_source_ids = {hit.source_id for hit in hits}
        for hit in all_hits:
            persisted_sources[hit.source_id] = await self._upsert_datajud_source(
                process,
                hit.alias or result.alias,
                hit,
                review_required=(
                    result.total > 1 or hit.source_id not in exact_source_ids
                ),
                include_events=hit.source_id in exact_source_ids,
            )
        all_datajud_sources = (
            await self.session.execute(
                select(ProcessSource).where(
                    ProcessSource.process_id == process.id,
                    ProcessSource.source == "DATAJUD",
                )
            )
        ).scalars().all()
        manually_selected = next(
            (
                source
                for source in all_datajud_sources
                if source.id == process.datajud_source_id
                and source.selection_reason == "user_selected"
                and source.source_record_id in exact_source_ids
            ),
            None,
        )
        if manually_selected is not None:
            selected = next(
                hit
                for hit in hits
                if hit.source_id == manually_selected.source_record_id
            )
            selection_reason = "user_selected_preserved"
        process.datajud_selection_reason = selection_reason
        for process_source in all_datajud_sources:
            process_source.selected_for_cover = (
                process_source.id == process.datajud_source_id
            )

        if selected is None:
            process.datajud_candidate_source_id = None
            if result.total > 0:
                process.datajud_status = DATAJUD_STATUS_NEEDS_REVIEW
                process.datajud_review_reason = (
                    "A consulta retornou registros, mas nenhum numero de processo "
                    "corresponde exatamente ao solicitado"
                )
                await self._record_audit_issue(
                    issue_key=f"datajud-number-conflict:{process.id}",
                    issue_type="datajud_process_number_conflict",
                    severity="critical",
                    summary="DataJud retornou hit sem igualdade exata do numero CNJ",
                    process_id=process.id,
                    details={
                        "numero_solicitado": process.numero_processo,
                        "hit_count": result.total,
                        "alias": result.alias,
                        "records": [
                            {
                                "source_record_id": hit.source_id,
                                "numero_processo": hit.source.get("numeroProcesso"),
                                "tribunal": hit.source.get("tribunal"),
                                "grau": hit.source.get("grau"),
                            }
                            for hit in all_hits
                        ],
                    },
                )
                return
            process.datajud_status = DATAJUD_STATUS_NOT_FOUND
            process.datajud_review_reason = None
            process.datajud_source_id = None
            process.datajud_payload = None
            process.datajud_subjects = []
            process.datajud_movements_count = 0
            return

        persisted_selected = persisted_sources[selected.source_id]
        process.datajud_candidate_source_id = persisted_selected.id
        is_ambiguous = (
            result.total > 1 or len(hits) > 1
        ) and manually_selected is None
        if is_ambiguous:
            for source in persisted_sources.values():
                source.selected_for_cover = source.id == process.datajud_source_id
                source.review_required = True
                source.selection_reason = selection_reason
            process.datajud_status = DATAJUD_STATUS_NEEDS_REVIEW
            process.datajud_review_reason = (
                f"DataJud retornou {result.total} hits ({len(hits)} com numero exato); "
                "a capa foi preservada ate revisao"
            )
            await self._record_audit_issue(
                issue_key=f"datajud-ambiguous:{process.id}",
                issue_type="datajud_multiple_hits",
                severity="high",
                summary="Multiplos hits DataJud exigem revisao antes de alterar a capa",
                process_id=process.id,
                details={
                    "numero_solicitado": process.numero_processo,
                    "hit_count": result.total,
                    "exact_hit_count": len(hits),
                    "candidate_source_record_id": selected.source_id,
                    "selection_reason": selection_reason,
                    "records": [
                        {
                            "source_record_id": hit.source_id,
                            "tribunal": hit.source.get("tribunal"),
                            "grau": hit.source.get("grau"),
                            "classe": datajud_object_name(hit.source.get("classe")),
                            "orgao": datajud_object_name(hit.source.get("orgaoJulgador")),
                        }
                        for hit in hits
                    ],
                },
            )
            logger.warning(
                "Sincronizacao DataJud requer revisao process_id=%s numero_solicitado=%s "
                "hit_count=%s exact_hit_count=%s candidato=%s grau=%s classe=%s orgao=%s",
                process.id,
                process.numero_processo,
                result.total,
                len(hits),
                selected.source_id,
                selected.source.get("grau"),
                datajud_object_name(selected.source.get("classe")),
                datajud_object_name(selected.source.get("orgaoJulgador")),
            )
            return

        source = selected.source
        for stored_source in all_datajud_sources:
            stored_source.selected_for_cover = False
        process.datajud_source_id = persisted_selected.id
        persisted_selected.selected_for_cover = True
        persisted_selected.review_required = False
        persisted_selected.selection_reason = (
            "user_selected" if manually_selected is not None else selection_reason
        )
        if manually_selected is not None:
            for stored_source in all_datajud_sources:
                stored_source.review_required = False
        process.datajud_status = DATAJUD_STATUS_SYNCED
        process.datajud_review_reason = None
        process.datajud_payload = source
        process.tribunal = _to_str(source.get("tribunal")) or process.tribunal
        process.process_class = datajud_object_name(source.get("classe")) or process.process_class
        process.agency = datajud_object_name(source.get("orgaoJulgador")) or process.agency
        process.datajud_source_updated_at = parse_datajud_datetime(
            source.get("dataHoraUltimaAtualizacao")
        )
        process.datajud_last_movement_at = latest_datajud_movement_datetime(source)
        process.datajud_filed_at = parse_datajud_datetime(source.get("dataAjuizamento"))
        process.datajud_degree = _to_str(source.get("grau"))
        process.datajud_secrecy_level = _to_int(source.get("nivelSigilo"))
        process.datajud_system = datajud_object_name(source.get("sistema"))
        process.datajud_format = datajud_object_name(source.get("formato"))
        subjects = source.get("assuntos")
        process.datajud_subjects = subjects if isinstance(subjects, list) else []
        movements = source.get("movimentos")
        process.datajud_movements_count = len(movements) if isinstance(movements, list) else 0
        logger.info(
            "Sincronizacao DataJud concluida process_id=%s numero_solicitado=%s "
            "numero_retornado=%s hit_escolhido=%s grau=%s classe=%s orgao=%s motivo=%s",
            process.id,
            process.numero_processo,
            source.get("numeroProcesso"),
            selected.source_id,
            source.get("grau"),
            datajud_object_name(source.get("classe")),
            datajud_object_name(source.get("orgaoJulgador")),
            selection_reason,
        )

    async def _upsert_datajud_source(
        self,
        process: Process,
        alias: str | None,
        hit: DataJudHit,
        *,
        review_required: bool,
        include_events: bool,
    ) -> ProcessSource:
        source = hit.source
        process_source = (
            await self.session.execute(
                select(ProcessSource).where(
                    ProcessSource.process_id == process.id,
                    ProcessSource.source == "DATAJUD",
                    ProcessSource.source_record_id == hit.source_id,
                )
            )
        ).scalar_one_or_none()
        if process_source is None:
            process_source = ProcessSource(
                process_id=process.id,
                source="DATAJUD",
                source_record_id=hit.source_id,
                numero_processo=process.numero_processo,
                raw_payload=source,
            )
            self.session.add(process_source)
            await self.session.flush()
        process_source.source_alias = alias
        process_source.numero_processo = normalize_process_number(
            _to_str(source.get("numeroProcesso"))
        )
        process_source.tribunal = _to_str(source.get("tribunal"))
        process_source.degree = _to_str(source.get("grau"))
        process_source.process_class = datajud_object_name(source.get("classe"))
        process_source.agency = datajud_object_name(source.get("orgaoJulgador"))
        process_source.source_updated_at = parse_datajud_datetime(
            source.get("dataHoraUltimaAtualizacao")
        )
        process_source.filed_at = parse_datajud_datetime(source.get("dataAjuizamento"))
        process_source.review_required = review_required
        process_source.raw_payload = source

        payload_text = json.dumps(source, ensure_ascii=False, sort_keys=True, default=str)
        payload_hash = hashlib.sha256(payload_text.encode("utf-8")).hexdigest()
        snapshot = (
            await self.session.execute(
                select(SourceSnapshot).where(
                    SourceSnapshot.process_source_id == process_source.id,
                    SourceSnapshot.payload_hash == payload_hash,
                )
            )
        ).scalar_one_or_none()
        if snapshot is None:
            self.session.add(
                SourceSnapshot(
                    process_id=process.id,
                    process_source_id=process_source.id,
                    source="DATAJUD",
                    source_record_id=hit.source_id,
                    payload_hash=payload_hash,
                    payload=source,
                    collected_at=datetime.now(timezone.utc),
                )
            )
        if include_events:
            await self._replace_datajud_events(process, process_source, source)
        else:
            await self.session.execute(
                delete(ProcessEvent).where(
                    ProcessEvent.process_source_id == process_source.id,
                    ProcessEvent.source == "DATAJUD",
                )
            )
        return process_source

    async def _replace_datajud_events(
        self,
        process: Process,
        process_source: ProcessSource,
        source: dict[str, Any],
    ) -> None:
        raw_movements = source.get("movimentos")
        if not isinstance(raw_movements, list):
            raw_movements = []
        retained_event_ids: set[str] = set()
        fallback_at = (
            parse_datajud_datetime(source.get("dataHoraUltimaAtualizacao"))
            or parse_datajud_datetime(source.get("dataAjuizamento"))
            or process.created_at
            or datetime(1970, 1, 1, tzinfo=timezone.utc)
        )
        if fallback_at.tzinfo is None:
            fallback_at = fallback_at.replace(tzinfo=timezone.utc)
        seen_hashes: dict[str, int] = {}
        for raw_movement in raw_movements:
            if not isinstance(raw_movement, dict):
                continue
            normalized_items = datajud_movements({"movimentos": [raw_movement]})
            if not normalized_items:
                continue
            movement = normalized_items[0]
            canonical = json.dumps(
                raw_movement,
                ensure_ascii=False,
                sort_keys=True,
                default=str,
            )
            movement_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
            occurrence = seen_hashes.get(movement_hash, 0) + 1
            seen_hashes[movement_hash] = occurrence
            source_event_id = (
                f"datajud:{process_source.source_record_id}:"
                f"{movement_hash}:{occurrence}"
            )
            retained_event_ids.add(source_event_id)
            event = (
                await self.session.execute(
                    select(ProcessEvent).where(
                        ProcessEvent.source == "DATAJUD",
                        ProcessEvent.source_event_id == source_event_id,
                    )
                )
            ).scalar_one_or_none()
            if event is None:
                event = ProcessEvent(
                    process_id=process.id,
                    process_source_id=process_source.id,
                    source="DATAJUD",
                    source_record_id=process_source.source_record_id,
                    source_event_id=source_event_id,
                    event_type="procedural_movement",
                    occurred_at=movement.get("data_hora") or fallback_at,
                    raw_payload=raw_movement,
                )
                self.session.add(event)
            event.process_id = process.id
            event.process_source_id = process_source.id
            event.source_record_id = process_source.source_record_id
            event.event_type = "procedural_movement"
            event.occurred_at = movement.get("data_hora") or fallback_at
            event.tribunal = process_source.tribunal
            event.degree = process_source.degree
            event.process_class = process_source.process_class
            event.agency = (
                _to_str(movement.get("orgao_julgador"))
                or process_source.agency
            )
            event.title = _to_str(movement.get("nome")) or "Movimento processual"
            event.text = _to_str(movement.get("nome")) or ""
            event.complements = movement.get("complementos") or []
            event.external_link = None
            event.raw_payload = raw_movement
        stale_statement = delete(ProcessEvent).where(
            ProcessEvent.process_source_id == process_source.id,
            ProcessEvent.source == "DATAJUD",
        )
        if retained_event_ids:
            stale_statement = stale_statement.where(
                ProcessEvent.source_event_id.not_in(retained_event_ids)
            )
        await self.session.execute(stale_statement)

    def _record_datajud_error(self, process: Process, exc: Exception) -> None:
        process.datajud_status = DATAJUD_STATUS_ERROR
        process.datajud_synced_at = datetime.now(timezone.utc)
        process.datajud_error = _sanitize_datajud_error(exc)


async def process_next_queued_run(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    djen_client: DjenClient | None = None,
    datajud_client: DataJudClient | None = None,
    sleep: SleepFunc = asyncio.sleep,
    worker_id: str | None = None,
) -> bool:
    async with session_factory() as session:
        run_id = await _claim_next_queued_run(session)
        if run_id is None:
            await _mark_worker_idle(session, worker_id)
            return False
        await _mark_worker_working(session, worker_id, run_id)
        settings = get_settings()
        client = djen_client or DjenClient(settings.djen_base_url)
        datajud = datajud_client
        if datajud is None and settings.datajud_api_key:
            datajud = DataJudClient(
                settings.datajud_base_url,
                settings.datajud_api_key,
                timeout=settings.datajud_timeout_seconds,
            )
        importer = DjenImporter(session, client, datajud_client=datajud, sleep=sleep)
        await importer.process_run(run_id)
        await _mark_worker_idle(session, worker_id, processed_run=True)
        return True


def _queued_run_query() -> Select[tuple[SearchRun]]:
    return (
        select(SearchRun)
        .where(SearchRun.status == "queued")
        .order_by(SearchRun.created_at.asc(), SearchRun.id.asc())
        .limit(1)
    )


async def _claim_next_queued_run(session: AsyncSession) -> str | None:
    statement = _queued_run_query().with_for_update(skip_locked=True)
    result = await session.execute(statement)
    run = result.scalar_one_or_none()
    if run is None:
        return None
    run.status = "running"
    run.started_at = run.started_at or datetime.now(timezone.utc)
    run.error_message = None
    await session.commit()
    return run.id


async def _mark_worker_working(
    session: AsyncSession,
    worker_id: str | None,
    run_id: str,
) -> None:
    if not worker_id:
        return
    worker = await session.get(WorkerInstance, worker_id)
    if not worker:
        return
    worker.status = "working"
    worker.current_run_id = run_id
    worker.heartbeat_at = datetime.now(timezone.utc)
    worker.last_error = None
    await session.commit()


async def _mark_worker_idle(
    session: AsyncSession,
    worker_id: str | None,
    *,
    processed_run: bool = False,
) -> None:
    if not worker_id:
        return
    worker = await session.get(WorkerInstance, worker_id)
    if not worker:
        return
    worker.status = "idle"
    worker.current_run_id = None
    worker.heartbeat_at = datetime.now(timezone.utc)
    worker.last_error = None
    if processed_run:
        worker.processed_runs += 1
    await session.commit()


def _to_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _to_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _sanitize_datajud_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    message = message.replace("DataJud", "Fonte complementar").replace(
        "DJEN", "fonte de movimentacoes"
    )
    return message[:512]
