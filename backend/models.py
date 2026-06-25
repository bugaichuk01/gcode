from __future__ import annotations
import uuid
from datetime import datetime
from enum import StrEnum
from sqlalchemy import JSON, Boolean, DateTime, Enum, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base
class ProductCardType(StrEnum):
    UNIT = "unit"
    SET = "set"
    TECH_CARD = "tech_card"
    BUNDLE = "bundle"
class ProductCardStatus(StrEnum):
    DRAFT = "draft"
    SENT = "sent"
    AWAITING_SIGN = "awaiting_sign"
    PUBLISHED = "published"
    ARCHIVED = "archived"
class EmissionOrderStatus(StrEnum):
    CREATED = "created"      
    PENDING = "pending"      
    AVAILABLE = "available"  
    EXHAUSTED = "exhausted"  
    CLOSED = "closed"        
    REJECTED = "rejected"    
def _enum_values(enum_cls: type[StrEnum]) -> list[str]:
    return [member.value for member in enum_cls]


class UserRole(StrEnum):
    ADMIN = "admin"
    USER = "user"


class UserStatus(StrEnum):
    ACTIVE = "active"
    BLOCKED = "blocked"


class User(Base):
    """Пользователь системы."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    email: Mapped[str | None] = mapped_column(String(256), nullable=True, unique=True)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", values_callable=_enum_values),
        nullable=False,
        default=UserRole.USER,
    )
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, name="user_status", values_callable=_enum_values),
        nullable=False,
        default=UserStatus.ACTIVE,
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    organizations: Mapped[list["Organization"]] = relationship(
        "Organization", back_populates="user", cascade="all, delete-orphan"
    )


class Organization(Base):
    """Организация (компания) пользователя."""

    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    inn: Mapped[str | None] = mapped_column(String(12), nullable=True)
    kpp: Mapped[str | None] = mapped_column(String(9), nullable=True)
    oms_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    connection_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    suz_api_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    true_api_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    wb_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ozon_client_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ozon_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    user: Mapped["User"] = relationship("User", back_populates="organizations")


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    oms_id: Mapped[str] = mapped_column(String(255), nullable=False)
    connection_id: Mapped[str] = mapped_column(String(512), nullable=False)
    inn: Mapped[str | None] = mapped_column(String(12), nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
class OrganizationSettings(Base):
    __tablename__ = "organization_settings"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    mchd_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
class OzonMapping(Base):
    __tablename__ = "ozon_mappings"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    gtin: Mapped[str] = mapped_column(String(14), nullable=False, unique=True, index=True)
    article: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    ozon_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
class DocumentUPD(Base):
    __tablename__ = "document_upds"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    document_number: Mapped[str] = mapped_column(String(128), nullable=False)
    marking_codes: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: [],
    )
    disable_owner_control: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    edo_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    xml_draft_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_format: Mapped[str | None] = mapped_column(String(64), nullable=True)
    signature_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_thumbprint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    signature_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    external_message_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    external_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    external_response_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    seller_inn: Mapped[str | None] = mapped_column(String(12), nullable=True)
    seller_kpp: Mapped[str | None] = mapped_column(String(9), nullable=True)
    seller_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    seller_address: Mapped[str | None] = mapped_column(String(512), nullable=True)
    buyer_inn: Mapped[str | None] = mapped_column(String(12), nullable=True)
    buyer_kpp: Mapped[str | None] = mapped_column(String(9), nullable=True)
    buyer_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    buyer_address: Mapped[str | None] = mapped_column(String(512), nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
class SuzToken(Base):
    __tablename__ = "suz_tokens"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    oms_connection_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    true_api_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    true_api_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
class ProductCard(Base):
    __tablename__ = "product_cards"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    type: Mapped[ProductCardType] = mapped_column(
        Enum(
            ProductCardType,
            name="product_card_type",
            values_callable=_enum_values,
        ),
        nullable=False,
    )
    tn_ved: Mapped[str] = mapped_column(String(32), nullable=False)
    gtin: Mapped[str | None] = mapped_column(String(14), nullable=True)
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[ProductCardStatus] = mapped_column(
        Enum(
            ProductCardStatus,
            name="product_card_status",
            values_callable=_enum_values,
        ),
        nullable=False,
        default=ProductCardStatus.DRAFT,
    )
    national_catalog_feed_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    national_catalog_feed_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    national_catalog_feed_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    brand: Mapped[str | None] = mapped_column(String(256), nullable=True)
    color: Mapped[str | None] = mapped_column(String(128), nullable=True)
    size: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    composition: Mapped[str | None] = mapped_column(String(512), nullable=True)
    country: Mapped[str | None] = mapped_column(String(128), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_kind: Mapped[str | None] = mapped_column(String(128), nullable=True)
    regulation: Mapped[str | None] = mapped_column(String(256), nullable=True)
    tn_ved_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    tn_ved_group: Mapped[str | None] = mapped_column(String(128), nullable=True)
    model_article_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model_article: Mapped[str | None] = mapped_column(String(256), nullable=True)
    custom_name: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_set: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    set_items: Mapped[list | None] = mapped_column(JSON, nullable=True)
    extra_attrs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class GeneratedGtin(Base):
    """Сгенерированные GTIN — пул для переиспользования (ТЗ НК)."""

    __tablename__ = "generated_gtins"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    gtin: Mapped[str] = mapped_column(String(14), nullable=False, unique=True)
    is_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class EmissionOrder(Base):
    __tablename__ = "emission_orders"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    product_card_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("product_cards.id", ondelete="CASCADE"),
        nullable=True,
    )
    gtin: Mapped[str | None] = mapped_column(String(14), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[EmissionOrderStatus] = mapped_column(
        Enum(
            EmissionOrderStatus,
            name="emission_order_status",
            values_callable=_enum_values,
        ),
        nullable=False,
        default=EmissionOrderStatus.CREATED,
    )
    suz_order_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    suz_marking_codes: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: [],
    )
    release_method_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    production_order_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    payment_type: Mapped[int | None] = mapped_column(Integer, nullable=True)
    product_group: Mapped[str] = mapped_column(String(64), nullable=False, default="perfumery")
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
class GtinExtraFields(Base):
    __tablename__ = "gtin_extra_fields"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    gtin: Mapped[str] = mapped_column(String(14), nullable=False, unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    article: Mapped[str | None] = mapped_column(String(128), nullable=True)
    size: Mapped[str | None] = mapped_column(String(64), nullable=True)
    color: Mapped[str | None] = mapped_column(String(128), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(128), nullable=True)
    country: Mapped[str | None] = mapped_column(String(128), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(256), nullable=True)
    composition: Mapped[str | None] = mapped_column(String(512), nullable=True)
    edo_inn: Mapped[str | None] = mapped_column(String(12), nullable=True)
    edo_kpp: Mapped[str | None] = mapped_column(String(9), nullable=True)
    edo_address: Mapped[str | None] = mapped_column(String(512), nullable=True)
    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ExtraFieldsTemplate(Base):
    __tablename__ = "extra_fields_templates"
    __table_args__ = (
        UniqueConstraint("org_id", "name", name="uq_extra_fields_templates_org_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    fields: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class UtilisationStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ERROR = "error"
class UtilisationReport(Base):
    __tablename__ = "utilisation_reports"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    product_group: Mapped[str] = mapped_column(String(64), nullable=False, default="perfumery")
    marking_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[UtilisationStatus] = mapped_column(
        Enum(UtilisationStatus, name="utilisation_status", values_callable=_enum_values),
        nullable=False,
        default=UtilisationStatus.DRAFT,
    )
    report_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
class WithdrawalStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ERROR = "error"
class WithdrawalReport(Base):
    __tablename__ = "withdrawal_reports"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    withdrawal_type: Mapped[str] = mapped_column(String(64), nullable=False, default="SOLD")
    product_group: Mapped[str] = mapped_column(String(64), nullable=False, default="perfumery")
    marking_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[WithdrawalStatus] = mapped_column(
        Enum(WithdrawalStatus, name="withdrawal_status", values_callable=_enum_values),
        nullable=False,
        default=WithdrawalStatus.DRAFT,
    )
    document_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    primary_document_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    primary_document_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    primary_document_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    action_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    buyer_inn: Mapped[str | None] = mapped_column(String(12), nullable=True)
    marketplace_source: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
class AggregationStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ERROR = "error"
class AggregationDocument(Base):
    """Документ агрегации КИТУ."""
    __tablename__ = "aggregation_documents"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    kitu_code: Mapped[str] = mapped_column(String(72), nullable=False)
    product_group: Mapped[str] = mapped_column(String(64), nullable=False, default="perfumery")
    marking_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    units_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    aggregation_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="AGGREGATION"
    )
    product_card_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("product_cards.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[AggregationStatus] = mapped_column(
        Enum(
            AggregationStatus,
            name="aggregation_status",
            values_callable=_enum_values,
        ),
        nullable=False,
        default=AggregationStatus.DRAFT,
    )
    document_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
class ReturnStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ERROR = "error"
class ReturnDocument(Base):
    """Документ возврата в оборот."""
    __tablename__ = "return_documents"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    return_type: Mapped[str] = mapped_column(String(64), nullable=False, default="RETURN")
    product_group: Mapped[str] = mapped_column(String(64), nullable=False, default="perfumery")
    marking_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[ReturnStatus] = mapped_column(
        Enum(ReturnStatus, name="return_status", values_callable=_enum_values),
        nullable=False,
        default=ReturnStatus.DRAFT,
    )
    document_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class IncomingUPDStatus(StrEnum):
    PENDING = "pending"
    CHECKED = "checked"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class IncomingUPD(Base):
    """Входящий УПД от поставщика."""

    __tablename__ = "incoming_upds"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_number: Mapped[str] = mapped_column(String(256), nullable=False)
    document_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    seller_inn: Mapped[str | None] = mapped_column(String(12), nullable=True)
    seller_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    document_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=lambda: [])
    scanned_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=lambda: [])
    extra_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=lambda: [])
    missing_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=lambda: [])
    duplicate_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=lambda: [])
    status: Mapped[IncomingUPDStatus] = mapped_column(
        Enum(
            IncomingUPDStatus,
            name="incoming_upd_status",
            values_callable=_enum_values,
        ),
        nullable=False,
        default=IncomingUPDStatus.PENDING,
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class OperationLogType(StrEnum):
    ORDER_CREATED = "order_created"
    ORDER_SENT = "order_sent"
    ORDER_CODES_DOWNLOADED = "codes_downloaded"
    ORDER_CLOSED = "order_closed"
    UTILISATION_SENT = "utilisation_sent"
    WITHDRAWAL_SENT = "withdrawal_sent"
    AGGREGATION_SENT = "aggregation_sent"
    RETURN_SENT = "return_sent"
    UPD_CREATED = "upd_created"
    UPD_SENT = "upd_sent"
    CIS_STATUS_CHECKED = "cis_checked"
    LABEL_PRINTED = "label_printed"
    CARD_CREATED = "card_created"
    TOKEN_UPDATED = "token_updated"
class OperationLogStatus(StrEnum):
    SUCCESS = "success"
    ERROR = "error"
    PENDING = "pending"
class OperationLog(Base):
    """Журнал всех операций с системой маркировки."""
    __tablename__ = "operation_logs"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    operation_type: Mapped[OperationLogType] = mapped_column(
        Enum(OperationLogType, name="operation_log_type", values_callable=_enum_values),
        nullable=False,
    )
    status: Mapped[OperationLogStatus] = mapped_column(
        Enum(OperationLogStatus, name="operation_log_status", values_callable=_enum_values),
        nullable=False,
        default=OperationLogStatus.SUCCESS,
    )
    related_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    related_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    codes_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gtin: Mapped[str | None] = mapped_column(String(14), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
class LabelPdfFile(Base):
    """Сохранённый PDF пакетной печати этикеток."""

    __tablename__ = "label_pdf_files"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    pages_count: Mapped[int] = mapped_column(Integer, nullable=False)
    codes_count: Mapped[int] = mapped_column(Integer, nullable=False)
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("label_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LabelImage(Base):
    """Загруженное изображение для блока «Изображение» в конструкторе этикеток."""

    __tablename__ = "label_images"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    mime: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LabelTemplate(Base):
    __tablename__ = "label_templates"
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    width_mm: Mapped[int] = mapped_column(Integer, nullable=False, default=58)
    height_mm: Mapped[int] = mapped_column(Integer, nullable=False, default=40)
    layout_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
