from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date, datetime
from html import unescape
from typing import Any

from bs4 import BeautifulSoup

CPF_STATUS_ABSENT = "ausente_no_djen"
CPF_STATUS_PRESENT = "presente_no_djen"
CPF_STATUS_DIVERGENT = "cpf_divergente"


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
    client = normalize_name(client_name)
    party = normalize_name(party_name)
    if not client or not party:
        return False
    return client in party or party in client


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
