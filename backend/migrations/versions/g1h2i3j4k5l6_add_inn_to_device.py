from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
revision: str = "g1h2i3j4k5l6"
down_revision: Union[str, Sequence[str], None] = "f9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    op.add_column("devices", sa.Column("inn", sa.String(length=12), nullable=True))
def downgrade() -> None:
    op.drop_column("devices", "inn")
