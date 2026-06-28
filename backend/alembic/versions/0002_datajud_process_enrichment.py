"""add datajud process enrichment fields

Revision ID: 0002_datajud_process_enrichment
Revises: 0001_initial
Create Date: 2026-06-28
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0002_datajud_process_enrichment"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "processes",
        sa.Column("datajud_status", sa.String(length=32), server_default="pending", nullable=False),
    )
    op.add_column("processes", sa.Column("datajud_alias", sa.String(length=64), nullable=True))
    op.add_column("processes", sa.Column("datajud_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "processes",
        sa.Column("datajud_source_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "processes",
        sa.Column("datajud_last_movement_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("processes", sa.Column("datajud_filed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("processes", sa.Column("datajud_degree", sa.String(length=32), nullable=True))
    op.add_column("processes", sa.Column("datajud_secrecy_level", sa.Integer(), nullable=True))
    op.add_column("processes", sa.Column("datajud_system", sa.String(length=255), nullable=True))
    op.add_column("processes", sa.Column("datajud_format", sa.String(length=64), nullable=True))
    op.add_column("processes", sa.Column("datajud_subjects", sa.JSON(), nullable=True))
    op.add_column("processes", sa.Column("datajud_movements_count", sa.Integer(), nullable=True))
    op.add_column("processes", sa.Column("datajud_error", sa.Text(), nullable=True))
    op.add_column("processes", sa.Column("datajud_payload", sa.JSON(), nullable=True))
    op.create_index(op.f("ix_processes_datajud_status"), "processes", ["datajud_status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_processes_datajud_status"), table_name="processes")
    op.drop_column("processes", "datajud_payload")
    op.drop_column("processes", "datajud_error")
    op.drop_column("processes", "datajud_movements_count")
    op.drop_column("processes", "datajud_subjects")
    op.drop_column("processes", "datajud_format")
    op.drop_column("processes", "datajud_system")
    op.drop_column("processes", "datajud_secrecy_level")
    op.drop_column("processes", "datajud_degree")
    op.drop_column("processes", "datajud_filed_at")
    op.drop_column("processes", "datajud_last_movement_at")
    op.drop_column("processes", "datajud_source_updated_at")
    op.drop_column("processes", "datajud_synced_at")
    op.drop_column("processes", "datajud_alias")
    op.drop_column("processes", "datajud_status")
