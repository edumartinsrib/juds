from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, time, timezone
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.datajud import datajud_movements, datajud_subject_names
from app.models import Communication, Process, ProcessPhaseKeyword
from app.utils import normalize_name


@dataclass(frozen=True)
class PhaseMatch:
    keyword_id: str
    phase_key: str
    phase_name: str
    phase_order: int
    keyword: str
    source: str
    matched_text: str
    excerpt: str
    occurred_at: datetime | None


DEFAULT_EXECUTION_PHASE_KEYWORDS: tuple[dict[str, object], ...] = (
    {
        "phase_name": "Peticao inicial e distribuicao",
        "phase_order": 10,
        "terms": (
            "peticao inicial",
            "distribuicao",
            "distribuido",
            "autuacao",
            "ajuizamento",
        ),
    },
    {
        "phase_name": "Citacao e intimacao",
        "phase_order": 20,
        "terms": (
            "citacao",
            "cite-se",
            "mandado de citacao",
            "aviso de recebimento",
            "intimacao",
        ),
    },
    {
        "phase_name": "Defesa e embargos",
        "phase_order": 30,
        "terms": (
            "embargos a execucao",
            "excecao de pre-executividade",
            "impugnacao",
            "contestacao",
            "manifestacao do executado",
        ),
    },
    {
        "phase_name": "Decisoes e despachos",
        "phase_order": 40,
        "terms": (
            "decisao",
            "despacho",
            "conclusao",
            "conclusos para decisao",
            "deferido",
            "indeferido",
        ),
    },
    {
        "phase_name": "Penhora e constricao",
        "phase_order": 50,
        "terms": (
            "penhora",
            "bloqueio sisbajud",
            "sisbajud",
            "renajud",
            "arresto",
            "indisponibilidade",
        ),
    },
    {
        "phase_name": "Avaliacao e expropriacao",
        "phase_order": 60,
        "terms": (
            "avaliacao",
            "leilao",
            "praca",
            "hasta publica",
            "adjudicacao",
            "alienacao judicial",
        ),
    },
    {
        "phase_name": "Acordo e pagamento",
        "phase_order": 70,
        "terms": (
            "acordo",
            "pagamento",
            "parcelamento",
            "comprovante de pagamento",
            "satisfacao do debito",
        ),
    },
    {
        "phase_name": "Recursos",
        "phase_order": 80,
        "terms": (
            "agravo de instrumento",
            "apelacao",
            "embargos de declaracao",
            "recurso especial",
            "recurso extraordinario",
        ),
    },
    {
        "phase_name": "Sentenca e encerramento",
        "phase_order": 90,
        "terms": (
            "sentenca",
            "extincao da execucao",
            "extinto",
            "arquivamento",
            "baixa definitiva",
        ),
    },
)

MAX_DATAJUD_PHASE_MOVEMENTS = 80
MAX_DATAJUD_COUNT_MOVEMENTS = 20


async def ensure_default_phase_keywords(session: AsyncSession) -> None:
    count = await session.scalar(select(func.count(ProcessPhaseKeyword.id)))
    if count:
        return
    session.add_all(_default_keyword_models())
    await session.commit()


async def restore_default_phase_keywords(session: AsyncSession) -> list[ProcessPhaseKeyword]:
    await ensure_default_phase_keywords(session)
    existing = {
        (keyword.phase_key, keyword.normalized_term): keyword
        for keyword in (
            await session.execute(select(ProcessPhaseKeyword))
        ).scalars().all()
    }
    for default_keyword in _default_keyword_models():
        key = (default_keyword.phase_key, default_keyword.normalized_term)
        current = existing.get(key)
        if current:
            current.phase_name = default_keyword.phase_name
            current.phase_order = default_keyword.phase_order
            current.term = default_keyword.term
            current.description = default_keyword.description
            current.active = True
            current.is_default = True
        else:
            session.add(default_keyword)
    await session.commit()
    return await list_phase_keywords(session)


async def list_phase_keywords(session: AsyncSession) -> list[ProcessPhaseKeyword]:
    await ensure_default_phase_keywords(session)
    result = await session.execute(
        select(ProcessPhaseKeyword).order_by(
            ProcessPhaseKeyword.phase_order.asc(),
            ProcessPhaseKeyword.phase_name.asc(),
            ProcessPhaseKeyword.term.asc(),
        )
    )
    return list(result.scalars().all())


async def list_active_phase_keywords(session: AsyncSession) -> list[ProcessPhaseKeyword]:
    await ensure_default_phase_keywords(session)
    result = await session.execute(
        select(ProcessPhaseKeyword)
        .where(ProcessPhaseKeyword.active.is_(True))
        .order_by(
            ProcessPhaseKeyword.phase_order.asc(),
            ProcessPhaseKeyword.phase_name.asc(),
            ProcessPhaseKeyword.term.asc(),
        )
    )
    return list(result.scalars().all())


async def phase_keyword_match_counts(session: AsyncSession) -> dict[str, int]:
    keywords = await list_active_phase_keywords(session)
    counts = {keyword.id: 0 for keyword in keywords}

    communications = (
        await session.execute(select(Communication).options(selectinload(Communication.parties)))
    ).scalars().all()
    for communication in communications:
        for match in classify_communication_phases(communication, keywords):
            counts[match.keyword_id] = counts.get(match.keyword_id, 0) + 1

    processes = (await session.execute(select(Process))).scalars().all()
    for process in processes:
        for match in classify_process_datajud_phases(
            process,
            keywords,
            movement_limit=MAX_DATAJUD_COUNT_MOVEMENTS,
        ):
            counts[match.keyword_id] = counts.get(match.keyword_id, 0) + 1

    return counts


def classify_process_phases(
    process: Process,
    keywords: Iterable[ProcessPhaseKeyword],
    *,
    movement_limit: int = MAX_DATAJUD_PHASE_MOVEMENTS,
) -> list[PhaseMatch]:
    matches: list[PhaseMatch] = []
    for communication in process.communications:
        matches.extend(classify_communication_phases(communication, keywords))
    matches.extend(classify_process_datajud_phases(process, keywords, movement_limit=movement_limit))
    return sorted(matches, key=_phase_match_sort_key, reverse=True)


def classify_communication_phases(
    communication: Communication,
    keywords: Iterable[ProcessPhaseKeyword],
) -> list[PhaseMatch]:
    occurred_at = datetime.combine(
        communication.data_disponibilizacao,
        time.min,
        tzinfo=timezone.utc,
    )
    metadata = " ".join(
        item
        for item in (
            communication.tipo_comunicacao,
            communication.nome_orgao,
            communication.nome_classe,
            communication.sigla_tribunal,
        )
        if item
    )
    parties = " ".join(party.name for party in communication.parties if party.name)
    return _match_sources(
        keywords,
        (
            ("djen_texto", communication.plain_text, occurred_at),
            ("djen_metadados", metadata, occurred_at),
            ("djen_partes", parties, occurred_at),
        ),
    )


def classify_process_datajud_phases(
    process: Process,
    keywords: Iterable[ProcessPhaseKeyword],
    *,
    movement_limit: int = MAX_DATAJUD_PHASE_MOVEMENTS,
) -> list[PhaseMatch]:
    sources: list[tuple[str, str, datetime | None]] = []
    for movement in datajud_movements(process.datajud_payload)[:movement_limit]:
        text = " ".join(
            item
            for item in (
                movement.get("nome"),
                movement.get("orgao_julgador"),
                *(movement.get("complementos") or []),
            )
            if item
        )
        sources.append(("datajud_movimento", text, movement.get("data_hora")))

    metadata = " ".join(
        item
        for item in (
            process.process_class,
            process.agency,
            *(datajud_subject_names(process.datajud_payload)),
        )
        if item
    )
    sources.append(
        (
            "datajud_metadados",
            metadata,
            process.datajud_source_updated_at or process.datajud_last_movement_at,
        )
    )
    return _match_sources(keywords, sources)


def current_phase_match(matches: list[PhaseMatch]) -> PhaseMatch | None:
    return matches[0] if matches else None


def normalize_phase_term(value: str) -> str:
    return normalize_name(value)


def phase_key_from_name(value: str) -> str:
    normalized = normalize_name(value).lower()
    key = re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")
    return key[:80] or "fase"


def _default_keyword_models() -> list[ProcessPhaseKeyword]:
    defaults: list[ProcessPhaseKeyword] = []
    for phase in DEFAULT_EXECUTION_PHASE_KEYWORDS:
        phase_name = str(phase["phase_name"])
        phase_order = int(phase["phase_order"])
        phase_key = phase_key_from_name(phase_name)
        for term in phase["terms"]:
            term_text = str(term)
            defaults.append(
                ProcessPhaseKeyword(
                    phase_key=phase_key,
                    phase_name=phase_name,
                    phase_order=phase_order,
                    term=term_text,
                    normalized_term=normalize_phase_term(term_text),
                    description="Padrao para processos de execucao",
                    active=True,
                    is_default=True,
                )
            )
    return defaults


def _match_sources(
    keywords: Iterable[ProcessPhaseKeyword],
    sources: Iterable[tuple[str, str | None, datetime | None]],
) -> list[PhaseMatch]:
    matches: list[PhaseMatch] = []
    seen: set[tuple[str, str, datetime | None]] = set()
    prepared_sources = [
        (source, source_text, occurred_at, *_normalize_with_positions(source_text))
        for source, source_text, occurred_at in sources
        if source_text
    ]
    for keyword in keywords:
        if not keyword.active:
            continue
        normalized_term = keyword.normalized_term or normalize_phase_term(keyword.term)
        if not normalized_term:
            continue
        for source, source_text, occurred_at, normalized_source, positions in prepared_sources:
            match = _find_normalized_term(normalized_source, positions, normalized_term)
            if match is None:
                continue
            key = (keyword.id, source, occurred_at)
            if key in seen:
                continue
            seen.add(key)
            start, end = match
            matches.append(
                PhaseMatch(
                    keyword_id=keyword.id,
                    phase_key=keyword.phase_key,
                    phase_name=keyword.phase_name,
                    phase_order=keyword.phase_order,
                    keyword=keyword.term,
                    source=source,
                    matched_text=source_text[start:end].strip() or keyword.term,
                    excerpt=_excerpt(source_text, start, end),
                    occurred_at=occurred_at,
                )
            )
    return matches


def _phase_match_sort_key(match: PhaseMatch) -> tuple[datetime, int, str, str]:
    occurred_at = match.occurred_at or datetime.min.replace(tzinfo=timezone.utc)
    return (occurred_at, match.phase_order, match.phase_name, match.keyword)


def _find_term(source_text: str, normalized_term: str) -> tuple[int, int] | None:
    normalized_source, positions = _normalize_with_positions(source_text)
    return _find_normalized_term(normalized_source, positions, normalized_term)


def _find_normalized_term(
    normalized_source: str,
    positions: list[int],
    normalized_term: str,
) -> tuple[int, int] | None:
    if not normalized_source:
        return None

    start = 0
    while True:
        normalized_index = normalized_source.find(normalized_term, start)
        if normalized_index < 0:
            return None
        end_index = normalized_index + len(normalized_term)
        if _has_token_boundaries(normalized_source, normalized_index, end_index):
            return positions[normalized_index], positions[end_index - 1] + 1
        start = normalized_index + 1


def _normalize_with_positions(value: str) -> tuple[str, list[int]]:
    chars: list[str] = []
    positions: list[int] = []
    for index, char in enumerate(value):
        normalized = _normalize_char(char)
        if not normalized:
            continue
        for output_char in normalized:
            chars.append(output_char)
            positions.append(index)
    return "".join(chars), positions


def _normalize_char(value: str) -> str:
    if value.isspace():
        return " "
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch)).upper()


def _has_token_boundaries(value: str, start: int, end: int) -> bool:
    before = value[start - 1] if start > 0 else ""
    after = value[end] if end < len(value) else ""
    return not _is_token_char(before) and not _is_token_char(after)


def _is_token_char(value: str) -> bool:
    return bool(value) and (value.isalnum() or value == "_")


def _excerpt(source_text: str, start: int, end: int, radius: int = 90) -> str:
    excerpt_start = max(0, start - radius)
    excerpt_end = min(len(source_text), end + radius)
    prefix = "..." if excerpt_start > 0 else ""
    suffix = "..." if excerpt_end < len(source_text) else ""
    return f"{prefix}{source_text[excerpt_start:excerpt_end].strip()}{suffix}"
