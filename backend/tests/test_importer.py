from datetime import date

from sqlalchemy import func, select

from app.djen import DjenPage, DjenRateLimitError
from app.importer import DjenImporter
from app.models import Client, ClientProcess, Communication, CommunicationParty, SearchRun
from app.utils import CPF_STATUS_PRESENT, normalize_cpf, normalize_name


class FakeDjenClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def fetch_comunicacoes(self, **kwargs):
        self.calls.append(kwargs)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


async def noop_sleep(_: float) -> None:
    return None


def djen_item(item_id: int, *, process_number: str = "00012345620248260100") -> dict:
    return {
        "id": item_id,
        "hash": f"hash-{item_id}",
        "data_disponibilizacao": "2026-06-25",
        "siglaTribunal": "TJSP",
        "tipoComunicacao": "Intimacao",
        "nomeOrgao": "1 Vara Civel",
        "texto": "<p>Intimacao com prazo de 10 dias</p>",
        "numero_processo": process_number,
        "meio": "D",
        "link": "https://example.test/comunicacao",
        "nomeClasse": "Procedimento Comum Civel",
        "destinatarios": [
            {"nome": "Joao da Silva", "polo": "P", "cpf_cnpj": "123.456.789-01"},
        ],
        "destinatarioadvogados": [
            {
                "advogado": {
                    "nome": "Maria Advogada",
                    "numero_oab": "12345",
                    "uf_oab": "SP",
                }
            }
        ],
    }


async def test_importer_handles_rate_limit_and_deduplicates(session) -> None:
    client = Client(
        name="Joao da Silva",
        normalized_name=normalize_name("Joao da Silva"),
        cpf=normalize_cpf("12345678901"),
    )
    session.add(client)
    await session.flush()
    run = SearchRun(
        client_id=client.id,
        status="queued",
        start_date=date(2026, 6, 25),
        end_date=date(2026, 6, 25),
        current_page=1,
    )
    session.add(run)
    await session.commit()

    fake = FakeDjenClient(
        [
            DjenRateLimitError(limit=100, remaining=0),
            DjenPage(
                items=[djen_item(10), djen_item(10)],
                count=2,
                rate_limit_limit=100,
                rate_limit_remaining=99,
            ),
        ]
    )
    importer = DjenImporter(session, fake, sleep=noop_sleep, rate_limit_sleep_seconds=0)

    completed = await importer.process_run(run.id)

    assert completed.status == "completed"
    assert completed.total_imported == 1
    assert len(fake.calls) == 2
    assert await session.scalar(select(func.count(Communication.id))) == 1
    assert await session.scalar(select(func.count(CommunicationParty.id))) == 1
    client_process = (await session.execute(select(ClientProcess))).scalar_one()
    assert client_process.cpf_status == CPF_STATUS_PRESENT
    assert client_process.communications_count == 1


async def test_importer_paginates_by_day(session) -> None:
    client = Client(name="Joao", normalized_name=normalize_name("Joao"), cpf=None)
    session.add(client)
    await session.flush()
    run = SearchRun(
        client_id=client.id,
        status="queued",
        start_date=date(2026, 6, 24),
        end_date=date(2026, 6, 25),
        current_page=1,
    )
    session.add(run)
    await session.commit()

    fake = FakeDjenClient(
        [
            DjenPage(
                items=[djen_item(index, process_number=f"00012345620248260{index:03d}") for index in range(1, 101)],
                count=101,
                rate_limit_limit=100,
                rate_limit_remaining=80,
            ),
            DjenPage(
                items=[djen_item(101, process_number="00012345620248260101")],
                count=101,
                rate_limit_limit=100,
                rate_limit_remaining=79,
            ),
            DjenPage(items=[], count=0, rate_limit_limit=100, rate_limit_remaining=78),
        ]
    )
    importer = DjenImporter(session, fake, sleep=noop_sleep, rate_limit_sleep_seconds=0)

    completed = await importer.process_run(run.id)

    assert completed.total_imported == 101
    assert [call["page"] for call in fake.calls] == [1, 2, 1]
    assert await session.scalar(select(func.count(Communication.id))) == 101
