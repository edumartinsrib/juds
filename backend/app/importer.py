from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.datajud import (
    DATAJUD_STATUS_ERROR,
    DATAJUD_STATUS_NOT_FOUND,
    DATAJUD_STATUS_PENDING,
    DATAJUD_STATUS_SYNCED,
    DataJudClient,
    DataJudSearchResult,
    datajud_object_name,
    latest_datajud_movement_datetime,
    parse_datajud_datetime,
)
from app.djen import DjenClient, DjenPage, DjenRateLimitError
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
from app.utils import (
    CPF_STATUS_ABSENT,
    classify_party_cpf,
    djen_fingerprint,
    format_process_number,
    get_first,
    html_to_text,
    merge_cpf_status,
    normalize_cpf,
    normalize_document,
    normalize_name,
    normalize_process_number,
    parse_djen_date,
    party_matches_client,
)

SleepFunc = Callable[[float], Awaitable[None]]


def default_search_window() -> tuple[date, date]:
    settings = get_settings()
    end_date = date.today()
    start_date = end_date - timedelta(days=max(settings.search_window_days - 1, 0))
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
                        run.error_message = "Rate limit do DJEN; retomando apos pausa."
                        await self.session.commit()
                        await self.sleep(self.rate_limit_sleep_seconds)
                        continue

                    self._record_rate_limit(run, djen_page)
                    imported = await self.import_items(client, djen_page.items)
                    run.total_imported = (run.total_imported or 0) + imported
                    await self.session.commit()

                    if len(djen_page.items) < 100 or page * 100 >= djen_page.count:
                        break
                    page += 1
                    run.current_page = page

                cursor += timedelta(days=1)
                page = 1

            run.status = "completed"
            run.current_date = run.end_date
            run.current_page = 1
            run.finished_at = datetime.now(timezone.utc)
            await self.session.commit()
            await self.session.refresh(run)
            return run
        except Exception as exc:
            run.status = "failed"
            run.error_message = str(exc)
            run.finished_at = datetime.now(timezone.utc)
            await self.session.commit()
            raise

    def _record_rate_limit(self, run: SearchRun, page: DjenPage) -> None:
        run.rate_limit_limit = page.rate_limit_limit
        run.rate_limit_remaining = page.rate_limit_remaining

    async def import_items(self, client: Client, items: list[dict[str, Any]]) -> int:
        imported = 0
        for item in items:
            communication = await self._find_existing_communication(item)
            if communication:
                process = await self.session.get(Process, communication.process_id)
                if process:
                    await self._maybe_enrich_process_with_datajud(process)
                continue
            await self._create_communication(client, item)
            imported += 1
        return imported

    async def _find_existing_communication(self, item: dict[str, Any]) -> Communication | None:
        djen_id = _to_int(get_first(item, "id", "numeroComunicacao"))
        djen_hash = _to_str(get_first(item, "hash"))
        fingerprint = djen_fingerprint(item)
        filters = [Communication.source_fingerprint == fingerprint]
        if djen_id is not None:
            filters.append(Communication.djen_id == djen_id)
        if djen_hash:
            filters.append(Communication.djen_hash == djen_hash)
        result = await self.session.execute(select(Communication).where(or_(*filters)))
        return result.scalar_one_or_none()

    async def _create_communication(self, client: Client, item: dict[str, Any]) -> Communication:
        process_number = self._process_number_from_item(item)
        if not process_number:
            raise ValueError("Comunicacao do DJEN sem numero de processo")

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

        cpf_status, polo = await self._create_parties(client, communication, item)
        await self._create_lawyers(communication, item)
        await self._upsert_client_process(client, process, movement_date, cpf_status, polo)
        await self.session.flush()
        return communication

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

        process.tribunal = process.tribunal or _to_str(get_first(item, "siglaTribunal", "sigla_tribunal"))
        process.process_class = process.process_class or _to_str(get_first(item, "nomeClasse", "nome_classe"))
        process.agency = process.agency or _to_str(get_first(item, "nomeOrgao", "orgao"))
        process.external_link = process.external_link or _to_str(get_first(item, "link"))
        if process.last_communication_at is None or movement_date > process.last_communication_at:
            process.last_communication_at = movement_date
        return process

    async def _create_parties(
        self, client: Client, communication: Communication, item: dict[str, Any]
    ) -> tuple[str, str | None]:
        parties = item.get("destinatarios") or []
        status = CPF_STATUS_ABSENT
        matched_polo: str | None = None

        for party in parties:
            name = _to_str(get_first(party, "nome", "nomeParte", "nome_parte")) or ""
            if not name:
                continue
            cpf_cnpj = normalize_document(
                _to_str(get_first(party, "cpf_cnpj", "cpfCnpj", "documento", "cpf"))
            )
            is_match = party_matches_client(client.name, name)
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

    async def _create_lawyers(self, communication: Communication, item: dict[str, Any]) -> None:
        raw_lawyers = item.get("destinatarioadvogados") or item.get("advogados") or []
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
    ) -> ClientProcess:
        result = await self.session.execute(
            select(ClientProcess).where(
                ClientProcess.client_id == client.id,
                ClientProcess.process_id == process.id,
            )
        )
        client_process = result.scalar_one_or_none()
        if client_process is None:
            client_process = ClientProcess(
                client_id=client.id,
                process_id=process.id,
                cpf_status=cpf_status,
                polo=polo,
                communications_count=1,
                last_movement_at=movement_date,
            )
            self.session.add(client_process)
            return client_process

        client_process.cpf_status = merge_cpf_status(client_process.cpf_status, cpf_status)
        client_process.polo = client_process.polo or polo
        client_process.communications_count += 1
        if client_process.last_movement_at is None or movement_date > client_process.last_movement_at:
            client_process.last_movement_at = movement_date
        return client_process

    def _process_number_from_item(self, item: dict[str, Any]) -> str:
        raw_process_number = _to_str(
            get_first(item, "numero_processo", "numeroProcesso", "numeroprocessocommascara")
        )
        return normalize_process_number(raw_process_number)

    async def _maybe_enrich_process_with_datajud(self, process: Process) -> None:
        if not self.datajud_client or not self._should_refresh_datajud(process):
            return
        if process.id in self._datajud_checked_process_ids:
            return
        self._datajud_checked_process_ids.add(process.id)

        try:
            result = await self.datajud_client.fetch_process(
                process.numero_processo,
                tribunal=process.tribunal,
            )
        except Exception as exc:
            self._record_datajud_error(process, exc)
            await self.session.flush()
            return

        self._apply_datajud_result(process, result)
        await self.session.flush()

    def _should_refresh_datajud(self, process: Process) -> bool:
        if process.datajud_status == DATAJUD_STATUS_PENDING or process.datajud_synced_at is None:
            return True
        if self.datajud_refresh_hours <= 0:
            return True
        synced_at = process.datajud_synced_at
        if synced_at.tzinfo is None:
            synced_at = synced_at.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - synced_at >= timedelta(hours=self.datajud_refresh_hours)

    def _apply_datajud_result(self, process: Process, result: DataJudSearchResult) -> None:
        process.datajud_alias = result.alias
        process.datajud_synced_at = datetime.now(timezone.utc)
        process.datajud_error = None

        source = result.source
        if not source:
            process.datajud_status = DATAJUD_STATUS_NOT_FOUND
            process.datajud_payload = None
            process.datajud_subjects = []
            process.datajud_movements_count = 0
            return

        process.datajud_status = DATAJUD_STATUS_SYNCED
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
) -> bool:
    async with session_factory() as session:
        result = await session.execute(_queued_run_query())
        run = result.scalar_one_or_none()
        if run is None:
            return False
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
        await importer.process_run(run.id)
        return True


def _queued_run_query() -> Select[tuple[SearchRun]]:
    return (
        select(SearchRun)
        .where(SearchRun.status == "queued")
        .order_by(SearchRun.created_at.asc(), SearchRun.id.asc())
        .limit(1)
    )


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
    return message[:512]
