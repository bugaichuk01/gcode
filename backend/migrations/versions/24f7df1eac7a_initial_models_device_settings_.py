from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
revision: str = '24f7df1eac7a'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
def upgrade() -> None:
    op.create_table('devices',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('oms_id', sa.String(length=255), nullable=False),
    sa.Column('connection_id', sa.String(length=512), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('document_upds',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('document_number', sa.String(length=128), nullable=False),
    sa.Column('marking_codes', sa.JSON(), nullable=False),
    sa.Column('disable_owner_control', sa.Boolean(), nullable=False),
    sa.Column('edo_type', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('xml_draft_content', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('organization_settings',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('mchd_number', sa.String(length=128), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('ozon_mappings',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('gtin', sa.String(length=14), nullable=False),
    sa.Column('article', sa.String(length=255), nullable=False),
    sa.Column('name', sa.String(length=512), nullable=False),
    sa.Column('ozon_id', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ozon_mappings_gtin'), 'ozon_mappings', ['gtin'], unique=True)
def downgrade() -> None:
    op.drop_index(op.f('ix_ozon_mappings_gtin'), table_name='ozon_mappings')
    op.drop_table('ozon_mappings')
    op.drop_table('organization_settings')
    op.drop_table('document_upds')
    op.drop_table('devices')
