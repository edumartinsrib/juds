from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

from app.utils import normalize_process_number

DATAJUD_STATUS_PENDING = "pending"
DATAJUD_STATUS_SYNCED = "synced"
DATAJUD_STATUS_NOT_FOUND = "not_found"
DATAJUD_STATUS_ERROR = "error"

STATE_CODES = {
    "01": "ac",
    "02": "al",
    "03": "ap",
    "04": "am",
    "05": "ba",
    "06": "ce",
    "07": "dft",
    "08": "es",
    "09": "go",
    "10": "ma",
    "11": "mt",
    "12": "ms",
    "13": "mg",
    "14": "pa",
    "15": "pb",
    "16": "pr",
    "17": "pe",
    "18": "pi",
    "19": "rj",
    "20": "rn",
    "21": "rs",
    "22": "ro",
    "23": "rr",
    "24": "sc",
    "25": "se",
    "26": "sp",
    "27": "to",
}

STATE_TRIBUNALS = {
    "01": "tjac",
    "02": "tjal",
    "03": "tjap",
    "04": "tjam",
    "05": "tjba",
    "06": "tjce",
    "07": "tjdft",
    "08": "tjes",
    "09": "tjgo",
    "10": "tjma",
    "11": "tjmt",
    "12": "tjms",
    "13": "tjmg",
    "14": "tjpa",
    "15": "tjpb",
    "16": "tjpr",
    "17": "tjpe",
    "18": "tjpi",
    "19": "tjrj",
    "20": "tjrn",
    "21": "tjrs",
    "22": "tjro",
    "23": "tjrr",
    "24": "tjsc",
    "25": "tjse",
    "26": "tjsp",
    "27": "tjto",
}

SUPPORTED_ALIASES = {
    "stj",
    "stm",
    "tse",
    "tst",
    *STATE_TRIBUNALS.values(),
    *(f"trf{index}" for index in range(1, 7)),
    *(f"trt{index}" for index in range(1, 25)),
    *(f"tre-{state}" for state in STATE_CODES.values()),
    "tjmmg",
    "tjmrs",
    "tjmsp",
}


def _tribunal_aliases() -> dict[str, str]:
    aliases = {alias.upper(): alias for alias in SUPPORTED_ALIASES}
    aliases.update(
        {
            "STJ": "stj",
            "STM": "stm",
            "TSE": "tse",
            "TST": "tst",
            "TJM-MG": "tjmmg",
            "TJMMG": "tjmmg",
            "TJM-RS": "tjmrs",
            "TJMRS": "tjmrs",
            "TJM-SP": "tjmsp",
            "TJMSP": "tjmsp",
        }
    )
    for code, alias in STATE_TRIBUNALS.items():
        state = STATE_CODES[code]
        aliases[f"TJ{state.upper()}"] = alias
        aliases[f"TJ-{state.upper()}"] = alias
    for index in range(1, 7):
        aliases[f"TRF{index}"] = f"trf{index}"
    for index in range(1, 25):
        aliases[f"TRT{index}"] = f"trt{index}"
    for state in STATE_CODES.values():
        aliases[f"TRE{state.upper()}"] = f"tre-{state}"
        aliases[f"TRE-{state.upper()}"] = f"tre-{state}"
    return aliases


TRIBUNAL_ALIASES = _tribunal_aliases()


class DataJudError(Exception):
    pass


@dataclass(frozen=True)
class DataJudSearchResult:
    alias: str | None
    source: dict[str, Any] | None
    total: int


class DataJudClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key.strip()
        self.timeout = timeout
        self.transport = transport

    async def fetch_process(
        self, numero_processo: str, tribunal: str | None = None
    ) -> DataJudSearchResult:
        process_number = normalize_process_number(numero_processo)
        aliases = candidate_datajud_aliases(tribunal, process_number)
        if not aliases:
            raise DataJudError("Nao foi possivel resolver o endpoint DataJud do processo")

        first_alias = aliases[0]
        for alias in aliases:
            result = await self._search_alias(alias, process_number)
            if result.source is not None:
                return result
        return DataJudSearchResult(alias=first_alias, source=None, total=0)

    async def _search_alias(self, alias: str, process_number: str) -> DataJudSearchResult:
        headers = {
            "Authorization": f"APIKey {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "size": 1,
            "query": {
                "match": {
                    "numeroProcesso": process_number,
                }
            },
        }
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout,
            transport=self.transport,
        ) as client:
            response = await client.post(
                f"/api_publica_{alias}/_search",
                json=payload,
                headers=headers,
            )

        if response.status_code in (401, 403):
            raise DataJudError(f"Falha de autorizacao no DataJud ({response.status_code})")
        if response.status_code == 429:
            raise DataJudError("Rate limit do DataJud")
        if response.status_code >= 400:
            raise DataJudError(f"DataJud retornou HTTP {response.status_code}")

        payload = response.json()
        hits_container = payload.get("hits") or {}
        hits = hits_container.get("hits") or []
        total = _hit_total(hits_container.get("total"))
        source = hits[0].get("_source") if hits else None
        return DataJudSearchResult(alias=alias, source=source, total=total)


def candidate_datajud_aliases(tribunal: str | None, numero_processo: str) -> list[str]:
    aliases: list[str] = []
    explicit_alias = resolve_datajud_alias(tribunal)
    if explicit_alias:
        aliases.append(explicit_alias)
    inferred_alias = infer_datajud_alias_from_process_number(numero_processo)
    if inferred_alias:
        aliases.append(inferred_alias)
    return list(dict.fromkeys(aliases))


def resolve_datajud_alias(tribunal: str | None) -> str | None:
    if not tribunal:
        return None
    value = tribunal.strip()
    if not value:
        return None
    normalized = (
        value.upper()
        .replace("API_PUBLICA_", "")
        .replace("_", "-")
        .replace(" ", "")
        .replace(".", "")
        .replace("/", "-")
    )
    direct = TRIBUNAL_ALIASES.get(normalized)
    if direct:
        return direct
    compact = normalized.replace("-", "")
    return TRIBUNAL_ALIASES.get(compact)


def infer_datajud_alias_from_process_number(numero_processo: str) -> str | None:
    process_number = normalize_process_number(numero_processo)
    if len(process_number) != 20:
        return None
    branch = process_number[13]
    court_code = process_number[14:16]
    if branch == "4":
        number = int(court_code)
        return f"trf{number}" if 1 <= number <= 6 else None
    if branch == "5":
        number = int(court_code)
        return f"trt{number}" if 1 <= number <= 24 else None
    if branch == "6":
        state = STATE_CODES.get(court_code)
        return f"tre-{state}" if state else None
    if branch == "7":
        return {"13": "tjmmg", "21": "tjmrs", "26": "tjmsp"}.get(court_code)
    if branch == "8":
        return STATE_TRIBUNALS.get(court_code)
    return None


def parse_datajud_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def datajud_object_name(value: Any) -> str | None:
    if isinstance(value, dict):
        name = value.get("nome") or value.get("nomeOrgao")
        return str(name).strip() if name else None
    return None


def datajud_subject_names(source: dict[str, Any] | None) -> list[str]:
    subjects = source.get("assuntos") if source else None
    if not isinstance(subjects, list):
        return []
    names = []
    for subject in subjects:
        name = datajud_object_name(subject)
        if name:
            names.append(name)
    return names


def datajud_movements(source: dict[str, Any] | None) -> list[dict[str, Any]]:
    movements = source.get("movimentos") if source else None
    if not isinstance(movements, list):
        return []
    normalized = []
    for movement in movements:
        if not isinstance(movement, dict):
            continue
        complements = movement.get("complementosTabelados") or []
        complement_names = [
            str(complement.get("nome")).strip()
            for complement in complements
            if isinstance(complement, dict) and complement.get("nome")
        ]
        movement_court = movement.get("orgaoJulgador") if isinstance(movement, dict) else None
        normalized.append(
            {
                "codigo": movement.get("codigo"),
                "nome": movement.get("nome"),
                "data_hora": parse_datajud_datetime(movement.get("dataHora")),
                "orgao_julgador": datajud_object_name(movement_court),
                "complementos": complement_names,
            }
        )
    return sorted(
        normalized,
        key=lambda item: item["data_hora"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )


def latest_datajud_movement_datetime(source: dict[str, Any] | None) -> datetime | None:
    movements = datajud_movements(source)
    if not movements:
        return None
    return movements[0]["data_hora"]


def _hit_total(total: Any) -> int:
    if isinstance(total, dict):
        value = total.get("value")
    else:
        value = total
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0
