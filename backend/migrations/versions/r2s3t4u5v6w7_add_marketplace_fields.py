"""add_marketplace_fields

Revision ID: r2s3t4u5v6w7
Revises: q1r2s3t4u5v6
Create Date: 2026-06-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "r2s3t4u5v6w7"
down_revision: Union[str, Sequence[str], None] = "q1r2s3t4u5v6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("wb_api_key", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("ozon_client_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("ozon_api_key", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "withdrawal_reports",
        sa.Column("marketplace_source", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("withdrawal_reports", "marketplace_source")
    op.drop_column("organizations", "ozon_api_key")
    op.drop_column("organizations", "ozon_client_id")
    op.drop_column("organizations", "wb_api_key")
