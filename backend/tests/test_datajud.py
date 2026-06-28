import json

import httpx

from app.datajud import (
    DataJudClient,
    datajud_movements,
    infer_datajud_alias_from_process_number,
    resolve_datajud_alias,
)


def datajud_source() -> dict:
    return {
        "id": "TJSP_436_G1_123_00012345620248260100",
        "numeroProcesso": "00012345620248260100",
        "tribunal": "TJSP",
        "classe": {"codigo": 436, "nome": "Procedimento DataJud"},
        "orgaoJulgador": {"codigo": 123, "nome": "2 Vara Civel"},
        "assuntos": [{"codigo": 6177, "nome": "Obrigacao de Fazer"}],
        "movimentos": [
            {"codigo": 26, "nome": "Distribuicao", "dataHora": "2024-01-10T10:00:00.000Z"},
            {"codigo": 51, "nome": "Conclusao", "dataHora": "2024-02-15T15:30:00.000Z"},
        ],
        "dataAjuizamento": "2024-01-10T00:00:00.000Z",
        "dataHoraUltimaAtualizacao": "2024-02-16T12:00:00.000Z",
        "grau": "G1",
        "nivelSigilo": 0,
        "sistema": {"codigo": 1, "nome": "PJe"},
        "formato": {"codigo": 1, "nome": "Eletronico"},
    }


def test_resolves_datajud_aliases() -> None:
    assert resolve_datajud_alias("TJSP") == "tjsp"
    assert resolve_datajud_alias("TRE-SP") == "tre-sp"
    assert resolve_datajud_alias("api_publica_trf1") == "trf1"
    assert infer_datajud_alias_from_process_number("0001234-56.2024.8.26.0100") == "tjsp"
    assert infer_datajud_alias_from_process_number("0000832-35.2018.4.01.3202") == "trf1"


async def test_datajud_client_fetches_by_process_number() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        body = json.loads(request.content)
        assert request.url.path == "/api_publica_tjsp/_search"
        assert request.headers["Authorization"] == "APIKey test-key"
        assert body["query"]["match"]["numeroProcesso"] == "00012345620248260100"
        return httpx.Response(
            200,
            json={
                "hits": {
                    "total": {"value": 1, "relation": "eq"},
                    "hits": [{"_source": datajud_source()}],
                }
            },
        )

    client = DataJudClient(
        "https://datajud.test",
        "test-key",
        transport=httpx.MockTransport(handler),
    )

    result = await client.fetch_process("0001234-56.2024.8.26.0100", tribunal="TJSP")

    assert len(requests) == 1
    assert result.alias == "tjsp"
    assert result.total == 1
    assert result.source and result.source["classe"]["nome"] == "Procedimento DataJud"


def test_datajud_movements_are_normalized_newest_first() -> None:
    movements = datajud_movements(datajud_source())

    assert [movement["nome"] for movement in movements] == ["Conclusao", "Distribuicao"]
    assert movements[0]["data_hora"].isoformat() == "2024-02-15T15:30:00+00:00"
