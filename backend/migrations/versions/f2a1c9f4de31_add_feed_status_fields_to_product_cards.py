from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
revision: str = "f2a1c9f4de31"
down_revision: Union[str, Sequence[str], None] = "c66ac45d3bde"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    op.add_column("product_cards", sa.Column("national_catalog_feed_id", sa.String(length=64), nullable=True))
    op.add_column("product_cards", sa.Column("national_catalog_feed_status", sa.String(length=64), nullable=True))
    op.add_column("product_cards", sa.Column("national_catalog_feed_payload", sa.JSON(), nullable=True))
def downgrade() -> None:
    op.drop_column("product_cards", "national_catalog_feed_payload")
    op.drop_column("product_cards", "national_catalog_feed_status")
    op.drop_column("product_cards", "national_catalog_feed_id")
