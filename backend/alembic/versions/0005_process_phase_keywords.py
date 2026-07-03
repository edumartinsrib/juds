"""add process phase keywords

Revision ID: 0005_process_phase_keywords
Revises: 0004_worker_instances
Create Date: 2026-07-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0005_process_phase_keywords"
down_revision: str | None = "0004_worker_instances"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "process_phase_keywords",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("phase_key", sa.String(length=80), nullable=False),
        sa.Column("phase_name", sa.String(length=120), nullable=False),
        sa.Column("phase_order", sa.Integer(), nullable=False),
        sa.Column("term", sa.String(length=255), nullable=False),
        sa.Column("normalized_term", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("is_default", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("phase_key", "normalized_term", name="uq_process_phase_keyword_term"),
    )
    op.create_index(op.f("ix_process_phase_keywords_active"), "process_phase_keywords", ["active"], unique=False)
    op.create_index(op.f("ix_process_phase_keywords_is_default"), "process_phase_keywords", ["is_default"], unique=False)
    op.create_index(
        op.f("ix_process_phase_keywords_normalized_term"),
        "process_phase_keywords",
        ["normalized_term"],
        unique=False,
    )
    op.create_index("ix_process_phase_keywords_order", "process_phase_keywords", ["phase_order"], unique=False)
    op.create_index("ix_process_phase_keywords_phase", "process_phase_keywords", ["phase_key"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_process_phase_keywords_phase", table_name="process_phase_keywords")
    op.drop_index("ix_process_phase_keywords_order", table_name="process_phase_keywords")
    op.drop_index(op.f("ix_process_phase_keywords_normalized_term"), table_name="process_phase_keywords")
    op.drop_index(op.f("ix_process_phase_keywords_is_default"), table_name="process_phase_keywords")
    op.drop_index(op.f("ix_process_phase_keywords_active"), table_name="process_phase_keywords")
    op.drop_table("process_phase_keywords")
