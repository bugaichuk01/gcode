from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s3t4u5v6w7x8"
down_revision: Union[str, Sequence[str], None] = "6d72fe82179e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE product_card_status ADD VALUE IF NOT EXISTS 'awaiting_sign'"
    )
    op.execute("ALTER TYPE product_card_status ADD VALUE IF NOT EXISTS 'archived'")
    op.add_column(
        "product_cards",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("product_cards", "updated_at")
