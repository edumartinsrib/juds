import httpx
from sqlalchemy import select

from app.importer import DjenImporter
from app.main import create_app
from app.models import Client, Communication

from app.djen import DjenPage
from tests.test_importer import FakeDjenClient, djen_item, noop_sleep


def api_client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=create_app())
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

        detail_response = await client.get(f"/api/processes/{processes[0]['id']}")
        detail = detail_response.json()
        assert detail["datajud"]["status"] == "pending"
        assert detail["timeline"][0]["plain_text"] == "Intimacao com prazo de 10 dias"
        assert detail["lawyers"][0]["name"] == "Maria Advogada"

        communication_id = (await session.execute(select(Communication.id))).scalar_one()
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
