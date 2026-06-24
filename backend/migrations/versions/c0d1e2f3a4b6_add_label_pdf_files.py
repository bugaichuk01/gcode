"""add_label_pdf_files

Revision ID: c0d1e2f3a4b6
Revises: b9c2d3e4f5a6
Create Date: 2026-06-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c0d1e2f3a4b6"
down_revision: Union[str, Sequence[str], None] = "b9c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "label_pdf_files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("pages_count", sa.Integer(), nullable=False),
        sa.Column("codes_count", sa.Integer(), nullable=False),
        sa.Column("template_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["template_id"], ["label_templates.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_label_pdf_files_org_id"), "label_pdf_files", ["org_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_label_pdf_files_org_id"), table_name="label_pdf_files")
    op.drop_table("label_pdf_files")
