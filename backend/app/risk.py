from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Communication, CommunicationRiskMatch, RiskKeyword
from app.utils import normalize_name

RISK_LEVELS = {"baixo", "medio", "alto", "critico"}
RISK_LEVEL_ORDER = {"baixo": 1, "medio": 2, "alto": 3, "critico": 4}


@dataclass(frozen=True)
class RiskReprocessResult:
    scanned_communications: int
    matched_communications: int
    matches_created: int


async def classify_communication_risk(
    session: AsyncSession,
    communication_id: str,
    *,
    keywords: list[RiskKeyword] | None = None,
    clear_existing: bool = True,
) -> int:
    communication = await _get_communication(session, communication_id)
    if communication is None:
        return 0

    if clear_existing:
        await session.execute(
            delete(CommunicationRiskMatch).where(
                CommunicationRiskMatch.communication_id == communication_id
            )
        )
        await session.flush()

    active_keywords = keywords if keywords is not None else await list_active_risk_keywords(session)
    matches = _match_communication(communication, active_keywords)
    session.add_all(matches)
    await session.flush()
    return len(matches)


async def reprocess_all_risk_matches(session: AsyncSession) -> RiskReprocessResult:
    await session.execute(delete(CommunicationRiskMatch))
    await session.flush()

    communication_ids = (await session.execute(select(Communication.id))).scalars().all()
    keywords = await list_active_risk_keywords(session)
    matches_created = 0
    matched_communications = 0
    for communication_id in communication_ids:
        count = await classify_communication_risk(
            session,
            communication_id,
            keywords=keywords,
            clear_existing=False,
        )
        matches_created += count
        if count:
            matched_communications += 1

    return RiskReprocessResult(
        scanned_communications=len(communication_ids),
        matched_communications=matched_communications,
        matches_created=matches_created,
    )


async def list_active_risk_keywords(session: AsyncSession) -> list[RiskKeyword]:
    result = await session.execute(
        select(RiskKeyword)
        .where(RiskKeyword.active.is_(True))
        .order_by(RiskKeyword.category.asc(), RiskKeyword.term.asc())
    )
    return list(result.scalars().all())


async def risk_keyword_match_counts(session: AsyncSession) -> dict[str, int]:
    result = await session.execute(
        select(
            CommunicationRiskMatch.risk_keyword_id,
            func.count(CommunicationRiskMatch.id),
        ).group_by(CommunicationRiskMatch.risk_keyword_id)
    )
    return {keyword_id: int(count) for keyword_id, count in result.all()}


def normalize_risk_term(value: str) -> str:
    return normalize_name(value)


def validate_risk_level(value: str) -> str:
    normalized = normalize_name(value).lower()
    if normalized not in RISK_LEVELS:
        raise ValueError("Nivel de risco invalido")
    return normalized


async def _get_communication(session: AsyncSession, communication_id: str) -> Communication | None:
    result = await session.execute(
        select(Communication)
        .where(Communication.id == communication_id)
        .options(
            selectinload(Communication.parties),
            selectinload(Communication.risk_matches).selectinload(CommunicationRiskMatch.keyword),
        )
    )
    return result.scalar_one_or_none()


def _match_communication(
    communication: Communication,
    keywords: list[RiskKeyword],
) -> list[CommunicationRiskMatch]:
    sources = _communication_sources(communication)
    matches: list[CommunicationRiskMatch] = []
    seen: set[tuple[str, str]] = set()
    for keyword in keywords:
        if not keyword.active:
            continue
        term = keyword.normalized_term or normalize_risk_term(keyword.term)
        if not term:
            continue
        for source_name, source_text in sources:
            match = _find_term(source_text, term)
            if match is None:
                continue
            key = (keyword.id, source_name)
            if key in seen:
                continue
            seen.add(key)
            start, end = match
            matches.append(
                CommunicationRiskMatch(
                    communication_id=communication.id,
                    risk_keyword_id=keyword.id,
                    source=source_name,
                    matched_text=source_text[start:end].strip() or keyword.term,
                    excerpt=_excerpt(source_text, start, end),
                )
            )
    return matches


def _communication_sources(communication: Communication) -> list[tuple[str, str]]:
    sources = [
        ("texto", communication.plain_text),
        (
            "metadados",
            " ".join(
                item
                for item in (
                    communication.tipo_comunicacao,
                    communication.nome_orgao,
                    communication.nome_classe,
                    communication.sigla_tribunal,
                )
                if item
            ),
        ),
        (
            "partes",
            " ".join(party.name for party in communication.parties if party.name),
        ),
    ]
    return [(source, text) for source, text in sources if text]


def _find_term(source_text: str, normalized_term: str) -> tuple[int, int] | None:
    normalized_source, positions = _normalize_with_positions(source_text)
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
