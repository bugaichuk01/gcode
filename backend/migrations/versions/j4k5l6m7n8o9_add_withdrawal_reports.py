from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
revision: str = "j4k5l6m7n8o9"
down_revision: Union[str, Sequence[str], None] = "i3j4k5l6m7n8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
withdrawal_status = postgresql.ENUM(
    "draft",
    "pending",
    "accepted",
    "rejected",
    "error",
    name="withdrawal_status",
    create_type=False,
)
def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE withdrawal_status AS ENUM (
                'draft', 'pending', 'accepted', 'rejected', 'error'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        """
    )
    op.create_table(
        "withdrawal_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("withdrawal_type", sa.String(length=64), nullable=False),
        sa.Column("product_group", sa.String(length=64), nullable=False),
        sa.Column("marking_codes", sa.JSON(), nullable=False),
        sa.Column("status", withdrawal_status, nullable=False),
        sa.Column("document_id", sa.String(length=256), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("signature_value", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
def downgrade() -> None:
    op.drop_table("withdrawal_reports")
    op.execute("DROP TYPE IF EXISTS withdrawal_status")
