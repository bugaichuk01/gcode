"""add_generated_gtins_pool

Revision ID: a1b2c3d4e5f7
Revises: 502660c90116
Create Date: 2026-06-22 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, Sequence[str], None] = "502660c90116"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "generated_gtins",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gtin", sa.String(length=14), nullable=False),
        sa.Column("is_used", sa.Boolean(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gtin"),
    )


def downgrade() -> None:
    op.drop_table("generated_gtins")
