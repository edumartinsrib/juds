from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx


class DjenRateLimitError(Exception):
    def __init__(self, limit: int | None, remaining: int | None) -> None:
        super().__init__("DJEN rate limit reached")
        self.limit = limit
        self.remaining = remaining


@dataclass
class DjenPage:
    items: list[dict[str, Any]]
    count: int
    rate_limit_limit: int | None
    rate_limit_remaining: int | None


def _header_int(headers: httpx.Headers, name: str) -> int | None:
    value = headers.get(name)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


class DjenClient:
    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def fetch_comunicacoes(
        self,
        *,
        nome_parte: str,
        start_date: date,
        end_date: date,
        page: int,
        itens_por_pagina: int = 100,
    ) -> DjenPage:
        params = {
            "nomeParte": nome_parte,
            "dataDisponibilizacaoInicio": start_date.isoformat(),
            "dataDisponibilizacaoFim": end_date.isoformat(),
            "pagina": page,
            "itensPorPagina": itens_por_pagina,
        }
        return await self._fetch_comunicacoes(params)

    async def fetch_comunicacoes_por_processo(
        self,
        *,
        numero_processo: str,
        start_date: date,
        end_date: date,
        page: int,
        sigla_tribunal: str | None = None,
        itens_por_pagina: int = 100,
    ) -> DjenPage:
        params = {
            "numeroProcesso": numero_processo,
            "dataDisponibilizacaoInicio": start_date.isoformat(),
            "dataDisponibilizacaoFim": end_date.isoformat(),
            "pagina": page,
            "itensPorPagina": itens_por_pagina,
        }
        if sigla_tribunal:
            params["siglaTribunal"] = sigla_tribunal
        return await self._fetch_comunicacoes(params)

    async def _fetch_comunicacoes(self, params: dict[str, str | int]) -> DjenPage:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
            response = await client.get("/api/v1/comunicacao", params=params)

        limit = _header_int(response.headers, "x-ratelimit-limit")
        remaining = _header_int(response.headers, "x-ratelimit-remaining")

        if response.status_code == 429:
            raise DjenRateLimitError(limit=limit, remaining=remaining)
        response.raise_for_status()
        payload = response.json()
        items = payload.get("items") or []
        return DjenPage(
            items=items,
            count=int(payload.get("count") or len(items)),
            rate_limit_limit=limit,
            rate_limit_remaining=remaining,
        )
