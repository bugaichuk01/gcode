from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
revision: str = "e8f9a0b2c3d4"
down_revision: Union[str, Sequence[str], None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    op.add_column("product_cards", sa.Column("brand", sa.String(length=256), nullable=True))
    op.add_column("product_cards", sa.Column("color", sa.String(length=128), nullable=True))
    op.add_column("product_cards", sa.Column("size", sa.String(length=64), nullable=True))
    op.add_column("product_cards", sa.Column("size_type", sa.String(length=64), nullable=True))
    op.add_column("product_cards", sa.Column("composition", sa.String(length=512), nullable=True))
    op.add_column("product_cards", sa.Column("country", sa.String(length=128), nullable=True))
    op.add_column("product_cards", sa.Column("gender", sa.String(length=64), nullable=True))
    op.add_column("product_cards", sa.Column("product_kind", sa.String(length=128), nullable=True))
    op.add_column("product_cards", sa.Column("regulation", sa.String(length=256), nullable=True))
    op.add_column("product_cards", sa.Column("tn_ved_code", sa.String(length=32), nullable=True))
    op.add_column("product_cards", sa.Column("tn_ved_group", sa.String(length=128), nullable=True))
    op.add_column("product_cards", sa.Column("model_article_type", sa.String(length=64), nullable=True))
    op.add_column("product_cards", sa.Column("model_article", sa.String(length=256), nullable=True))
    op.add_column(
        "product_cards",
        sa.Column("custom_name", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "product_cards",
        sa.Column("is_set", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("product_cards", sa.Column("extra_attrs", sa.JSON(), nullable=True))
    op.alter_column("product_cards", "custom_name", server_default=None)
    op.alter_column("product_cards", "is_set", server_default=None)
def downgrade() -> None:
    op.drop_column("product_cards", "extra_attrs")
    op.drop_column("product_cards", "is_set")
    op.drop_column("product_cards", "custom_name")
    op.drop_column("product_cards", "model_article")
    op.drop_column("product_cards", "model_article_type")
    op.drop_column("product_cards", "tn_ved_group")
    op.drop_column("product_cards", "tn_ved_code")
    op.drop_column("product_cards", "regulation")
    op.drop_column("product_cards", "product_kind")
    op.drop_column("product_cards", "gender")
    op.drop_column("product_cards", "country")
    op.drop_column("product_cards", "composition")
    op.drop_column("product_cards", "size_type")
    op.drop_column("product_cards", "size")
    op.drop_column("product_cards", "color")
    op.drop_column("product_cards", "brand")
