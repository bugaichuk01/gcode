"""add_units_capacity_to_aggregation_documents

Revision ID: e2f3a4b5c6d8
Revises: d1e2f3a4b5c7
Create Date: 2026-06-24 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2f3a4b5c6d8"
down_revision: Union[str, Sequence[str], None] = "d1e2f3a4b5c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "aggregation_documents",
        sa.Column("units_capacity", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("aggregation_documents", "units_capacity")
