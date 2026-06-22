"""add_operation_logs

Revision ID: n8o9p0q1r2s3
Revises: m7n8o9p0q1r2
Create Date: 2026-06-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "n8o9p0q1r2s3"
down_revision: Union[str, Sequence[str], None] = "m7n8o9p0q1r2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

operation_log_type = postgresql.ENUM(
    "order_created",
    "order_sent",
    "codes_downloaded",
    "order_closed",
    "utilisation_sent",
    "withdrawal_sent",
    "aggregation_sent",
    "return_sent",
    "upd_created",
    "upd_sent",
    "cis_checked",
    "label_printed",
    "card_created",
    "token_updated",
    name="operation_log_type",
    create_type=False,
)

operation_log_status = postgresql.ENUM(
    "success",
    "error",
    "pending",
    name="operation_log_status",
    create_type=False,
)


def upgrade() -> None:
    operation_log_type.create(op.get_bind(), checkfirst=True)
    operation_log_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "operation_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "operation_type",
            operation_log_type,
            nullable=False,
        ),
        sa.Column(
            "status",
            operation_log_status,
            nullable=False,
            server_default="success",
        ),
        sa.Column("related_id", sa.String(length=256), nullable=True),
        sa.Column("related_type", sa.String(length=64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("codes_count", sa.Integer(), nullable=True),
        sa.Column("gtin", sa.String(length=14), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_operation_logs_created_at"),
        "operation_logs",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_operation_logs_operation_type"),
        "operation_logs",
        ["operation_type"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_operation_logs_operation_type"), table_name="operation_logs")
    op.drop_index(op.f("ix_operation_logs_created_at"), table_name="operation_logs")
    op.drop_table("operation_logs")
    operation_log_status.drop(op.get_bind(), checkfirst=True)
    operation_log_type.drop(op.get_bind(), checkfirst=True)
