"""add risk keyword classification

Revision ID: 0003_risk_keywords
Revises: 0002_datajud_process_enrichment
Create Date: 2026-07-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0003_risk_keywords"
down_revision: str | None = "0002_datajud_process_enrichment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "risk_keywords",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("term", sa.String(length=255), nullable=False),
        sa.Column("normalized_term", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("risk_level", sa.String(length=16), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("normalized_term", name="uq_risk_keywords_normalized_term"),
    )
    op.create_index(op.f("ix_risk_keywords_active"), "risk_keywords", ["active"], unique=False)
    op.create_index(
        op.f("ix_risk_keywords_normalized_term"),
        "risk_keywords",
        ["normalized_term"],
        unique=False,
    )
    op.create_index(op.f("ix_risk_keywords_risk_level"), "risk_keywords", ["risk_level"], unique=False)

    op.create_table(
        "communication_risk_matches",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("communication_id", sa.String(length=36), nullable=False),
        sa.Column("risk_keyword_id", sa.String(length=36), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("matched_text", sa.String(length=255), nullable=False),
        sa.Column("excerpt", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["communication_id"], ["communications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["risk_keyword_id"], ["risk_keywords.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "communication_id",
            "risk_keyword_id",
            "source",
            name="uq_communication_risk_match_source",
        ),
    )
    op.create_index(
        "ix_communication_risk_matches_communication",
        "communication_risk_matches",
        ["communication_id"],
        unique=False,
    )
    op.create_index(
        "ix_communication_risk_matches_keyword",
        "communication_risk_matches",
        ["risk_keyword_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_communication_risk_matches_keyword", table_name="communication_risk_matches")
    op.drop_index("ix_communication_risk_matches_communication", table_name="communication_risk_matches")
    op.drop_table("communication_risk_matches")
    op.drop_index(op.f("ix_risk_keywords_risk_level"), table_name="risk_keywords")
    op.drop_index(op.f("ix_risk_keywords_normalized_term"), table_name="risk_keywords")
    op.drop_index(op.f("ix_risk_keywords_active"), table_name="risk_keywords")
    op.drop_table("risk_keywords")
