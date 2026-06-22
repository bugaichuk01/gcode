from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
revision: str = "b8b8bb8f9d9e"
down_revision: Union[str, Sequence[str], None] = "24f7df1eac7a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    op.add_column("document_upds", sa.Column("signature_format", sa.String(length=64), nullable=True))
    op.add_column("document_upds", sa.Column("signature_value", sa.Text(), nullable=True))
    op.add_column("document_upds", sa.Column("signature_thumbprint", sa.String(length=256), nullable=True))
    op.add_column("document_upds", sa.Column("signature_metadata", sa.JSON(), nullable=True))
    op.add_column("document_upds", sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("document_upds", sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("document_upds", sa.Column("external_message_id", sa.String(length=256), nullable=True))
    op.add_column("document_upds", sa.Column("external_status", sa.String(length=64), nullable=True))
    op.add_column("document_upds", sa.Column("external_response_payload", sa.JSON(), nullable=True))
def downgrade() -> None:
    op.drop_column("document_upds", "external_response_payload")
    op.drop_column("document_upds", "external_status")
    op.drop_column("document_upds", "external_message_id")
    op.drop_column("document_upds", "sent_at")
    op.drop_column("document_upds", "signed_at")
    op.drop_column("document_upds", "signature_metadata")
    op.drop_column("document_upds", "signature_thumbprint")
    op.drop_column("document_upds", "signature_value")
    op.drop_column("document_upds", "signature_format")
