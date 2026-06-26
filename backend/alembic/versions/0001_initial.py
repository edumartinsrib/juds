"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-25
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "clients",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("cpf", sa.String(length=11), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_clients_cpf"), "clients", ["cpf"], unique=False)
    op.create_index(op.f("ix_clients_normalized_name"), "clients", ["normalized_name"], unique=False)

    op.create_table(
        "processes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("numero_processo", sa.String(length=32), nullable=False),
        sa.Column("formatted_number", sa.String(length=32), nullable=False),
        sa.Column("tribunal", sa.String(length=64), nullable=True),
        sa.Column("process_class", sa.String(length=255), nullable=True),
        sa.Column("agency", sa.String(length=255), nullable=True),
        sa.Column("external_link", sa.Text(), nullable=True),
        sa.Column("last_communication_at", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("numero_processo"),
    )
    op.create_index(op.f("ix_processes_last_communication_at"), "processes", ["last_communication_at"], unique=False)
    op.create_index(op.f("ix_processes_numero_processo"), "processes", ["numero_processo"], unique=False)
    op.create_index(op.f("ix_processes_tribunal"), "processes", ["tribunal"], unique=False)

    op.create_table(
        "search_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("current_date", sa.Date(), nullable=True),
        sa.Column("current_page", sa.Integer(), nullable=False),
        sa.Column("total_imported", sa.Integer(), nullable=False),
        sa.Column("rate_limit_limit", sa.Integer(), nullable=True),
        sa.Column("rate_limit_remaining", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_search_runs_status"), "search_runs", ["status"], unique=False)

    op.create_table(
        "client_processes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("process_id", sa.String(length=36), nullable=False),
        sa.Column("cpf_status", sa.String(length=32), nullable=False),
        sa.Column("polo", sa.String(length=16), nullable=True),
        sa.Column("communications_count", sa.Integer(), nullable=False),
        sa.Column("last_movement_at", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["process_id"], ["processes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id", "process_id", name="uq_client_process"),
    )
    op.create_index(
        "ix_client_processes_client_status",
        "client_processes",
        ["client_id", "cpf_status"],
        unique=False,
    )

    op.create_table(
        "communications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("process_id", sa.String(length=36), nullable=False),
        sa.Column("djen_id", sa.BigInteger(), nullable=True),
        sa.Column("djen_hash", sa.String(length=128), nullable=True),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("numero_processo", sa.String(length=32), nullable=False),
        sa.Column("data_disponibilizacao", sa.Date(), nullable=False),
        sa.Column("sigla_tribunal", sa.String(length=64), nullable=True),
        sa.Column("tipo_comunicacao", sa.String(length=255), nullable=True),
        sa.Column("nome_orgao", sa.String(length=255), nullable=True),
        sa.Column("tipo_documento", sa.String(length=255), nullable=True),
        sa.Column("nome_classe", sa.String(length=255), nullable=True),
        sa.Column("meio", sa.String(length=64), nullable=True),
        sa.Column("external_link", sa.Text(), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("plain_text", sa.Text(), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["process_id"], ["processes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("djen_hash", name="uq_communications_djen_hash"),
        sa.UniqueConstraint("djen_id", name="uq_communications_djen_id"),
        sa.UniqueConstraint("source_fingerprint", name="uq_communications_source_fingerprint"),
    )
    op.create_index(
        "ix_communications_process_date",
        "communications",
        ["process_id", "data_disponibilizacao"],
        unique=False,
    )
    op.create_index(
        op.f("ix_communications_data_disponibilizacao"),
        "communications",
        ["data_disponibilizacao"],
        unique=False,
    )
    op.create_index(op.f("ix_communications_numero_processo"), "communications", ["numero_processo"], unique=False)

    op.create_table(
        "lawyers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("oab_number", sa.String(length=32), nullable=True),
        sa.Column("oab_state", sa.String(length=2), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", "oab_number", "oab_state", name="uq_lawyer_identity"),
    )
    op.create_index("ix_lawyers_name", "lawyers", ["name"], unique=False)

    op.create_table(
        "communication_parties",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("communication_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("cpf_cnpj", sa.String(length=32), nullable=True),
        sa.Column("polo", sa.String(length=16), nullable=True),
        sa.Column("is_client_match", sa.Boolean(), nullable=False),
        sa.Column("cpf_status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["communication_id"], ["communications.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_communication_parties_name", "communication_parties", ["normalized_name"], unique=False)

    op.create_table(
        "communication_lawyers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("communication_id", sa.String(length=36), nullable=False),
        sa.Column("lawyer_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["communication_id"], ["communications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lawyer_id"], ["lawyers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("communication_id", "lawyer_id", name="uq_communication_lawyer"),
    )


def downgrade() -> None:
    op.drop_table("communication_lawyers")
    op.drop_index("ix_communication_parties_name", table_name="communication_parties")
    op.drop_table("communication_parties")
    op.drop_index("ix_lawyers_name", table_name="lawyers")
    op.drop_table("lawyers")
    op.drop_index(op.f("ix_communications_numero_processo"), table_name="communications")
    op.drop_index(op.f("ix_communications_data_disponibilizacao"), table_name="communications")
    op.drop_index("ix_communications_process_date", table_name="communications")
    op.drop_table("communications")
    op.drop_index("ix_client_processes_client_status", table_name="client_processes")
    op.drop_table("client_processes")
    op.drop_index(op.f("ix_search_runs_status"), table_name="search_runs")
    op.drop_table("search_runs")
    op.drop_index(op.f("ix_processes_tribunal"), table_name="processes")
    op.drop_index(op.f("ix_processes_numero_processo"), table_name="processes")
    op.drop_index(op.f("ix_processes_last_communication_at"), table_name="processes")
    op.drop_table("processes")
    op.drop_index(op.f("ix_clients_normalized_name"), table_name="clients")
    op.drop_index(op.f("ix_clients_cpf"), table_name="clients")
    op.drop_table("clients")
