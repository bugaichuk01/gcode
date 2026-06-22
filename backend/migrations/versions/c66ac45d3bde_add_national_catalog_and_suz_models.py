from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
revision: str = 'c66ac45d3bde'
down_revision: Union[str, Sequence[str], None] = 'b8b8bb8f9d9e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    product_card_type = sa.Enum("unit", "set", "tech_card", "bundle", name="product_card_type")
    product_card_status = sa.Enum("draft", "sent", "published", name="product_card_status")
    emission_order_status = sa.Enum("created", "pending", "available", "rejected", name="emission_order_status")
    op.create_table(
        "label_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("layout_data", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "product_cards",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("type", product_card_type, nullable=False),
        sa.Column("tn_ved", sa.String(length=32), nullable=False),
        sa.Column("gtin", sa.String(length=14), nullable=True),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("status", product_card_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "emission_orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_card_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("status", emission_order_status, nullable=False),
        sa.Column("suz_order_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["product_card_id"], ["product_cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
def downgrade() -> None:
    op.drop_table("emission_orders")
    op.drop_table("product_cards")
    op.drop_table("label_templates")
