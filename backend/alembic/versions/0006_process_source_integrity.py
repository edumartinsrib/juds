"""normalize process sources, events, associations, and audit history

Revision ID: 0006_process_source_integrity
Revises: 0005_process_phase_keywords
Create Date: 2026-07-28
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from collections.abc import Sequence
from datetime import date, datetime, time, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0006_process_source_integrity"
down_revision: str | None = "0005_process_phase_keywords"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "processes",
        sa.Column("datajud_hit_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("processes", sa.Column("datajud_source_id", sa.String(length=36), nullable=True))
    op.add_column(
        "processes",
        sa.Column("datajud_candidate_source_id", sa.String(length=36), nullable=True),
    )
    op.add_column("processes", sa.Column("datajud_selection_reason", sa.Text(), nullable=True))
    op.add_column("processes", sa.Column("datajud_review_reason", sa.Text(), nullable=True))
    op.create_index(
        op.f("ix_processes_datajud_source_id"),
        "processes",
        ["datajud_source_id"],
        unique=False,
    )

    op.add_column(
        "client_processes",
        sa.Column(
            "association_status",
            sa.String(length=32),
            server_default="uncertain",
            nullable=False,
        ),
    )
    op.add_column(
        "client_processes",
        sa.Column("association_reason", sa.Text(), nullable=True),
    )

    _create_process_sources()
    _create_source_snapshots()
    _create_communication_versions()
    _create_client_communications()
    _create_process_events()
    _create_process_audit_issues()
    _create_migration_audit_tables()
    _backfill_normalized_data()


def _create_process_sources() -> None:
    op.create_table(
        "process_sources",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("process_id", sa.String(length=36), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_alias", sa.String(length=64), nullable=True),
        sa.Column("source_record_id", sa.String(length=255), nullable=False),
        sa.Column("numero_processo", sa.String(length=32), nullable=False),
        sa.Column("tribunal", sa.String(length=64), nullable=True),
        sa.Column("degree", sa.String(length=32), nullable=True),
        sa.Column("process_class", sa.String(length=255), nullable=True),
        sa.Column("agency", sa.String(length=255), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("filed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("selected_for_cover", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("selection_reason", sa.Text(), nullable=True),
        sa.Column("review_required", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["process_id"], ["processes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "process_id",
            "source",
            "source_record_id",
            name="uq_process_source_record",
        ),
    )
    op.create_index(
        "ix_process_sources_process_source",
        "process_sources",
        ["process_id", "source"],
        unique=False,
    )
    op.create_index(
        "ix_process_sources_review",
        "process_sources",
        ["review_required", "source"],
        unique=False,
    )
    op.create_index(
        op.f("ix_process_sources_numero_processo"),
        "process_sources",
        ["numero_processo"],
        unique=False,
    )


def _create_source_snapshots() -> None:
    op.create_table(
        "source_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("process_id", sa.String(length=36), nullable=False),
        sa.Column("process_source_id", sa.String(length=36), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_record_id", sa.String(length=255), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["process_id"], ["processes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["process_source_id"],
            ["process_sources.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "process_source_id",
            "payload_hash",
            name="uq_source_snapshot_payload",
        ),
    )
    op.create_index(
        "ix_source_snapshots_process_collected",
        "source_snapshots",
        ["process_id", "collected_at"],
        unique=False,
    )


def _create_communication_versions() -> None:
    op.create_table(
        "communication_versions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("communication_id", sa.String(length=36), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("change_reason", sa.String(length=64), nullable=False),
        sa.Column("previous_process_id", sa.String(length=36), nullable=False),
        sa.Column("previous_numero_processo", sa.String(length=32), nullable=False),
        sa.Column("previous_djen_hash", sa.String(length=128), nullable=True),
        sa.Column("previous_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("previous_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["communication_id"],
            ["communications.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "communication_id",
            "version_number",
            name="uq_communication_version",
        ),
    )
    op.create_index(
        "ix_communication_versions_communication",
        "communication_versions",
        ["communication_id"],
        unique=False,
    )


def _create_client_communications() -> None:
    op.create_table(
        "client_communications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("communication_id", sa.String(length=36), nullable=False),
        sa.Column("association_status", sa.String(length=32), nullable=False),
        sa.Column("match_reason", sa.Text(), nullable=False),
        sa.Column("matched_party_name", sa.String(length=255), nullable=True),
        sa.Column("matched_document", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["communication_id"],
            ["communications.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "client_id",
            "communication_id",
            name="uq_client_communication",
        ),
    )
    op.create_index(
        "ix_client_communications_status",
        "client_communications",
        ["client_id", "association_status"],
        unique=False,
    )


def _create_process_events() -> None:
    op.create_table(
        "process_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("process_id", sa.String(length=36), nullable=False),
        sa.Column("process_source_id", sa.String(length=36), nullable=True),
        sa.Column("communication_id", sa.String(length=36), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_record_id", sa.String(length=255), nullable=False),
        sa.Column("source_event_id", sa.String(length=255), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tribunal", sa.String(length=64), nullable=True),
        sa.Column("degree", sa.String(length=32), nullable=True),
        sa.Column("process_class", sa.String(length=255), nullable=True),
        sa.Column("agency", sa.String(length=255), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("text", sa.Text(), server_default="", nullable=False),
        sa.Column("complements", sa.JSON(), nullable=True),
        sa.Column("external_link", sa.Text(), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["process_id"], ["processes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["process_source_id"],
            ["process_sources.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["communication_id"],
            ["communications.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("communication_id"),
        sa.UniqueConstraint("source", "source_event_id", name="uq_process_event_source_id"),
    )
    op.create_index(
        "ix_process_events_process_occurred",
        "process_events",
        ["process_id", "occurred_at"],
        unique=False,
    )
    op.create_index(
        "ix_process_events_source_record",
        "process_events",
        ["source", "source_record_id"],
        unique=False,
    )


def _create_process_audit_issues() -> None:
    op.create_table(
        "process_audit_issues",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("process_id", sa.String(length=36), nullable=True),
        sa.Column("communication_id", sa.String(length=36), nullable=True),
        sa.Column("issue_key", sa.String(length=255), nullable=False),
        sa.Column("issue_type", sa.String(length=80), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["process_id"], ["processes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["communication_id"],
            ["communications.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("issue_key", name="uq_process_audit_issue_key"),
    )
    op.create_index(
        "ix_process_audit_issues_status_type",
        "process_audit_issues",
        ["status", "issue_type"],
        unique=False,
    )
    op.create_index(
        "ix_process_audit_issues_process",
        "process_audit_issues",
        ["process_id"],
        unique=False,
    )


def _create_migration_audit_tables() -> None:
    op.create_table(
        "data_migration_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("migration_key", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("backup_reference", sa.Text(), nullable=True),
        sa.Column("before_summary", sa.JSON(), nullable=False),
        sa.Column("after_summary", sa.JSON(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("migration_key"),
    )
    op.create_table(
        "data_migration_mappings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("migration_run_id", sa.String(length=36), nullable=False),
        sa.Column("old_entity_type", sa.String(length=64), nullable=False),
        sa.Column("old_entity_id", sa.String(length=255), nullable=False),
        sa.Column("new_entity_type", sa.String(length=64), nullable=False),
        sa.Column("new_entity_id", sa.String(length=255), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["migration_run_id"],
            ["data_migration_runs.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "migration_run_id",
            "old_entity_type",
            "old_entity_id",
            "new_entity_type",
            "new_entity_id",
            name="uq_data_migration_mapping",
        ),
    )
    op.create_index(
        "ix_data_migration_mappings_old",
        "data_migration_mappings",
        ["old_entity_type", "old_entity_id"],
        unique=False,
    )


def _backfill_normalized_data() -> None:
    bind = op.get_bind()
    run_id = str(uuid4())
    processes = bind.execute(
        sa.text(
            "SELECT id, numero_processo, tribunal, process_class, agency, "
            "datajud_alias, datajud_payload, datajud_synced_at "
            "FROM processes"
        )
    ).mappings().all()
    communications = bind.execute(
        sa.text(
            "SELECT id, process_id, djen_id, djen_hash, source_fingerprint, "
            "numero_processo, data_disponibilizacao, sigla_tribunal, "
            "tipo_comunicacao, nome_orgao, nome_classe, external_link, "
            "plain_text, raw_payload FROM communications"
        )
    ).mappings().all()
    before_summary = {
        "processes": len(processes),
        "communications": len(communications),
        "datajud_payloads": sum(1 for row in processes if row["datajud_payload"]),
    }
    bind.execute(
        sa.text(
            "INSERT INTO data_migration_runs "
            "(id, migration_key, status, backup_reference, before_summary, after_summary) "
            "VALUES (:id, :migration_key, :status, :backup_reference, :before_summary, :after_summary)"
        ),
        {
            "id": run_id,
            "migration_key": revision,
            "status": "running",
            "backup_reference": os.environ.get("JUDS_MIGRATION_BACKUP_REFERENCE"),
            "before_summary": json.dumps(before_summary),
            "after_summary": json.dumps({}),
        },
    )

    source_count = 0
    event_count = 0
    snapshot_count = 0
    mapping_count = 0
    for row in processes:
        payload = _json_value(row["datajud_payload"])
        if not payload:
            continue
        source_id = str(uuid4())
        source_record_id = str(
            payload.get("id")
            or payload.get("_id")
            or f"datajud-{_payload_hash(payload)}"
        )
        numero_processo = _digits(payload.get("numeroProcesso")) or row["numero_processo"]
        bind.execute(
            sa.text(
                "INSERT INTO process_sources "
                "(id, process_id, source, source_alias, source_record_id, numero_processo, "
                "tribunal, degree, process_class, agency, source_updated_at, filed_at, "
                "selected_for_cover, selection_reason, review_required, raw_payload) "
                "VALUES (:id, :process_id, 'DATAJUD', :source_alias, :source_record_id, "
                ":numero_processo, :tribunal, :degree, :process_class, :agency, "
                ":source_updated_at, :filed_at, true, :selection_reason, false, :raw_payload)"
            ),
            {
                "id": source_id,
                "process_id": row["id"],
                "source_alias": row["datajud_alias"],
                "source_record_id": source_record_id,
                "numero_processo": numero_processo,
                "tribunal": payload.get("tribunal") or row["tribunal"],
                "degree": payload.get("grau"),
                "process_class": _object_name(payload.get("classe")) or row["process_class"],
                "agency": _object_name(payload.get("orgaoJulgador")) or row["agency"],
                "source_updated_at": _parse_datetime(payload.get("dataHoraUltimaAtualizacao")),
                "filed_at": _parse_datetime(payload.get("dataAjuizamento")),
                "selection_reason": "migracao_payload_legado_unico",
                "raw_payload": json.dumps(payload),
            },
        )
        bind.execute(
            sa.text(
                "UPDATE processes SET datajud_source_id=:source_id, "
                "datajud_candidate_source_id=:source_id, datajud_hit_count=1, "
                "datajud_selection_reason='migracao_payload_legado_unico' WHERE id=:process_id"
            ),
            {"source_id": source_id, "process_id": row["id"]},
        )
        source_count += 1
        snapshot_id = str(uuid4())
        bind.execute(
            sa.text(
                "INSERT INTO source_snapshots "
                "(id, process_id, process_source_id, source, source_record_id, "
                "payload_hash, payload, collected_at) "
                "VALUES (:id, :process_id, :process_source_id, 'DATAJUD', "
                ":source_record_id, :payload_hash, :payload, :collected_at)"
            ),
            {
                "id": snapshot_id,
                "process_id": row["id"],
                "process_source_id": source_id,
                "source_record_id": source_record_id,
                "payload_hash": _payload_hash(payload),
                "payload": json.dumps(payload),
                "collected_at": row["datajud_synced_at"] or datetime.now(timezone.utc),
            },
        )
        snapshot_count += 1
        _insert_mapping(
            bind,
            run_id,
            "process",
            row["id"],
            "process_source",
            source_id,
            "DataJud legado normalizado",
        )
        mapping_count += 1
        hashes: dict[str, int] = {}
        for movement in payload.get("movimentos") or []:
            if not isinstance(movement, dict):
                continue
            movement_hash = _payload_hash(movement)
            hashes[movement_hash] = hashes.get(movement_hash, 0) + 1
            event_id = str(uuid4())
            source_event_id = (
                f"datajud:{source_record_id}:{movement_hash}:{hashes[movement_hash]}"
            )
            bind.execute(
                sa.text(
                    "INSERT INTO process_events "
                    "(id, process_id, process_source_id, communication_id, source, "
                    "source_record_id, source_event_id, event_type, occurred_at, tribunal, "
                    "degree, process_class, agency, title, text, complements, external_link, "
                    "raw_payload) VALUES "
                    "(:id, :process_id, :process_source_id, NULL, 'DATAJUD', "
                    ":source_record_id, :source_event_id, 'procedural_movement', "
                    ":occurred_at, :tribunal, :degree, :process_class, :agency, "
                    ":title, :text, :complements, NULL, :raw_payload)"
                ),
                {
                    "id": event_id,
                    "process_id": row["id"],
                    "process_source_id": source_id,
                    "source_record_id": source_record_id,
                    "source_event_id": source_event_id,
                    "occurred_at": (
                        _parse_datetime(movement.get("dataHora"))
                        or _parse_datetime(payload.get("dataHoraUltimaAtualizacao"))
                        or datetime.now(timezone.utc)
                    ),
                    "tribunal": payload.get("tribunal") or row["tribunal"],
                    "degree": payload.get("grau"),
                    "process_class": _object_name(payload.get("classe")),
                    "agency": (
                        _object_name(movement.get("orgaoJulgador"))
                        or _object_name(payload.get("orgaoJulgador"))
                    ),
                    "title": movement.get("nome") or "Movimento processual",
                    "text": movement.get("nome") or "",
                    "complements": json.dumps(_movement_complements(movement)),
                    "raw_payload": json.dumps(movement),
                },
            )
            event_count += 1

    for row in communications:
        raw_payload = _json_value(row["raw_payload"]) or {}
        source_record_id = str(
            row["djen_id"] or row["djen_hash"] or row["source_fingerprint"]
        )
        event_id = str(uuid4())
        occurred_on = row["data_disponibilizacao"]
        occurred_at = (
            datetime.combine(occurred_on, time.min, tzinfo=timezone.utc)
            if isinstance(occurred_on, date) and not isinstance(occurred_on, datetime)
            else occurred_on
        )
        bind.execute(
            sa.text(
                "INSERT INTO process_events "
                "(id, process_id, process_source_id, communication_id, source, "
                "source_record_id, source_event_id, event_type, occurred_at, tribunal, "
                "degree, process_class, agency, title, text, complements, external_link, "
                "raw_payload) VALUES "
                "(:id, :process_id, NULL, :communication_id, 'DJEN', :source_record_id, "
                ":source_event_id, 'publication', :occurred_at, :tribunal, NULL, "
                ":process_class, :agency, :title, :text, :complements, :external_link, "
                ":raw_payload)"
            ),
            {
                "id": event_id,
                "process_id": row["process_id"],
                "communication_id": row["id"],
                "source_record_id": source_record_id,
                "source_event_id": f"djen:{source_record_id}",
                "occurred_at": occurred_at or datetime.now(timezone.utc),
                "tribunal": row["sigla_tribunal"],
                "process_class": row["nome_classe"],
                "agency": row["nome_orgao"],
                "title": row["tipo_comunicacao"] or "Publicacao",
                "text": row["plain_text"] or "",
                "complements": json.dumps([]),
                "external_link": row["external_link"],
                "raw_payload": json.dumps(raw_payload),
            },
        )
        event_count += 1
        _insert_mapping(
            bind,
            run_id,
            "communication",
            row["id"],
            "process_event",
            event_id,
            "Publicacao DJEN normalizada",
        )
        mapping_count += 1

    association_count = _backfill_client_associations(bind, communications)
    after_summary = {
        "process_sources": source_count,
        "source_snapshots": snapshot_count,
        "process_events": event_count,
        "client_communications": association_count,
        "mappings": mapping_count,
    }
    bind.execute(
        sa.text(
            "UPDATE data_migration_runs SET status='completed', after_summary=:after_summary, "
            "completed_at=:completed_at WHERE id=:id"
        ),
        {
            "id": run_id,
            "after_summary": json.dumps(after_summary),
            "completed_at": datetime.now(timezone.utc),
        },
    )


def _backfill_client_associations(bind, communications) -> int:
    clients = {
        row["id"]: row
        for row in bind.execute(
            sa.text("SELECT id, name, cpf FROM clients")
        ).mappings().all()
    }
    by_process: dict[str, list] = {}
    for communication in communications:
        by_process.setdefault(communication["process_id"], []).append(communication)
    client_processes = bind.execute(
        sa.text("SELECT id, client_id, process_id FROM client_processes")
    ).mappings().all()
    inserted = 0
    priority = {"rejected": 0, "uncertain": 1, "probable": 2, "confirmed": 3}
    for link in client_processes:
        client = clients.get(link["client_id"])
        if not client:
            continue
        best_status = "uncertain"
        best_reason = "migracao_sem_comunicacao"
        accepted_count = 0
        for communication in by_process.get(link["process_id"], []):
            payload = _json_value(communication["raw_payload"]) or {}
            association = _association(
                client["name"],
                client["cpf"],
                payload.get("destinatarios") or [],
            )
            bind.execute(
                sa.text(
                    "INSERT INTO client_communications "
                    "(id, client_id, communication_id, association_status, match_reason, "
                    "matched_party_name, matched_document) VALUES "
                    "(:id, :client_id, :communication_id, :association_status, "
                    ":match_reason, :matched_party_name, :matched_document)"
                ),
                {
                    "id": str(uuid4()),
                    "client_id": link["client_id"],
                    "communication_id": communication["id"],
                    "association_status": association["status"],
                    "match_reason": association["reason"],
                    "matched_party_name": association["party_name"],
                    "matched_document": association["document"],
                },
            )
            inserted += 1
            if association["status"] != "rejected":
                accepted_count += 1
            if priority[association["status"]] > priority[best_status]:
                best_status = association["status"]
                best_reason = association["reason"]
        bind.execute(
            sa.text(
                "UPDATE client_processes SET association_status=:status, "
                "association_reason=:reason, communications_count=:count WHERE id=:id"
            ),
            {
                "id": link["id"],
                "status": best_status,
                "reason": best_reason,
                "count": accepted_count,
            },
        )
    return inserted


def _association(client_name: str, client_cpf: str | None, parties: list) -> dict:
    best = {
        "status": "uncertain",
        "reason": "destinatario_incompativel_ou_ausente",
        "party_name": None,
        "document": None,
    }
    priority = {"rejected": 0, "uncertain": 1, "probable": 2, "confirmed": 3}
    for party in parties:
        if not isinstance(party, dict):
            continue
        name = str(
            party.get("nome") or party.get("nomeParte") or party.get("nome_parte") or ""
        ).strip()
        document = _digits(
            party.get("cpf_cnpj")
            or party.get("cpfCnpj")
            or party.get("documento")
            or party.get("cpf")
        )
        quality = _name_quality(client_name, name)
        candidate = None
        if client_cpf and document and _digits(client_cpf) == document:
            candidate = ("confirmed", "documento_exato")
        elif client_cpf and document and quality != "none":
            candidate = ("rejected", "documento_divergente")
        elif quality == "exact":
            candidate = ("probable", "nome_exato_sem_documento")
        elif quality == "full":
            candidate = ("probable", "tokens_completos_sem_documento")
        elif quality == "partial":
            candidate = ("uncertain", "nome_parcial")
        if candidate and priority[candidate[0]] > priority[best["status"]]:
            best = {
                "status": candidate[0],
                "reason": candidate[1],
                "party_name": name,
                "document": document or None,
            }
    return best


def _name_quality(left: str, right: str) -> str:
    normalized_left = _normalize_name(left)
    normalized_right = _normalize_name(right)
    if not normalized_left or not normalized_right:
        return "none"
    if normalized_left == normalized_right:
        return "exact"
    particles = {"DA", "DAS", "DE", "DO", "DOS", "E"}
    left_tokens = {
        token
        for token in normalized_left.split()
        if len(token) >= 2 and token not in particles
    }
    right_tokens = {
        token
        for token in normalized_right.split()
        if len(token) >= 2 and token not in particles
    }
    if len(left_tokens) >= 2 and left_tokens.issubset(right_tokens):
        return "full"
    overlap = left_tokens & right_tokens
    if len(overlap) >= 2 and len(overlap) / max(len(left_tokens), 1) >= 0.6:
        return "partial"
    return "none"


def _normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", " ".join((value or "").split()))
    return "".join(
        character for character in normalized if not unicodedata.combining(character)
    ).upper()


def _insert_mapping(
    bind,
    run_id: str,
    old_type: str,
    old_id: str,
    new_type: str,
    new_id: str,
    reason: str,
) -> None:
    bind.execute(
        sa.text(
            "INSERT INTO data_migration_mappings "
            "(id, migration_run_id, old_entity_type, old_entity_id, new_entity_type, "
            "new_entity_id, reason) VALUES "
            "(:id, :run_id, :old_type, :old_id, :new_type, :new_id, :reason)"
        ),
        {
            "id": str(uuid4()),
            "run_id": run_id,
            "old_type": old_type,
            "old_id": str(old_id),
            "new_type": new_type,
            "new_id": str(new_id),
            "reason": reason,
        },
    )


def _json_value(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _payload_hash(payload: dict) -> str:
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _object_name(value) -> str | None:
    if not isinstance(value, dict):
        return None
    name = value.get("nome") or value.get("nomeOrgao")
    return str(name).strip() if name else None


def _parse_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _movement_complements(movement: dict) -> list[str]:
    return [
        str(item["nome"]).strip()
        for item in movement.get("complementosTabelados") or []
        if isinstance(item, dict) and item.get("nome")
    ]


def downgrade() -> None:
    op.drop_index("ix_data_migration_mappings_old", table_name="data_migration_mappings")
    op.drop_table("data_migration_mappings")
    op.drop_table("data_migration_runs")
    op.drop_index("ix_process_audit_issues_process", table_name="process_audit_issues")
    op.drop_index("ix_process_audit_issues_status_type", table_name="process_audit_issues")
    op.drop_table("process_audit_issues")
    op.drop_index("ix_process_events_source_record", table_name="process_events")
    op.drop_index("ix_process_events_process_occurred", table_name="process_events")
    op.drop_table("process_events")
    op.drop_index("ix_client_communications_status", table_name="client_communications")
    op.drop_table("client_communications")
    op.drop_index(
        "ix_communication_versions_communication",
        table_name="communication_versions",
    )
    op.drop_table("communication_versions")
    op.drop_index(
        "ix_source_snapshots_process_collected",
        table_name="source_snapshots",
    )
    op.drop_table("source_snapshots")
    op.drop_index(
        op.f("ix_process_sources_numero_processo"),
        table_name="process_sources",
    )
    op.drop_index("ix_process_sources_review", table_name="process_sources")
    op.drop_index("ix_process_sources_process_source", table_name="process_sources")
    op.drop_table("process_sources")
    op.drop_column("client_processes", "association_reason")
    op.drop_column("client_processes", "association_status")
    op.drop_index(op.f("ix_processes_datajud_source_id"), table_name="processes")
    op.drop_column("processes", "datajud_review_reason")
    op.drop_column("processes", "datajud_selection_reason")
    op.drop_column("processes", "datajud_candidate_source_id")
    op.drop_column("processes", "datajud_source_id")
    op.drop_column("processes", "datajud_hit_count")
