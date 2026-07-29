from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import db
from app.core.config import get_settings
from app.datajud import DataJudClient
from app.djen import DjenClient
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
from app.utils import (
    ASSOCIATION_REJECTED,
    classify_client_association,
    get_first,
    is_valid_cnj_number,
    normalize_process_number,
)


@dataclass(frozen=True)
class AuditFinding:
    issue_key: str
    issue_type: str
    severity: str
    summary: str
    process_id: str | None
    communication_id: str | None
    details: dict[str, Any]


@dataclass(frozen=True)
class AuditReport:
    scanned_processes: int
    scanned_communications: int
    findings: tuple[AuditFinding, ...]
    unresolved_count: int
    generated_at: str

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["findings"] = [asdict(finding) for finding in self.findings]
        return payload


AUDITED_ISSUE_TYPES = {
    "communication_process_mismatch",
    "communication_payload_number_mismatch",
    "datajud_process_number_mismatch",
    "datajud_multiple_hits",
    "multiple_djen_classes",
    "multiple_djen_agencies",
    "invalid_cnj_number",
    "missing_source_event",
}


async def audit_process_integrity(
    session: AsyncSession,
    *,
    persist: bool = True,
) -> AuditReport:
    processes = (
        await session.execute(
            select(Process)
            .options(
                selectinload(Process.communications),
                selectinload(Process.events),
                selectinload(Process.sources),
            )
            .order_by(Process.numero_processo.asc())
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    findings: list[AuditFinding] = []
    communication_count = 0

    for process in processes:
        if not is_valid_cnj_number(process.numero_processo):
            findings.append(
                _finding(
                    "invalid_cnj_number",
                    "critical",
                    "Processo canonico possui numero CNJ invalido",
                    process,
                    details={"numero_processo": process.numero_processo},
                )
            )

        classes: set[str] = set()
        agencies: set[str] = set()
        event_communication_ids = {
            event.communication_id
            for event in process.events
            if event.source == "DJEN" and event.communication_id
        }
        for communication in process.communications:
            communication_count += 1
            if communication.nome_classe:
                classes.add(communication.nome_classe)
            if communication.nome_orgao:
                agencies.add(communication.nome_orgao)
            if communication.numero_processo != process.numero_processo:
                findings.append(
                    _finding(
                        "communication_process_mismatch",
                        "critical",
                        "Comunicacao e processo vinculado possuem numeros diferentes",
                        process,
                        communication,
                        {
                            "communication_number": communication.numero_processo,
                            "process_number": process.numero_processo,
                        },
                    )
                )
            payload_number = _payload_process_number(communication.raw_payload)
            if payload_number and payload_number != communication.numero_processo:
                findings.append(
                    _finding(
                        "communication_payload_number_mismatch",
                        "critical",
                        "Payload DJEN diverge do numero persistido na comunicacao",
                        process,
                        communication,
                        {
                            "payload_number": payload_number,
                            "communication_number": communication.numero_processo,
                        },
                    )
                )
            if communication.id not in event_communication_ids:
                findings.append(
                    _finding(
                        "missing_source_event",
                        "high",
                        "Comunicacao DJEN ainda nao possui evento normalizado",
                        process,
                        communication,
                        {"source": "DJEN"},
                    )
                )

        datajud_number = _payload_process_number(process.datajud_payload)
        if datajud_number and datajud_number != process.numero_processo:
            findings.append(
                _finding(
                    "datajud_process_number_mismatch",
                    "critical",
                    "Payload DataJud diverge do processo canonico",
                    process,
                    details={
                        "datajud_number": datajud_number,
                        "process_number": process.numero_processo,
                    },
                )
            )
        if process.datajud_hit_count > 1 and process.datajud_status == "needs_review":
            findings.append(
                _finding(
                    "datajud_multiple_hits",
                    "high",
                    "Processo possui multiplos hits DataJud",
                    process,
                    details={
                        "hit_count": process.datajud_hit_count,
                        "selection_reason": process.datajud_selection_reason,
                        "review_reason": process.datajud_review_reason,
                    },
                )
            )
        if len(classes) > 1:
            findings.append(
                _finding(
                    "multiple_djen_classes",
                    "medium",
                    "Comunicacoes DJEN registram mais de uma classe",
                    process,
                    details={"classes": sorted(classes)},
                )
            )
        if len(agencies) > 1:
            findings.append(
                _finding(
                    "multiple_djen_agencies",
                    "medium",
                    "Comunicacoes DJEN registram mais de um orgao",
                    process,
                    details={"agencies": sorted(agencies)},
                )
            )

    if persist:
        await _persist_findings(session, findings)
        await session.commit()

    justified_keys = {
        issue.issue_key
        for issue in (
            await session.execute(
                select(ProcessAuditIssue).where(
                    ProcessAuditIssue.status == "resolved"
                )
            )
        ).scalars().all()
        if (issue.details or {}).get("resolution_reason")
    }
    unresolved_findings = [
        finding for finding in findings if finding.issue_key not in justified_keys
    ]
    return AuditReport(
        scanned_processes=len(processes),
        scanned_communications=communication_count,
        findings=tuple(unresolved_findings),
        unresolved_count=len(unresolved_findings),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


async def backfill_normalized_data(session: AsyncSession) -> dict[str, int]:
    """Populate normalized events and explicit client associations for legacy rows."""
    importer = DjenImporter(
        session,
        djen_client=DjenClient(get_settings().djen_base_url),
    )
    communications = (
        await session.execute(
            select(Communication).order_by(Communication.created_at.asc())
        )
    ).scalars().all()
    events_created = 0
    associations_created = 0

    for communication in communications:
        existing_event = await session.scalar(
            select(ProcessEvent.id).where(
                ProcessEvent.communication_id == communication.id
            )
        )
        if not existing_event:
            await importer._upsert_djen_event(communication)
            events_created += 1

        client_processes = (
            await session.execute(
                select(ClientProcess)
                .where(ClientProcess.process_id == communication.process_id)
                .options(selectinload(ClientProcess.client))
            )
        ).scalars().all()
        for client_process in client_processes:
            existing_association = await session.scalar(
                select(ClientCommunication.id).where(
                    ClientCommunication.client_id == client_process.client_id,
                    ClientCommunication.communication_id == communication.id,
                )
            )
            if existing_association:
                continue
            client: Client = client_process.client
            association = classify_client_association(
                client.name,
                client.cpf,
                communication.raw_payload.get("destinatarios") or [],
            )
            await importer._upsert_client_communication(
                client,
                communication,
                association,
            )
            if association.status != ASSOCIATION_REJECTED:
                client_process.association_status = association.status
                client_process.association_reason = association.reason
            associations_created += 1

    await session.commit()
    return {
        "events_created": events_created,
        "associations_created": associations_created,
    }


async def resync_flagged_processes(
    session: AsyncSession,
    *,
    djen_client: DjenClient | None = None,
    datajud_client: DataJudClient | None = None,
    sleep=asyncio.sleep,
) -> dict[str, Any]:
    process_ids = set(
        (
            await session.execute(
                select(ProcessAuditIssue.process_id).where(
                    ProcessAuditIssue.status == "open",
                    ProcessAuditIssue.process_id.is_not(None),
                )
            )
        ).scalars().all()
    )
    process_ids.update(
        (
            await session.execute(
                select(Process.id).where(Process.datajud_status == "needs_review")
            )
        ).scalars().all()
    )
    process_ids.discard(None)
    if not process_ids:
        return {"attempted": 0, "completed": 0, "errors": []}

    settings = get_settings()
    djen = djen_client or DjenClient(settings.djen_base_url)
    datajud = datajud_client
    if datajud is None and settings.datajud_api_key:
        datajud = DataJudClient(
            settings.datajud_base_url,
            settings.datajud_api_key,
            timeout=settings.datajud_timeout_seconds,
        )
    processes = (
        await session.execute(
            select(Process)
            .where(Process.id.in_(process_ids))
            .options(
                selectinload(Process.client_processes).selectinload(
                    ClientProcess.client
                )
            )
            .order_by(Process.numero_processo.asc())
        )
    ).scalars().all()
    completed = 0
    errors: list[dict[str, str]] = []

    for process in processes:
        if not is_valid_cnj_number(process.numero_processo):
            errors.append(
                {
                    "process_id": process.id,
                    "numero_processo": process.numero_processo,
                    "error": "numero_cnj_invalido",
                }
            )
            continue
        clients = [
            client_process.client
            for client_process in process.client_processes
            if client_process.client
        ]
        importer = DjenImporter(
            session,
            djen,
            datajud_client=datajud,
            sleep=sleep,
        )
        try:
            await importer.enrich_process_by_number(
                process,
                clients,
                force_datajud=True,
            )
            await session.commit()
            completed += 1
        except Exception as exc:
            await session.rollback()
            errors.append(
                {
                    "process_id": process.id,
                    "numero_processo": process.numero_processo,
                    "error": str(exc)[:512],
                }
            )
    return {
        "attempted": len(processes),
        "completed": completed,
        "errors": errors,
    }


def _finding(
    issue_type: str,
    severity: str,
    summary: str,
    process: Process,
    communication: Communication | None = None,
    details: dict[str, Any] | None = None,
) -> AuditFinding:
    entity_id = communication.id if communication else process.id
    return AuditFinding(
        issue_key=f"audit:{issue_type}:{entity_id}",
        issue_type=issue_type,
        severity=severity,
        summary=summary,
        process_id=process.id,
        communication_id=communication.id if communication else None,
        details=details or {},
    )


def _payload_process_number(payload: dict[str, Any] | None) -> str:
    if not isinstance(payload, dict):
        return ""
    source = payload.get("_source") if isinstance(payload.get("_source"), dict) else payload
    raw_number = get_first(
        source,
        "numero_processo",
        "numeroProcesso",
        "numeroprocessocommascara",
    )
    return normalize_process_number(str(raw_number or ""))


async def _persist_findings(
    session: AsyncSession,
    findings: list[AuditFinding],
) -> None:
    active_keys = {finding.issue_key for finding in findings}
    existing = (
        await session.execute(
            select(ProcessAuditIssue).where(
                ProcessAuditIssue.issue_type.in_(AUDITED_ISSUE_TYPES)
            )
        )
    ).scalars().all()
    existing_by_key = {issue.issue_key: issue for issue in existing}
    now = datetime.now(timezone.utc)

    for finding in findings:
        issue = existing_by_key.get(finding.issue_key)
        if issue is None:
            issue = ProcessAuditIssue(
                issue_key=finding.issue_key,
                issue_type=finding.issue_type,
                severity=finding.severity,
                status="open",
                summary=finding.summary,
                process_id=finding.process_id,
                communication_id=finding.communication_id,
                details=finding.details,
            )
            session.add(issue)
        else:
            if (
                issue.status == "resolved"
                and (issue.details or {}).get("resolution_reason")
            ):
                continue
            issue.severity = finding.severity
            issue.status = "open"
            issue.summary = finding.summary
            issue.details = finding.details
            issue.resolved_at = None

    for issue in existing:
        if issue.issue_key not in active_keys and issue.status == "open":
            issue.status = "resolved"
            issue.resolved_at = now


async def _run_cli(args: argparse.Namespace) -> int:
    async with db.AsyncSessionLocal() as session:
        repair_result = None
        resync_result = None
        if args.repair_normalized_data:
            repair_result = await backfill_normalized_data(session)
        if args.resync_flagged:
            resync_result = await resync_flagged_processes(session)
        report = await audit_process_integrity(session, persist=not args.no_persist)
    output = report.to_dict()
    if repair_result is not None:
        output["repair"] = repair_result
    if resync_result is not None:
        output["resync"] = resync_result
    print(json.dumps(output, ensure_ascii=False, indent=2, default=str))
    return 2 if args.fail_on_findings and report.unresolved_count else 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Audita vinculos entre processos, DJEN e DataJud",
    )
    parser.add_argument(
        "--repair-normalized-data",
        action="store_true",
        help="Preenche eventos e associacoes explicitas ausentes antes da auditoria",
    )
    parser.add_argument(
        "--no-persist",
        action="store_true",
        help="Nao atualiza a fila persistida de revisao",
    )
    parser.add_argument(
        "--resync-flagged",
        action="store_true",
        help="Reconsulta DJEN e DataJud para processos sinalizados antes da auditoria",
    )
    parser.add_argument(
        "--fail-on-findings",
        action="store_true",
        help="Retorna codigo 2 quando restarem divergencias",
    )
    raise SystemExit(asyncio.run(_run_cli(parser.parse_args())))


if __name__ == "__main__":
    main()
