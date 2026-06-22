from __future__ import annotations
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from services.gtin_utils import normalize_gtin, validate_gtin_length
class EdoType(StrEnum):
    EDO_LITE = "edo_lite"
    COMMERCIAL_EDO = "commercial_edo"
class DocumentStatus(StrEnum):
    DRAFT = "draft"
    SIGNED = "signed"
    SENT = "sent"
class SignatureFormat(StrEnum):
    DETACHED_CMS_BASE64 = "detached_cms_base64"
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
class DeviceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    oms_id: str = Field(..., min_length=1, max_length=255)
    connection_id: str = Field(..., min_length=1, max_length=512)
    inn: str | None = Field(None, max_length=12)
class DeviceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    oms_id: str | None = Field(None, min_length=1, max_length=255)
    connection_id: str | None = Field(None, min_length=1, max_length=512)
    inn: str | None = Field(None, max_length=12)
class DeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    oms_id: str
    connection_id: str
    inn: str | None
    created_at: datetime
class DeviceFormDefaultsResponse(BaseModel):
    oms_id: str | None = None
    connection_id: str | None = None
class OrganizationSettingsCreate(BaseModel):
    mchd_number: str | None = Field(None, max_length=128)
class OrganizationSettingsUpdate(BaseModel):
    mchd_number: str | None = Field(None, max_length=128)
class OrganizationSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    mchd_number: str | None
    updated_at: datetime
class OzonMappingCreate(BaseModel):
    gtin: str = Field(..., min_length=8, max_length=14)
    article: str = Field(..., min_length=1, max_length=255)
    name: str = Field(..., min_length=1, max_length=512)
    ozon_id: str = Field(..., min_length=1, max_length=64)
class OzonMappingUpdate(BaseModel):
    gtin: str | None = Field(None, min_length=8, max_length=14)
    article: str | None = Field(None, min_length=1, max_length=255)
    name: str | None = Field(None, min_length=1, max_length=512)
    ozon_id: str | None = Field(None, min_length=1, max_length=64)
class OzonMappingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    gtin: str
    article: str
    name: str
    ozon_id: str
    created_at: datetime
class DocumentUPDCreate(BaseModel):
    document_number: str = Field(..., min_length=1, max_length=128)
    marking_codes: list[str] = Field(default_factory=list)
    disable_owner_control: bool = False
    edo_type: EdoType
    status: DocumentStatus = DocumentStatus.DRAFT
    xml_draft_content: str | None = None
class DocumentUPDUpdate(BaseModel):
    document_number: str | None = Field(None, min_length=1, max_length=128)
    marking_codes: list[str] | None = None
    disable_owner_control: bool | None = None
    edo_type: EdoType | None = None
    status: DocumentStatus | None = None
    xml_draft_content: str | None = None
class DocumentUPDResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    document_number: str
    marking_codes: list[str]
    disable_owner_control: bool
    edo_type: EdoType
    status: DocumentStatus
    xml_draft_content: str | None
    signature_format: SignatureFormat | None
    signature_thumbprint: str | None
    signature_metadata: dict[str, Any] | None
    signed_at: datetime | None
    sent_at: datetime | None
    external_message_id: str | None
    external_status: str | None
    created_at: datetime
class SetItem(BaseModel):
    gtin: str
    quantity: int = Field(default=1, ge=1)

    @field_validator("gtin", mode="before")
    @classmethod
    def _norm(cls, v: object) -> object:
        return normalize_gtin(str(v)) if v else v


class ProductCardCreate(BaseModel):
    type: ProductCardType
    tn_ved: str = Field(..., min_length=1, max_length=32)
    gtin: str | None = Field(None, min_length=8, max_length=14)
    cat_id: int | None = Field(None, gt=0)
    name: str = Field(..., min_length=1, max_length=512)
    status: ProductCardStatus = ProductCardStatus.DRAFT
    brand: str | None = None
    color: str | None = None
    size: str | None = None
    size_type: str | None = None
    composition: str | None = None
    country: str | None = None
    gender: str | None = None
    product_kind: str | None = None
    regulation: str | None = None
    tn_ved_code: str | None = None
    tn_ved_group: str | None = None
    model_article_type: str | None = None
    model_article: str | None = None
    custom_name: bool = False
    is_set: bool = False
    set_items: list[SetItem] | None = None
    extra_attrs: dict[str, Any] | None = None
    @field_validator("gtin", mode="before")
    @classmethod
    def _normalize_create_gtin(cls, v: object) -> object:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return normalize_gtin(str(v))
    @model_validator(mode="after")
    def validate_business_rules(self) -> "ProductCardCreate":
        if self.type == ProductCardType.BUNDLE:
            if not self.gtin:
                raise ValueError("Для набора требуется GTIN (сгенерируйте его)")
            if not self.set_items or len(self.set_items) == 0:
                raise ValueError("Для набора укажите хотя бы одно вложение (GTIN + количество)")
        elif self.type in {ProductCardType.UNIT, ProductCardType.SET} and not self.gtin:
            raise ValueError("Для типов Единица и Комплект требуется GTIN (регистрация в ГС1 РУС)")
        if self.gtin:
            gtin_err = validate_gtin_length(self.gtin)
            if gtin_err:
                raise ValueError(gtin_err)
        if not self.tn_ved.strip().isdigit():
            raise ValueError("ТН ВЭД должен содержать только цифры")
        return self
class ProductCardUpdate(BaseModel):
    type: ProductCardType | None = None
    tn_ved: str | None = Field(None, min_length=1, max_length=32)
    gtin: str | None = Field(None, min_length=8, max_length=14)
    name: str | None = Field(None, min_length=1, max_length=512)
    status: ProductCardStatus | None = None
    brand: str | None = None
    color: str | None = None
    size: str | None = None
    size_type: str | None = None
    composition: str | None = None
    country: str | None = None
    gender: str | None = None
    product_kind: str | None = None
    regulation: str | None = None
    tn_ved_code: str | None = None
    tn_ved_group: str | None = None
    model_article_type: str | None = None
    model_article: str | None = None
    custom_name: bool | None = None
    is_set: bool | None = None
    set_items: list[SetItem] | None = None
    extra_attrs: dict[str, Any] | None = None
    @field_validator("gtin", mode="before")
    @classmethod
    def _normalize_update_gtin(cls, v: object) -> object:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return normalize_gtin(str(v))
    @model_validator(mode="after")
    def validate_bundle_edit(self) -> "ProductCardUpdate":
        if self.gtin:
            gtin_err = validate_gtin_length(self.gtin)
            if gtin_err:
                raise ValueError(gtin_err)
        if self.tn_ved is not None and not self.tn_ved.strip().isdigit():
            raise ValueError("ТН ВЭД должен содержать только цифры")
        return self
class ProductCardResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    type: ProductCardType
    tn_ved: str
    gtin: str | None
    name: str
    status: ProductCardStatus
    national_catalog_feed_id: str | None
    national_catalog_feed_status: str | None
    national_catalog_feed_payload: dict[str, Any] | None
    created_at: datetime
    brand: str | None = None
    color: str | None = None
    size: str | None = None
    size_type: str | None = None
    composition: str | None = None
    country: str | None = None
    gender: str | None = None
    product_kind: str | None = None
    regulation: str | None = None
    tn_ved_code: str | None = None
    tn_ved_group: str | None = None
    model_article_type: str | None = None
    model_article: str | None = None
    custom_name: bool = False
    is_set: bool = False
    set_items: list[dict[str, Any]] | None = None
    extra_attrs: dict[str, Any] | None = None
class ProductCardListResponse(BaseModel):
    items: list[ProductCardResponse]
    total: int
    limit: int
    offset: int
class GtinExtraFieldsBase(BaseModel):
    gtin: str = Field(..., min_length=8, max_length=14)
    name: str | None = None
    article: str | None = None
    size: str | None = None
    color: str | None = None
    barcode: str | None = None
    country: str | None = None
    brand: str | None = None
    composition: str | None = None
    edo_inn: str | None = None
    edo_kpp: str | None = None
    edo_address: str | None = None
    extra: dict[str, Any] | None = None
class GtinExtraFieldsCreate(GtinExtraFieldsBase):
    pass
class GtinExtraFieldsUpdate(BaseModel):
    name: str | None = None
    article: str | None = None
    size: str | None = None
    color: str | None = None
    barcode: str | None = None
    country: str | None = None
    brand: str | None = None
    composition: str | None = None
    edo_inn: str | None = None
    edo_kpp: str | None = None
    edo_address: str | None = None
    extra: dict[str, Any] | None = None
class GtinExtraFieldsResponse(GtinExtraFieldsBase):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    created_at: datetime
    updated_at: datetime
class GtinExtraFieldsListResponse(BaseModel):
    items: list[GtinExtraFieldsResponse]
    total: int
class EmissionOrderCreate(BaseModel):
    product_card_id: UUID
    quantity: int = Field(..., gt=0)
    product_group: str = "perfumery"
    status: EmissionOrderStatus = EmissionOrderStatus.CREATED
    suz_order_id: str | None = Field(None, min_length=1, max_length=128)
    gtin: str | None = Field(None, min_length=8, max_length=14)
    release_method_type: str | None = Field(
        None,
        max_length=32,
        description="Способ выпуска в СУЗ: PRODUCTION, REMARK, REAPPLY и др.",
    )
    @field_validator("gtin", mode="before")
    @classmethod
    def _strip_optional_gtin(cls, v: object) -> object:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v
    @field_validator("gtin")
    @classmethod
    def _digits_gtin_order(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not str(v).isdigit():
            raise ValueError("GTIN должен содержать только цифры")
        return v
class EmissionOrderGtinPatch(BaseModel):
    gtin: str = Field(..., min_length=8, max_length=14)
    @field_validator("gtin")
    @classmethod
    def _digits_only(cls, v: str) -> str:
        s = v.strip()
        if not s.isdigit():
            raise ValueError("GTIN должен содержать только цифры")
        return s
class EmissionOrderUpdate(BaseModel):
    product_card_id: UUID | None = None
    quantity: int | None = Field(None, gt=0)
    status: EmissionOrderStatus | None = None
    suz_order_id: str | None = Field(None, min_length=1, max_length=128)
class EmissionOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    product_card_id: UUID | None
    gtin: str | None
    quantity: int
    status: EmissionOrderStatus
    suz_order_id: str | None
    suz_marking_codes: list[str] = Field(default_factory=list)
    release_method_type: str | None = None
    created_at: datetime
class MarkingCodePrintOptionsResponse(BaseModel):
    codes: list[str]
class MarkingCodeItem(BaseModel):
    code: str
    gtin: str | None
    order_id: str
    suz_order_id: str | None
    quantity_total: int
    created_at: datetime
class MarkingCodesListResponse(BaseModel):
    items: list[MarkingCodeItem]
    total: int
class CisStatusRequest(BaseModel):
    cises: list[str] = Field(..., min_length=1, max_length=50)
class CisStatusItem(BaseModel):
    cis: str
    status: str | None = None
    owner_inn: str | None = None
    owner_name: str | None = None
    gtin: str | None = None
    produced_date: str | None = None
    error: str | None = None
class CisStatusResponse(BaseModel):
    results: list[CisStatusItem]
    total: int
    checked: int
class FetchCodesResponse(BaseModel):
    order_id: UUID
    codes_count: int
    status: str
class CloseOrderRequest(BaseModel):
    signature: str  
class CloseOrderResponse(BaseModel):
    success: bool
    order_id: str
    status: str
class EmissionOrderStatusUpdateRequest(BaseModel):
    status: EmissionOrderStatus
class MergeOrdersRequest(BaseModel):
    order_ids: list[UUID] = Field(..., min_length=2)
class SuzSyncResponse(BaseModel):
    inserted: int
    updated: int
    total_remote: int
class SuzSendOrderPayload(BaseModel):
    remote_order_id: str
    payload: dict[str, Any]
class SuzOrderPayloadPreview(BaseModel):
    body: dict[str, Any]
    body_string: str
    release_method_type: str
    allowed_release_method_types: list[str]
    gtin: str
    product_group: str
    template_id: int
class SuzSignedProxyRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    order_body: dict[str, Any]
    body_string: str = Field(..., min_length=2)
    signature: str = Field(..., min_length=1)
    x_signature: str | None = Field(None, min_length=1, description="Устаревшее имя поля")
    local_order_id: UUID | None = None
    @model_validator(mode="after")
    def _resolve_signature(self) -> "SuzSignedProxyRequest":
        sig = (self.signature or self.x_signature or "").replace("\r", "").replace("\n", "").strip()
        if not sig:
            raise ValueError("Нужна подпись тела запроса (signature), сформированная в браузере через cadesplugin.")
        object.__setattr__(self, "signature", sig)
        return self
class SuzCreateOrderProxyRequest(SuzSignedProxyRequest):
    pass
class SuzSendOrderRequest(SuzSignedProxyRequest):
    pass
class SuzSendOrderResponse(BaseModel):
    emission_order: EmissionOrderResponse | None = None
    suz: SuzSendOrderPayload
class SuzConnectivityDiagnosticsResponse(BaseModel):
    heuristic_hints: list[str]
    suggested_base_url_when_nk_crptech_sandbox: str | None
    probes: list[dict[str, Any]]
    verdict: str
    docs_pointer: str
class LabelTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    width_mm: int = Field(58, gt=0)
    height_mm: int = Field(40, gt=0)
    layout_data: dict[str, Any] = Field(default_factory=dict)
    is_default: bool = False


class LabelTemplateUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    width_mm: int | None = Field(None, gt=0)
    height_mm: int | None = Field(None, gt=0)
    layout_data: dict[str, Any] | None = None
    is_default: bool | None = None


class LabelTemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    width_mm: int
    height_mm: int
    layout_data: dict[str, Any]
    is_default: bool
    created_at: datetime
class OzonParsedProduct(BaseModel):
    article: str
    name: str
    price_vat: str | None = Field(None, description="Цена/НДС одной строкой, если есть в файле")
    gtin: str
    ozon_id: str | None = None
class OzonParseXmlResponse(BaseModel):
    products: list[OzonParsedProduct]
class ExcelTemplateProduct(BaseModel):
    article: str = Field(..., min_length=1, max_length=255)
    name: str = Field(..., min_length=1, max_length=512)
    gtin: str = Field(..., min_length=8, max_length=14)
    ozon_id: str | None = Field(None, max_length=64)
class ExcelTemplateRequest(BaseModel):
    items: list[ExcelTemplateProduct] = Field(default_factory=list)
class ExcelImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
class MarkingCodesImportResult(BaseModel):
    added: int
    skipped: int
    errors: list[str] = Field(default_factory=list)
class UtilisationStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ERROR = "error"
class UtilisationReportCreate(BaseModel):
    marking_codes: list[str]
    product_group: str = "perfumery"
class UtilisationSendRequest(BaseModel):
    signature: str
class UtilisationReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    product_group: str
    marking_codes: list[str]
    status: UtilisationStatus
    report_id: str | None
    error_message: str | None
    created_at: datetime
    sent_at: datetime | None
class UtilisationBodyPreview(BaseModel):
    body: str
    body_dict: dict[str, Any]
class WithdrawalStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ERROR = "error"
class WithdrawalReportCreate(BaseModel):
    marking_codes: list[str]
    withdrawal_type: str = "SOLD"
    product_group: str = "perfumery"
class WithdrawalSendRequest(BaseModel):
    signature: str
class WithdrawalReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    withdrawal_type: str
    product_group: str
    marking_codes: list[str]
    status: WithdrawalStatus
    document_id: str | None
    error_message: str | None
    created_at: datetime
    sent_at: datetime | None
class WithdrawalBodyPreview(BaseModel):
    body: str
    body_b64: str
class ReturnStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ERROR = "error"
class ReturnDocumentCreate(BaseModel):
    marking_codes: list[str]
    return_type: str = "RETURN"
    product_group: str = "perfumery"
class ReturnSendRequest(BaseModel):
    signature: str
class ReturnDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    return_type: str
    product_group: str
    marking_codes: list[str]
    status: ReturnStatus
    document_id: str | None
    error_message: str | None
    created_at: datetime
    sent_at: datetime | None
class ReturnBodyPreview(BaseModel):
    body: str
    body_b64: str
class IntroduceOstBodyRequest(BaseModel):
    marking_codes: list[str]
    product_group: str = "perfumery"
class IntroduceOstRequest(BaseModel):
    marking_codes: list[str]
    product_group: str = "perfumery"
    signature: str = Field(..., min_length=1)
class IntroduceOstBodyPreview(BaseModel):
    body: str
    body_b64: str
class AggregationStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ERROR = "error"
class AggregationDocumentCreate(BaseModel):
    marking_codes: list[str]
    product_group: str = "perfumery"
    kitu_code: str | None = None
class AggregationSendRequest(BaseModel):
    signature: str
class AggregationDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    kitu_code: str
    product_group: str
    marking_codes: list[str]
    status: AggregationStatus
    document_id: str | None
    error_message: str | None
    created_at: datetime
    sent_at: datetime | None
class AggregationBodyPreview(BaseModel):
    body: str
    body_b64: str
    kitu_code: str
class UpdCreateRequest(BaseModel):
    document_number: str = Field(..., min_length=1, max_length=128)
    marking_codes: list[str] = Field(default_factory=list)
    disable_owner_control: bool = False
    edo_type: EdoType
    seller_inn: str | None = None
    seller_kpp: str | None = None
    seller_name: str | None = None
    seller_address: str | None = None
    buyer_inn: str | None = None
    buyer_kpp: str | None = None
    buyer_name: str | None = None
    buyer_address: str | None = None
class OperationLogType(StrEnum):
    ORDER_CREATED = "order_created"
    ORDER_SENT = "order_sent"
    CODES_DOWNLOADED = "codes_downloaded"
    ORDER_CLOSED = "order_closed"
    UTILISATION_SENT = "utilisation_sent"
    WITHDRAWAL_SENT = "withdrawal_sent"
    AGGREGATION_SENT = "aggregation_sent"
    RETURN_SENT = "return_sent"
    UPD_CREATED = "upd_created"
    UPD_SENT = "upd_sent"
    CIS_CHECKED = "cis_checked"
    LABEL_PRINTED = "label_printed"
    CARD_CREATED = "card_created"
    TOKEN_UPDATED = "token_updated"


class OperationLogStatus(StrEnum):
    SUCCESS = "success"
    ERROR = "error"
    PENDING = "pending"


class OperationLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    operation_type: str
    status: str
    description: str | None
    related_id: str | None
    related_type: str | None
    codes_count: int | None
    gtin: str | None
    error_message: str | None
    created_at: datetime

    @field_validator("operation_type", "status", mode="before")
    @classmethod
    def _coerce_enum_to_str(cls, value: Any) -> str:
        if hasattr(value, "value"):
            return value.value
        return str(value)


class JournalListResponse(BaseModel):
    items: list[OperationLogResponse]
    total: int
    limit: int
    offset: int


class UpdSendRequest(BaseModel):
    class SignaturePayload(BaseModel):
        format: SignatureFormat = SignatureFormat.DETACHED_CMS_BASE64
        value: str = Field(..., min_length=1)
        thumbprint: str | None = Field(None, min_length=1, max_length=256)
        signed_at: datetime | None = None
        metadata: dict[str, Any] = Field(default_factory=dict)
        @field_validator("value")
        @classmethod
        def validate_base64(cls, value: str) -> str:
            normalized = value.strip()
            if len(normalized) < 32:
                raise ValueError("Signature payload is too short")
            try:
                import base64
                base64.b64decode(normalized, validate=True)
            except Exception as exc:  
                raise ValueError("Signature value must be valid base64") from exc
            return normalized
    signature: SignaturePayload
