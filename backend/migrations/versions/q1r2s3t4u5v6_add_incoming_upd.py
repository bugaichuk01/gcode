"""add_incoming_upd

Revision ID: q1r2s3t4u5v6
Revises: p0q1r2s3t4u5
Create Date: 2026-06-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "q1r2s3t4u5v6"
down_revision: Union[str, Sequence[str], None] = "p0q1r2s3t4u5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

incoming_upd_status = postgresql.ENUM(
    "pending",
    "checked",
    "accepted",
    "rejected",
    name="incoming_upd_status",
    create_type=False,
)


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE incoming_upd_status AS ENUM (
                'pending', 'checked', 'accepted', 'rejected'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        """
    )
    op.create_table(
        "incoming_upds",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("document_number", sa.String(length=256), nullable=False),
        sa.Column("document_date", sa.String(length=32), nullable=True),
        sa.Column("seller_inn", sa.String(length=12), nullable=True),
        sa.Column("seller_name", sa.String(length=512), nullable=True),
        sa.Column("document_codes", sa.JSON(), nullable=False),
        sa.Column("scanned_codes", sa.JSON(), nullable=False),
        sa.Column("extra_codes", sa.JSON(), nullable=False),
        sa.Column("missing_codes", sa.JSON(), nullable=False),
        sa.Column("duplicate_codes", sa.JSON(), nullable=False),
        sa.Column("status", incoming_upd_status, nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_incoming_upds_org_id"), "incoming_upds", ["org_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_incoming_upds_org_id"), table_name="incoming_upds")
    op.drop_table("incoming_upds")
    op.execute("DROP TYPE IF EXISTS incoming_upd_status")
