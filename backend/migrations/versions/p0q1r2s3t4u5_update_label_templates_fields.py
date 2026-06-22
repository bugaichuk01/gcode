"""update_label_templates_fields

Revision ID: p0q1r2s3t4u5
Revises: o9p0q1r2s3t4
Create Date: 2026-06-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p0q1r2s3t4u5"
down_revision: Union[str, Sequence[str], None] = "o9p0q1r2s3t4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("label_templates", "width", new_column_name="width_mm")
    op.alter_column("label_templates", "height", new_column_name="height_mm")
    op.add_column(
        "label_templates",
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "label_templates",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.add_column(
        "label_templates",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("label_templates", "updated_at")
    op.drop_column("label_templates", "created_at")
    op.drop_column("label_templates", "is_default")
    op.alter_column("label_templates", "height_mm", new_column_name="height")
    op.alter_column("label_templates", "width_mm", new_column_name="width")
