from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from html import unescape
from typing import Any

from bs4 import BeautifulSoup

CPF_STATUS_ABSENT = "ausente_no_djen"
CPF_STATUS_PRESENT = "presente_no_djen"
CPF_STATUS_DIVERGENT = "cpf_divergente"

ASSOCIATION_CONFIRMED = "confirmed"
ASSOCIATION_PROBABLE = "probable"
ASSOCIATION_UNCERTAIN = "uncertain"
ASSOCIATION_REJECTED = "rejected"


@dataclass(frozen=True)
class ClientAssociationMatch:
    status: str
    reason: str
    party_name: str | None
    party_document: str | None
    polo: str | None


def only_digits(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def normalize_name(value: str) -> str:
    compact = " ".join((value or "").strip().split())
    normalized = unicodedata.normalize("NFKD", compact)
    ascii_text = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return ascii_text.upper()


def normalize_cpf(value: str | None) -> str | None:
    digits = only_digits(value)
    if not digits:
        return None
    if len(digits) != 11:
        raise ValueError("CPF deve conter 11 digitos")
    return digits


def mask_cpf(value: str | None) -> str | None:
    digits = normalize_cpf(value) if value else None
    if not digits:
        return None
    return f"{digits[:3]}.***.***-{digits[-2:]}"


def normalize_process_number(value: str | None) -> str:
    return only_digits(value)


def format_process_number(value: str | None) -> str:
    digits = normalize_process_number(value)
    if len(digits) != 20:
        return digits or (value or "")
    return (
        f"{digits[:7]}-{digits[7:9]}."
        f"{digits[9:13]}.{digits[13:14]}.{digits[14:16]}.{digits[16:]}"
    )


def is_valid_cnj_number(value: str | None) -> bool:
    """Validate the 20-digit CNJ number, including its modulo-97 check digits."""
    digits = normalize_process_number(value)
    if len(digits) != 20:
        return False
    base = f"{digits[:7]}{digits[9:]}00"
    return 98 - (int(base) % 97) == int(digits[7:9])


def require_valid_cnj_number(value: str | None) -> str:
    digits = normalize_process_number(value)
    if not is_valid_cnj_number(digits):
        raise ValueError("Numero de processo invalido: esperado CNJ com 20 digitos validos")
    return digits


def parse_djen_date(value: Any) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = str(value or "").strip()
    if not text:
        raise ValueError("Data da movimentacao ausente")
    return datetime.fromisoformat(text.replace("Z", "+00:00")).date()


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    soup = BeautifulSoup(value, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(" ")
    return " ".join(unescape(text).split())


def get_first(payload: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return payload[key]
    return None


def djen_fingerprint(item: dict[str, Any]) -> str:
    pieces = [
        str(get_first(item, "id", "numeroComunicacao") or ""),
        str(get_first(item, "hash") or ""),
        normalize_process_number(str(get_first(item, "numero_processo", "numeroProcesso") or "")),
        str(get_first(item, "data_disponibilizacao", "datadisponibilizacao") or ""),
        str(get_first(item, "texto") or "")[:512],
    ]
    return hashlib.sha256("|".join(pieces).encode("utf-8")).hexdigest()


def party_matches_client(client_name: str, party_name: str) -> bool:
    client_tokens = _name_tokens(client_name)
    party_tokens = _name_tokens(party_name)
    if len(client_tokens) < 2 or len(party_tokens) < 2:
        return False
    return client_tokens == party_tokens or client_tokens.issubset(party_tokens)


def classify_client_association(
    client_name: str,
    client_cpf: str | None,
    parties: list[dict[str, Any]],
) -> ClientAssociationMatch:
    normalized_client_cpf = normalize_document(client_cpf)
    candidates: list[ClientAssociationMatch] = []

    for party in parties:
        if not isinstance(party, dict):
            continue
        party_name = str(
            get_first(party, "nome", "nomeParte", "nome_parte") or ""
        ).strip()
        if not party_name:
            continue
        party_document = normalize_document(
            str(get_first(party, "cpf_cnpj", "cpfCnpj", "documento", "cpf") or "")
        )
        polo = str(get_first(party, "polo") or "").strip() or None
        name_quality = _name_match_quality(client_name, party_name)

        if normalized_client_cpf and party_document:
            if normalized_client_cpf == party_document:
                candidates.append(
                    ClientAssociationMatch(
                        status=ASSOCIATION_CONFIRMED,
                        reason="documento_exato",
                        party_name=party_name,
                        party_document=party_document,
                        polo=polo,
                    )
                )
            elif name_quality in {"exact", "full_tokens", "partial_tokens"}:
                candidates.append(
                    ClientAssociationMatch(
                        status=ASSOCIATION_REJECTED,
                        reason="documento_divergente",
                        party_name=party_name,
                        party_document=party_document,
                        polo=polo,
                    )
                )
            continue

        if name_quality == "exact":
            candidates.append(
                ClientAssociationMatch(
                    status=ASSOCIATION_PROBABLE,
                    reason="nome_exato_sem_documento",
                    party_name=party_name,
                    party_document=party_document,
                    polo=polo,
                )
            )
        elif name_quality == "full_tokens":
            candidates.append(
                ClientAssociationMatch(
                    status=ASSOCIATION_PROBABLE,
                    reason="tokens_completos_sem_documento",
                    party_name=party_name,
                    party_document=party_document,
                    polo=polo,
                )
            )
        elif name_quality == "partial_tokens":
            candidates.append(
                ClientAssociationMatch(
                    status=ASSOCIATION_UNCERTAIN,
                    reason="nome_parcial",
                    party_name=party_name,
                    party_document=party_document,
                    polo=polo,
                )
            )

    if not candidates:
        return ClientAssociationMatch(
            status=ASSOCIATION_UNCERTAIN,
            reason="destinatario_incompativel_ou_ausente",
            party_name=None,
            party_document=None,
            polo=None,
        )

    priority = {
        ASSOCIATION_CONFIRMED: 4,
        ASSOCIATION_PROBABLE: 3,
        ASSOCIATION_UNCERTAIN: 2,
        ASSOCIATION_REJECTED: 1,
    }
    return max(candidates, key=lambda candidate: priority[candidate.status])


def merge_association_status(current: str | None, new_status: str) -> str:
    priority = {
        ASSOCIATION_REJECTED: 0,
        ASSOCIATION_UNCERTAIN: 1,
        ASSOCIATION_PROBABLE: 2,
        ASSOCIATION_CONFIRMED: 3,
    }
    if not current:
        return new_status
    return new_status if priority.get(new_status, 0) > priority.get(current, 0) else current


def _name_tokens(value: str) -> set[str]:
    particles = {"DA", "DAS", "DE", "DO", "DOS", "E"}
    return {
        token
        for token in normalize_name(value).split()
        if len(token) >= 2 and token not in particles
    }


def _name_match_quality(client_name: str, party_name: str) -> str:
    client = normalize_name(client_name)
    party = normalize_name(party_name)
    if not client or not party:
        return "none"
    if client == party:
        return "exact"
    client_tokens = _name_tokens(client)
    party_tokens = _name_tokens(party)
    if len(client_tokens) >= 2 and client_tokens.issubset(party_tokens):
        return "full_tokens"
    overlap = client_tokens & party_tokens
    if len(overlap) >= 2 and len(overlap) / max(len(client_tokens), 1) >= 0.6:
        return "partial_tokens"
    return "none"


def normalize_document(value: str | None) -> str | None:
    digits = only_digits(value)
    return digits or None


def classify_party_cpf(client_cpf: str | None, party_cpf: str | None) -> str:
    normalized_party = normalize_document(party_cpf)
    if not normalized_party:
        return CPF_STATUS_ABSENT
    if client_cpf and normalized_party != client_cpf:
        return CPF_STATUS_DIVERGENT
    return CPF_STATUS_PRESENT


def merge_cpf_status(current: str | None, new_status: str) -> str:
    priority = {
        CPF_STATUS_ABSENT: 1,
        CPF_STATUS_PRESENT: 2,
        CPF_STATUS_DIVERGENT: 3,
    }
    if not current:
        return new_status
    return new_status if priority[new_status] > priority.get(current, 0) else current
