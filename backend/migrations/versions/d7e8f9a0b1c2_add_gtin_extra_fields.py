from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    op.create_table(
        "gtin_extra_fields",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gtin", sa.String(length=14), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=True),
        sa.Column("article", sa.String(length=128), nullable=True),
        sa.Column("size", sa.String(length=64), nullable=True),
        sa.Column("color", sa.String(length=128), nullable=True),
        sa.Column("barcode", sa.String(length=128), nullable=True),
        sa.Column("country", sa.String(length=128), nullable=True),
        sa.Column("brand", sa.String(length=256), nullable=True),
        sa.Column("composition", sa.String(length=512), nullable=True),
        sa.Column("edo_inn", sa.String(length=12), nullable=True),
        sa.Column("edo_kpp", sa.String(length=9), nullable=True),
        sa.Column("edo_address", sa.String(length=512), nullable=True),
        sa.Column("extra", sa.JSON(), nullable=True),
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
    op.create_index(op.f("ix_gtin_extra_fields_gtin"), "gtin_extra_fields", ["gtin"], unique=True)
def downgrade() -> None:
    op.drop_index(op.f("ix_gtin_extra_fields_gtin"), table_name="gtin_extra_fields")
    op.drop_table("gtin_extra_fields")
