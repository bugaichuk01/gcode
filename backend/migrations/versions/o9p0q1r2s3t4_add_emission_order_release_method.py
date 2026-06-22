"""add_emission_order_release_method

Revision ID: o9p0q1r2s3t4
Revises: a742fef2a815
Create Date: 2026-06-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "o9p0q1r2s3t4"
down_revision: Union[str, Sequence[str], None] = "a742fef2a815"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "emission_orders",
        sa.Column("release_method_type", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("emission_orders", "release_method_type")
