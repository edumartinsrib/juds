from datetime import date

from sqlalchemy import func, select

from app.datajud import DATAJUD_STATUS_ERROR, DATAJUD_STATUS_SYNCED, DataJudSearchResult
from app.djen import DjenPage, DjenRateLimitError
from app.importer import DjenImporter
from app.models import (
    Client,
    ClientProcess,
    Communication,
    CommunicationLawyer,
    CommunicationParty,
    CommunicationRiskMatch,
    Lawyer,
    Process,
    RiskKeyword,
    SearchRun,
)
from app.utils import (
    CPF_STATUS_ABSENT,
    CPF_STATUS_DIVERGENT,
    CPF_STATUS_PRESENT,
    format_process_number,
    normalize_cpf,
    normalize_name,
)
from tests.test_datajud import datajud_source


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

    async def fetch_comunicacoes_por_processo(self, **kwargs):
        self.calls.append(kwargs)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class FakeDataJudClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def fetch_process(self, numero_processo, tribunal=None):
        self.calls.append({"numero_processo": numero_processo, "tribunal": tribunal})
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


async def noop_sleep(_: float) -> None:
    return None


class SleepRecorder:
    def __init__(self) -> None:
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


def djen_item(
    item_id: int,
    *,
    process_number: str = "00012345620248260100",
    party_cpf: str | None = "123.456.789-01",
) -> dict:
    party = {"nome": "Joao da Silva", "polo": "P"}
    if party_cpf is not None:
        party["cpf_cnpj"] = party_cpf
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
        "destinatarios": [party],
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


async def test_importer_links_existing_communication_to_new_client(session) -> None:
    first_client = Client(
        name="Joao da Silva",
        normalized_name=normalize_name("Joao da Silva"),
        cpf=normalize_cpf("12345678901"),
    )
    second_client = Client(
        name="Joao da Silva",
        normalized_name=normalize_name("Joao da Silva"),
        cpf=normalize_cpf("12345678901"),
    )
    session.add_all([first_client, second_client])
    await session.flush()

    importer = DjenImporter(session, FakeDjenClient([]), sleep=noop_sleep, rate_limit_sleep_seconds=0)
    item = djen_item(33)

    first_imported = await importer.import_items(first_client, [item])
    second_imported = await importer.import_items(second_client, [item])
    repeated_imported = await importer.import_items(second_client, [item])
    await session.commit()

    assert first_imported == 1
    assert second_imported == 0
    assert repeated_imported == 0
    assert await session.scalar(select(func.count(Communication.id))) == 1
    assert await session.scalar(select(func.count(Process.id))) == 1
    client_processes = (await session.execute(select(ClientProcess))).scalars().all()
    assert len(client_processes) == 2
    assert {item.client_id for item in client_processes} == {first_client.id, second_client.id}
    assert {item.communications_count for item in client_processes} == {1}


async def test_importer_waits_before_next_request_when_rate_limit_remaining_is_zero(session) -> None:
    client = Client(
        name="Paulo Roberto Guarez",
        normalized_name=normalize_name("Paulo Roberto Guarez"),
        cpf=None,
    )
    session.add(client)
    await session.flush()
    run = SearchRun(
        client_id=client.id,
        status="queued",
        start_date=date(2026, 6, 18),
        end_date=date(2026, 6, 19),
        current_page=1,
    )
    session.add(run)
    await session.commit()

    fake = FakeDjenClient(
        [
            DjenPage(items=[], count=0, rate_limit_limit=20, rate_limit_remaining=0),
            DjenPage(items=[], count=0, rate_limit_limit=20, rate_limit_remaining=19),
        ]
    )
    sleep = SleepRecorder()
    importer = DjenImporter(session, fake, sleep=sleep, rate_limit_sleep_seconds=7)

    completed = await importer.process_run(run.id)

    assert completed.status == "completed"
    assert completed.error_message is None
    assert completed.rate_limit_limit == 20
    assert completed.rate_limit_remaining == 19
    assert sleep.calls == [7]
    assert [call["start_date"] for call in fake.calls] == [date(2026, 6, 18), date(2026, 6, 19)]


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


async def test_importer_classifies_absent_and_divergent_cpf(session) -> None:
    client = Client(
        name="Joao da Silva",
        normalized_name=normalize_name("Joao da Silva"),
        cpf=normalize_cpf("12345678901"),
    )
    session.add(client)
    await session.flush()

    importer = DjenImporter(
        session,
        FakeDjenClient([]),
        sleep=noop_sleep,
        rate_limit_sleep_seconds=0,
    )
    await importer.import_items(
        client,
        [
            djen_item(201, process_number="00012345620248260201", party_cpf=None),
            djen_item(202, process_number="00012345620248260202", party_cpf="999.999.999-99"),
        ],
    )
    await session.commit()

    statuses = (await session.execute(select(ClientProcess.cpf_status))).scalars().all()
    assert CPF_STATUS_ABSENT in statuses
    assert CPF_STATUS_DIVERGENT in statuses


async def test_importer_classifies_new_communication_with_active_risk_keyword(session) -> None:
    client = Client(
        name="Joao da Silva",
        normalized_name=normalize_name("Joao da Silva"),
        cpf=normalize_cpf("12345678901"),
    )
    keyword = RiskKeyword(
        term="SISBAJUD",
        normalized_term=normalize_name("SISBAJUD"),
        category="Bloqueio judicial",
        risk_level="alto",
        active=True,
    )
    session.add_all([client, keyword])
    await session.flush()

    item = djen_item(250)
    item["texto"] = "<p>Decisao determina pesquisa SISBAJUD em nome da parte executada.</p>"
    importer = DjenImporter(session, FakeDjenClient([]), sleep=noop_sleep, rate_limit_sleep_seconds=0)

    imported = await importer.import_items(client, [item])
    await session.commit()

    assert imported == 1
    match = (await session.execute(select(CommunicationRiskMatch))).scalar_one()
    assert match.risk_keyword_id == keyword.id
    assert match.source == "texto"
    assert match.matched_text == "SISBAJUD"
    assert "pesquisa SISBAJUD" in match.excerpt


async def test_importer_enriches_process_with_datajud_once_per_run(session) -> None:
    client = Client(
        name="Joao da Silva",
        normalized_name=normalize_name("Joao da Silva"),
        cpf=normalize_cpf("12345678901"),
    )
    session.add(client)
    await session.flush()

    datajud = datajud_source()
    fake_datajud = FakeDataJudClient(
        [
            DataJudSearchResult(alias="tjsp", source=datajud, total=1),
        ]
    )
    importer = DjenImporter(
        session,
        FakeDjenClient([]),
        datajud_client=fake_datajud,
        sleep=noop_sleep,
        rate_limit_sleep_seconds=0,
    )

    await importer.import_items(
        client,
        [
            djen_item(301),
            djen_item(302),
        ],
    )
    await session.commit()

    process = (await session.execute(select(Process))).scalar_one()
    assert len(fake_datajud.calls) == 1
    assert fake_datajud.calls[0]["numero_processo"] == "00012345620248260100"
    assert fake_datajud.calls[0]["tribunal"] == "TJSP"
    assert process.datajud_status == DATAJUD_STATUS_SYNCED
    assert process.datajud_alias == "tjsp"
    assert process.process_class == "Procedimento DataJud"
    assert process.agency == "2 Vara Civel"
    assert process.datajud_system == "PJe"
    assert process.datajud_movements_count == 2


async def test_importer_records_datajud_error_without_failing_djen_import(session) -> None:
    client = Client(name="Joao da Silva", normalized_name=normalize_name("Joao da Silva"), cpf=None)
    session.add(client)
    await session.flush()

    fake_datajud = FakeDataJudClient([RuntimeError("DataJud indisponivel")])
    importer = DjenImporter(
        session,
        FakeDjenClient([]),
        datajud_client=fake_datajud,
        sleep=noop_sleep,
        rate_limit_sleep_seconds=0,
    )

    imported = await importer.import_items(client, [djen_item(401)])
    await session.commit()

    process = (await session.execute(select(Process))).scalar_one()
    assert imported == 1
    assert await session.scalar(select(func.count(Communication.id))) == 1
    assert process.datajud_status == DATAJUD_STATUS_ERROR
    assert process.datajud_error == "DataJud indisponivel"


async def test_importer_enriches_process_by_number_with_larger_window(session) -> None:
    client = Client(name="Joao da Silva", normalized_name=normalize_name("Joao da Silva"), cpf=None)
    process = Process(
        numero_processo="00012345620248260100",
        formatted_number=format_process_number("00012345620248260100"),
        tribunal="TJSP",
        datajud_status="pending",
    )
    session.add_all([client, process])
    await session.flush()
    session.add(
        ClientProcess(
            client_id=client.id,
            process_id=process.id,
            cpf_status=CPF_STATUS_ABSENT,
            communications_count=0,
        )
    )
    await session.commit()

    source = {
        **datajud_source(),
        "poloAtivo": [{"nome": "Autor DataJud"}],
        "poloPassivo": [{"nome": "Joao da Silva"}],
    }
    fake_datajud = FakeDataJudClient([DataJudSearchResult(alias="tjsp", source=source, total=1)])
    fake_djen = FakeDjenClient(
        [
            DjenPage(
                items=[djen_item(601)],
                count=1,
                rate_limit_limit=100,
                rate_limit_remaining=98,
            )
        ]
    )
    importer = DjenImporter(
        session,
        fake_djen,
        datajud_client=fake_datajud,
        sleep=noop_sleep,
        rate_limit_sleep_seconds=0,
    )

    result = await importer.enrich_process_by_number(process, [client])
    await session.commit()

    assert result.datajud_attempted is True
    assert result.start_date == date(2024, 1, 10)
    assert result.djen_items_found == 1
    assert result.djen_imported == 1
    assert fake_datajud.calls == [{"numero_processo": "00012345620248260100", "tribunal": "TJSP"}]
    assert fake_djen.calls[0]["numero_processo"] == "00012345620248260100"
    assert fake_djen.calls[0]["start_date"] == date(2024, 1, 10)
    assert await session.scalar(select(func.count(Communication.id))) == 1
    client_process = (await session.execute(select(ClientProcess))).scalar_one()
    assert client_process.communications_count == 1
    assert process.datajud_status == DATAJUD_STATUS_SYNCED
    assert process.datajud_movements_count == 2


async def test_importer_ignores_duplicate_lawyer_links_in_same_communication(session) -> None:
    client = Client(
        name="Joao da Silva",
        normalized_name=normalize_name("Joao da Silva"),
        cpf=normalize_cpf("12345678901"),
    )
    session.add(client)
    await session.flush()

    item = djen_item(501)
    item["destinatarioadvogados"].append(item["destinatarioadvogados"][0])
    importer = DjenImporter(
        session,
        FakeDjenClient([]),
        sleep=noop_sleep,
        rate_limit_sleep_seconds=0,
    )

    imported = await importer.import_items(client, [item])
    await session.commit()

    assert imported == 1
    assert await session.scalar(select(func.count(Communication.id))) == 1
    assert await session.scalar(select(func.count(Lawyer.id))) == 1
    assert await session.scalar(select(func.count(CommunicationLawyer.id))) == 1
