import os
from functools import lru_cache
from urllib.parse import quote, quote_plus
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine.url import make_url
from sqlalchemy.exc import ArgumentError
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
    database_url: str = Field(default="", validate_default=True)
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    edo_lite_send_url: str = "https://edo-api.crpt.ru/api/v1/document"
    edo_lite_auth_token: str | None = None
    edo_lite_timeout_seconds: float = 20.0
    edo_lite_retry_attempts: int = 3
    edo_lite_retry_delay_seconds: float = 1.0
    national_catalog_send_url: str | None = None
    national_catalog_api_key: str | None = None
    national_catalog_supplier_key: str | None = None
    national_catalog_auth_token: str | None = None
    national_catalog_timeout_seconds: float = 20.0
    national_catalog_retry_attempts: int = 3
    national_catalog_retry_delay_seconds: float = 1.0
    suz_api_base_url: str | None = None
    suz_client_token: str | None = None
    suz_auth_token: str | None = None
    suz_oms_id: str | None = None
    suz_connection_id: str | None = None
    suz_product_group: str = "perfumery"
    suz_timeout_seconds: float = 30.0
    suz_tls_verify: bool = False
    suz_ssl_compat: bool = True
    suz_curl_fallback: bool = True
    suz_order_contact_person: str = "integration@localhost"
    suz_order_release_method_type: str = "REMARK"
    suz_order_create_method_type: str = "SELF_MADE"
    suz_serial_number_type: str = "OPERATOR"
    suz_marking_template_id: int = 9
    suz_product_cis_type: str = "UNIT"
    suz_order_contract_number: str = "SANDBOX-CONTRACT"
    suz_order_contract_date: str = "2026-01-01"
    true_api_token: str | None = None  
    true_api_base_url: str = "https://markirovka.sandbox.crptech.ru"
    secret_key: str = Field(
        description="Секретный ключ для подписи JWT. Задать в .env!",
    )
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 8
    @field_validator("database_url", mode="before")
    @classmethod
    def resolve_database_url(cls, v: object) -> str:
        raw = v.strip() if isinstance(v, str) else ""
        def from_env_uri() -> str:
            return (
                (os.environ.get("DATABASE_URL") or "").strip()
                or (os.environ.get("DATABASE_PRIVATE_URL") or "").strip()
                or (os.environ.get("DATABASE_PUBLIC_URL") or "").strip()
            )
        if not raw or "://" not in raw:
            raw = from_env_uri()
        if "${{" in raw or (raw.startswith("${") and "}" in raw):
            raise ValueError(
                "DATABASE_URL не подставился (осталась ссылка ${{…}}). "
                "В Railway: Variables → Reference → Postgres → DATABASE_URL."
            )
        if not raw or "://" not in raw:
            host = (os.environ.get("PGHOST") or "").strip()
            user = (os.environ.get("PGUSER") or "").strip()
            password = (os.environ.get("PGPASSWORD") or "").strip()
            db = (os.environ.get("PGDATABASE") or "").strip()
            port = (os.environ.get("PGPORT") or "5432").strip()
            if host and user and db:
                raw = (
                    f"postgresql://{quote_plus(user)}:{quote_plus(password)}"
                    f"@{host}:{port}/{quote(db, safe='')}"
                )
        if not raw or "://" not in raw:
            raise ValueError(
                "Задайте DATABASE_URL (postgresql://…) или подключите Postgres на Railway "
                "и переменные PGHOST, PGUSER, PGDATABASE (и PGPASSWORD)."
            )
        if raw.startswith("postgres://"):
            raw = "postgresql+asyncpg://" + raw.removeprefix("postgres://")
        elif raw.startswith("postgresql://") and not raw.startswith("postgresql+asyncpg://"):
            raw = "postgresql+asyncpg://" + raw.removeprefix("postgresql://")
        try:
            make_url(raw)
        except ArgumentError as e:
            raise ValueError(
                "DATABASE_URL не разбирается как URL (спецсимволы в пароле — "
                "URL-encode в панели или используйте Reference из Postgres)."
            ) from e
        return raw
@lru_cache
def get_settings() -> Settings:
    return Settings()
def clear_settings_cache() -> None:
    get_settings.cache_clear()
