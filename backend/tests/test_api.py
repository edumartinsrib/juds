import httpx
from sqlalchemy import select

from app.api import get_datajud_client, get_djen_client
from app.datajud import DataJudSearchResult
from app.importer import DjenImporter
from app.main import create_app
from app.models import Client, Communication

from app.djen import DjenPage
from tests.test_datajud import datajud_source
from tests.test_importer import FakeDataJudClient, FakeDjenClient, djen_item, noop_sleep


def api_client(overrides=None) -> httpx.AsyncClient:
    app = create_app()
    for dependency, override in (overrides or {}).items():
        app.dependency_overrides[dependency] = override
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://testserver")


async def test_client_search_run_and_export_flow(session) -> None:
    async with api_client() as client:
        create_response = await client.post(
            "/api/clients",
            json={"name": "Joao da Silva", "cpf": "123.456.789-01"},
        )
        assert create_response.status_code == 201
        created = create_response.json()
        assert created["cpf_masked"] == "123.***.***-01"

        run_response = await client.post(
            f"/api/clients/{created['id']}/search-runs",
            json={"start_date": "2026-06-25", "end_date": "2026-06-25"},
        )
        assert run_response.status_code == 201
        assert run_response.json()["status"] == "queued"

    db_client = await session.get(Client, created["id"])
    fake = FakeDjenClient(
        [
            DjenPage(
                items=[djen_item(77)],
                count=1,
                rate_limit_limit=100,
                rate_limit_remaining=99,
            )
        ]
    )
    importer = DjenImporter(session, fake, sleep=noop_sleep, rate_limit_sleep_seconds=0)
    await importer.import_items(db_client, fake.responses[0].items)
    await session.commit()

    async with api_client() as client:
        clients = (await client.get("/api/clients")).json()
        assert clients[0]["process_count"] == 1
        assert clients[0]["communication_count"] == 1

        processes_response = await client.get("/api/processes", params={"client_id": created["id"]})
        assert processes_response.status_code == 200
        processes = processes_response.json()
        assert processes[0]["tribunal"] == "TJSP"
        assert processes[0]["cpf_status"] == "presente_no_djen"
        assert processes[0]["datajud_status"] == "pending"
        assert processes[0]["process_parties"] == [
            {"name": "Joao da Silva", "polo": "P", "source": "djen"}
        ]

        detail_response = await client.get(f"/api/processes/{processes[0]['id']}")
        detail = detail_response.json()
        assert detail["datajud"]["status"] == "pending"
        assert detail["process_parties"] == [
            {"name": "Joao da Silva", "polo": "P", "source": "djen"}
        ]
        assert detail["timeline"][0]["plain_text"] == "Intimacao com prazo de 10 dias"
        assert detail["lawyers"][0]["name"] == "Maria Advogada"

        fake_datajud = FakeDataJudClient(
            [
                DataJudSearchResult(
                    alias="tjsp",
                    source={
                        **datajud_source(),
                        "poloAtivo": [{"nome": "Autor DataJud"}],
                    },
                    total=1,
                )
            ]
        )
        fake_djen = FakeDjenClient(
            [
                DjenPage(
                    items=[djen_item(78)],
                    count=1,
                    rate_limit_limit=100,
                    rate_limit_remaining=98,
                )
            ]
        )
        async with api_client(
            {
                get_djen_client: lambda: fake_djen,
                get_datajud_client: lambda: fake_datajud,
            }
        ) as enrich_client:
            enrich_response = await enrich_client.post(f"/api/processes/{processes[0]['id']}/enrich", json={})
        assert enrich_response.status_code == 200
        enrichment = enrich_response.json()
        assert enrichment["datajud_attempted"] is True
        assert enrichment["start_date"] == "2024-01-10"
        assert enrichment["djen_items_found"] == 1
        assert enrichment["djen_imported"] == 1
        assert enrichment["process"]["datajud"]["status"] == "synced"
        assert enrichment["process"]["datajud"]["movements_count"] == 2
        assert {"name": "Autor DataJud", "polo": "A", "source": "datajud"} in enrichment["process"]["process_parties"]
        assert fake_djen.calls[0]["numero_processo"] == "00012345620248260100"

        communication_id = (
            await session.execute(select(Communication.id).order_by(Communication.djen_id.asc()))
        ).scalars().first()
        communication_response = await client.get(f"/api/communications/{communication_id}")
        assert communication_response.status_code == 200
        assert communication_response.json()["numero_processo"] == "00012345620248260100"

        csv_response = await client.get(
            "/api/exports", params={"client_id": created["id"], "format": "csv"}
        )
        assert csv_response.status_code == 200
        assert "datajud_status" in csv_response.text
        assert "Intimacao com prazo" in csv_response.text

        xlsx_response = await client.get(
            "/api/exports", params={"client_id": created["id"], "format": "xlsx"}
        )
        assert xlsx_response.status_code == 200
        assert xlsx_response.content[:2] == b"PK"


async def test_risk_keyword_crud_reprocesses_existing_communications(session) -> None:
    async with api_client() as client:
        create_response = await client.post("/api/clients", json={"name": "Joao da Silva"})
        assert create_response.status_code == 201
        created = create_response.json()

    db_client = await session.get(Client, created["id"])
    item = djen_item(880)
    item["texto"] = "<p>Decisao cita SISBAJUD e Banco do Brasil como pontos de atencao.</p>"
    importer = DjenImporter(session, FakeDjenClient([]), sleep=noop_sleep, rate_limit_sleep_seconds=0)
    await importer.import_items(db_client, [item])
    await session.commit()

    async with api_client() as client:
        create_keyword = await client.post(
            "/api/risk-keywords",
            json={
                "term": "sisbajud",
                "category": "Bloqueio judicial",
                "risk_level": "alto",
                "active": True,
            },
        )
        assert create_keyword.status_code == 201
        created_keyword = create_keyword.json()
        assert created_keyword["reprocess"]["scanned_communications"] == 1
        assert created_keyword["reprocess"]["matched_communications"] == 1
        assert created_keyword["keyword"]["match_count"] == 1

        processes = (
            await client.get("/api/processes", params={"client_id": created["id"]})
        ).json()
        assert processes[0]["risk_matches_count"] == 1
        assert processes[0]["highest_risk_level"] == "alto"
        assert processes[0]["risk_matches"][0]["keyword"] == "sisbajud"

        communication_id = (
            await session.execute(select(Communication.id).order_by(Communication.djen_id.asc()))
        ).scalars().first()
        communication_response = await client.get(f"/api/communications/{communication_id}")
        assert communication_response.status_code == 200
        assert communication_response.json()["risk_matches"][0]["source"] == "texto"

        update_keyword = await client.patch(
            f"/api/risk-keywords/{created_keyword['keyword']['id']}",
            json={
                "term": "Banco do Brasil",
                "category": "Instituicao financeira",
                "risk_level": "medio",
                "active": True,
            },
        )
        assert update_keyword.status_code == 200
        assert update_keyword.json()["keyword"]["match_count"] == 1

        delete_keyword = await client.delete(f"/api/risk-keywords/{created_keyword['keyword']['id']}")
        assert delete_keyword.status_code == 200
        assert delete_keyword.json()["reprocess"]["matches_created"] == 0
        processes_after_delete = (
            await client.get("/api/processes", params={"client_id": created["id"]})
        ).json()
        assert processes_after_delete[0]["risk_matches_count"] == 0
        assert processes_after_delete[0]["highest_risk_level"] is None
