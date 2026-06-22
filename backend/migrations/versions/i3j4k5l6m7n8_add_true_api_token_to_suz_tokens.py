from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
revision: str = "i3j4k5l6m7n8"
down_revision: Union[str, Sequence[str], None] = "h2i3j4k5l6m7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    op.add_column("suz_tokens", sa.Column("true_api_token", sa.Text(), nullable=True))
    op.add_column(
        "suz_tokens",
        sa.Column("true_api_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
def downgrade() -> None:
    op.drop_column("suz_tokens", "true_api_expires_at")
    op.drop_column("suz_tokens", "true_api_token")
