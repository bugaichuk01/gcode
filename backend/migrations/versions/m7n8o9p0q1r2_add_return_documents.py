from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "m7n8o9p0q1r2"
down_revision: Union[str, Sequence[str], None] = "l6m7n8o9p0q1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

return_status = postgresql.ENUM(
    "draft",
    "pending",
    "accepted",
    "rejected",
    "error",
    name="return_status",
    create_type=False,
)


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE return_status AS ENUM (
                'draft', 'pending', 'accepted', 'rejected', 'error'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        """
    )
    op.create_table(
        "return_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("return_type", sa.String(length=64), nullable=False),
        sa.Column("product_group", sa.String(length=64), nullable=False),
        sa.Column("marking_codes", sa.JSON(), nullable=False),
        sa.Column("status", return_status, nullable=False),
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
    op.drop_table("return_documents")
    op.execute("DROP TYPE IF EXISTS return_status")
