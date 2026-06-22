"""add_emission_order_product_group

Revision ID: 6d72fe82179e
Revises: 5c61fd61068d
Create Date: 2026-06-12

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "6d72fe82179e"
down_revision: Union[str, Sequence[str], None] = "5c61fd61068d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "emission_orders",
        sa.Column(
            "product_group",
            sa.String(length=64),
            nullable=False,
            server_default="perfumery",
        ),
    )
    op.alter_column("emission_orders", "product_group", server_default=None)


def downgrade() -> None:
    op.drop_column("emission_orders", "product_group")
