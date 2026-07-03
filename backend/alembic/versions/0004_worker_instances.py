"""add worker instance registry

Revision ID: 0004_worker_instances
Revises: 0003_risk_keywords
Create Date: 2026-07-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0004_worker_instances"
down_revision: str | None = "0003_risk_keywords"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "worker_instances",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("hostname", sa.String(length=255), nullable=True),
        sa.Column("process_id", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_run_id", sa.String(length=36), nullable=True),
        sa.Column("stop_requested", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("processed_runs", sa.Integer(), server_default="0", nullable=False),
        sa.Column("poll_interval_seconds", sa.Integer(), server_default="5", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["current_run_id"], ["search_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_worker_instances_current_run_id"), "worker_instances", ["current_run_id"], unique=False)
    op.create_index(op.f("ix_worker_instances_kind"), "worker_instances", ["kind"], unique=False)
    op.create_index(
        "ix_worker_instances_status_heartbeat",
        "worker_instances",
        ["status", "heartbeat_at"],
        unique=False,
    )
    op.create_index(op.f("ix_worker_instances_status"), "worker_instances", ["status"], unique=False)
    op.create_index(op.f("ix_worker_instances_stop_requested"), "worker_instances", ["stop_requested"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_worker_instances_stop_requested"), table_name="worker_instances")
    op.drop_index(op.f("ix_worker_instances_status"), table_name="worker_instances")
    op.drop_index("ix_worker_instances_status_heartbeat", table_name="worker_instances")
    op.drop_index(op.f("ix_worker_instances_kind"), table_name="worker_instances")
    op.drop_index(op.f("ix_worker_instances_current_run_id"), table_name="worker_instances")
    op.drop_table("worker_instances")
