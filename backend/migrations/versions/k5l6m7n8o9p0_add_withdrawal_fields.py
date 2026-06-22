from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "k5l6m7n8o9p0"
down_revision: Union[str, Sequence[str], None] = "j4k5l6m7n8o9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("withdrawal_reports", sa.Column("price", sa.Float(), nullable=True))
    op.add_column(
        "withdrawal_reports",
        sa.Column("primary_document_name", sa.String(length=256), nullable=True),
    )
    op.add_column(
        "withdrawal_reports",
        sa.Column("primary_document_number", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "withdrawal_reports",
        sa.Column("primary_document_date", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "withdrawal_reports",
        sa.Column("buyer_inn", sa.String(length=12), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("withdrawal_reports", "buyer_inn")
    op.drop_column("withdrawal_reports", "primary_document_date")
    op.drop_column("withdrawal_reports", "primary_document_number")
    op.drop_column("withdrawal_reports", "primary_document_name")
    op.drop_column("withdrawal_reports", "price")
