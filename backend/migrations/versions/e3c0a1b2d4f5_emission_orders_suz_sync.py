from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
revision: str = "e3c0a1b2d4f5"
down_revision: Union[str, Sequence[str], None] = "f2a1c9f4de31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    op.alter_column(
        "emission_orders",
        "product_card_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )
    op.add_column("emission_orders", sa.Column("gtin", sa.String(length=14), nullable=True))
    op.create_index(
        "uq_emission_orders_suz_order_id",
        "emission_orders",
        ["suz_order_id"],
        unique=True,
        postgresql_where=sa.text("suz_order_id IS NOT NULL"),
    )
def downgrade() -> None:
    op.drop_index("uq_emission_orders_suz_order_id", table_name="emission_orders")
    op.drop_column("emission_orders", "gtin")
    op.alter_column(
        "emission_orders",
        "product_card_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
