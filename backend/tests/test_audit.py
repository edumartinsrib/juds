from datetime import date

from sqlalchemy import func, select

from app.audit import (
    audit_process_integrity,
    backfill_normalized_data,
    resync_flagged_processes,
)
from app.datajud import DataJudSearchResult
from app.djen import DjenPage
from app.importer import DjenImporter
from app.models import (
    Client,
    ClientCommunication,
    ClientProcess,
    Communication,
    Process,
    ProcessAuditIssue,
    ProcessEvent,
)
from app.utils import djen_fingerprint, format_process_number, normalize_name
from tests.test_datajud import datajud_source
from tests.test_importer import (
    FakeDataJudClient,
    FakeDjenClient,
    djen_item,
    noop_sleep,
)


async def test_backfill_normalizes_legacy_rows_and_audit_reaches_zero(session) -> None:
    process_number = "00012347120248260100"
    client = Client(
        name="Joao da Silva",
        normalized_name=normalize_name("Joao da Silva"),
        cpf=None,
    )
    process = Process(
        numero_processo=process_number,
        formatted_number=format_process_number(process_number),
        tribunal="TJSP",
        process_class="Procedimento Comum Civel",
        agency="1 Vara Civel",
        datajud_status="pending",
    )
    session.add_all([client, process])
    await session.flush()
    payload = {
        "id": 2000,
        "hash": "legacy-hash",
        "numero_processo": process_number,
        "data_disponibilizacao": "2026-07-20",
        "siglaTribunal": "TJSP",
        "tipoComunicacao": "Intimacao",
        "nomeClasse": "Procedimento Comum Civel",
        "nomeOrgao": "1 Vara Civel",
        "texto": "<p>Comunicacao historica</p>",
        "destinatarios": [{"nome": "Joao da Silva", "polo": "P"}],
    }
    communication = Communication(
        process_id=process.id,
        djen_id=2000,
        djen_hash="legacy-hash",
        source_fingerprint=djen_fingerprint(payload),
        numero_processo=process_number,
        data_disponibilizacao=date(2026, 7, 20),
        sigla_tribunal="TJSP",
        tipo_comunicacao="Intimacao",
        nome_orgao="1 Vara Civel",
        nome_classe="Procedimento Comum Civel",
        raw_text="<p>Comunicacao historica</p>",
        plain_text="Comunicacao historica",
        raw_payload=payload,
    )
    session.add(communication)
    await session.flush()
    session.add(
        ClientProcess(
            client_id=client.id,
            process_id=process.id,
            cpf_status="ausente_no_djen",
            communications_count=1,
            last_movement_at=date(2026, 7, 20),
        )
    )
    await session.commit()

    before = await audit_process_integrity(session, persist=False)
    assert [finding.issue_type for finding in before.findings] == [
        "missing_source_event"
    ]

    repair = await backfill_normalized_data(session)
    after = await audit_process_integrity(session, persist=True)

    assert repair == {"events_created": 1, "associations_created": 1}
    assert after.unresolved_count == 0
    assert await session.scalar(select(func.count(ProcessEvent.id))) == 1
    association = (
        await session.execute(select(ClientCommunication))
    ).scalar_one()
    assert association.association_status == "probable"


async def test_resync_flagged_process_reconsults_both_sources(session) -> None:
    process_number = "00012347120248260100"
    client = Client(
        name="Joao da Silva",
        normalized_name=normalize_name("Joao da Silva"),
        cpf=None,
    )
    process = Process(
        numero_processo=process_number,
        formatted_number=format_process_number(process_number),
        tribunal="TJSP",
        datajud_status="needs_review",
    )
    session.add_all([client, process])
    await session.flush()
    session.add_all(
        [
            ClientProcess(
                client_id=client.id,
                process_id=process.id,
                cpf_status="ausente_no_djen",
                communications_count=0,
            ),
            ProcessAuditIssue(
                process_id=process.id,
                issue_key=f"audit:datajud_multiple_hits:{process.id}",
                issue_type="datajud_multiple_hits",
                severity="high",
                status="open",
                summary="Reconsulta necessaria",
                details={},
            ),
        ]
    )
    await session.commit()
    fake_datajud = FakeDataJudClient(
        [DataJudSearchResult(alias="tjsp", source=datajud_source(), total=1)]
    )
    fake_djen = FakeDjenClient(
        [DjenPage(items=[], count=0, rate_limit_limit=100, rate_limit_remaining=99)]
    )

    result = await resync_flagged_processes(
        session,
        djen_client=fake_djen,
        datajud_client=fake_datajud,
        sleep=noop_sleep,
    )

    assert result == {"attempted": 1, "completed": 1, "errors": []}
    assert fake_datajud.calls[0]["numero_processo"] == process_number
    assert fake_djen.calls[0]["numero_processo"] == process_number
    await session.refresh(process)
    assert process.datajud_status == "synced"
    assert await session.scalar(
        select(func.count(ProcessEvent.id)).where(ProcessEvent.source == "DATAJUD")
    ) == 2


async def test_justified_audit_finding_is_not_reopened(session) -> None:
    client = Client(
        name="Joao da Silva",
        normalized_name=normalize_name("Joao da Silva"),
        cpf=None,
    )
    session.add(client)
    await session.flush()
    first = djen_item(3000, party_cpf=None)
    second = djen_item(3001, party_cpf=None)
    second["nomeClasse"] = "Cumprimento de sentenca"
    importer = DjenImporter(session, FakeDjenClient([]), sleep=noop_sleep)
    await importer.import_items(client, [first, second])
    await session.commit()

    first_audit = await audit_process_integrity(session, persist=True)
    assert [finding.issue_type for finding in first_audit.findings] == [
        "multiple_djen_classes"
    ]
    issue = (
        await session.execute(
            select(ProcessAuditIssue).where(
                ProcessAuditIssue.issue_type == "multiple_djen_classes"
            )
        )
    ).scalar_one()
    issue.status = "resolved"
    issue.details = {**issue.details, "resolution_reason": "Mudanca de classe confirmada"}
    await session.commit()

    second_audit = await audit_process_integrity(session, persist=True)
    assert second_audit.unresolved_count == 0
    await session.refresh(issue)
    assert issue.status == "resolved"
