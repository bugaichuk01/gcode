from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
revision: str = "f9a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "e8f9a0b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    op.create_table(
        "suz_tokens",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("oms_connection_id", sa.String(length=256), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column("document_upds", sa.Column("seller_inn", sa.String(length=12), nullable=True))
    op.add_column("document_upds", sa.Column("seller_kpp", sa.String(length=9), nullable=True))
    op.add_column("document_upds", sa.Column("seller_name", sa.String(length=512), nullable=True))
    op.add_column(
        "document_upds", sa.Column("seller_address", sa.String(length=512), nullable=True)
    )
    op.add_column("document_upds", sa.Column("buyer_inn", sa.String(length=12), nullable=True))
    op.add_column("document_upds", sa.Column("buyer_kpp", sa.String(length=9), nullable=True))
    op.add_column("document_upds", sa.Column("buyer_name", sa.String(length=512), nullable=True))
    op.add_column(
        "document_upds", sa.Column("buyer_address", sa.String(length=512), nullable=True)
    )
def downgrade() -> None:
    op.drop_column("document_upds", "buyer_address")
    op.drop_column("document_upds", "buyer_name")
    op.drop_column("document_upds", "buyer_kpp")
    op.drop_column("document_upds", "buyer_inn")
    op.drop_column("document_upds", "seller_address")
    op.drop_column("document_upds", "seller_name")
    op.drop_column("document_upds", "seller_kpp")
    op.drop_column("document_upds", "seller_inn")
    op.drop_table("suz_tokens")
