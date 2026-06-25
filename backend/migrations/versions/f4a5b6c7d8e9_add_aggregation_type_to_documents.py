"""add_aggregation_type_to_documents

Revision ID: f4a5b6c7d8e9
Revises: e2f3a4b5c6d8
Create Date: 2026-06-25 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f4a5b6c7d8e9"
down_revision: Union[str, Sequence[str], None] = "e2f3a4b5c6d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "aggregation_documents",
        sa.Column(
            "aggregation_type",
            sa.String(length=32),
            nullable=False,
            server_default="AGGREGATION",
        ),
    )
    op.add_column(
        "aggregation_documents",
        sa.Column("product_card_id", sa.Uuid(), nullable=True),
    )
    op.create_index(
        op.f("ix_aggregation_documents_product_card_id"),
        "aggregation_documents",
        ["product_card_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_aggregation_documents_product_card_id",
        "aggregation_documents",
        "product_cards",
        ["product_card_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.alter_column("aggregation_documents", "aggregation_type", server_default=None)


def downgrade() -> None:
    op.drop_constraint(
        "fk_aggregation_documents_product_card_id",
        "aggregation_documents",
        type_="foreignkey",
    )
    op.drop_index(
        op.f("ix_aggregation_documents_product_card_id"),
        table_name="aggregation_documents",
    )
    op.drop_column("aggregation_documents", "product_card_id")
    op.drop_column("aggregation_documents", "aggregation_type")
