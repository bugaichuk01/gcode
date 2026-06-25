import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
import asyncio
from contextlib import asynccontextmanager
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from database import async_session_maker
from routers import (
    admin as admin_router,
    aggregation as aggregation_router,
    auth as auth_router,
    dashboard as dashboard_router,
    device,
    emission_order,
    excel,
    extra_fields,
    incoming_upd as incoming_upd_router,
    journal as journal_router,
    labels,
    marketplace as marketplace_router,
    organizations as org_router,
    ozon,
    product_card,
    returns as returns_router,
    token as token_router,
    upd,
    utilisation as utilisation_router,
    withdrawal as withdrawal_router,
)
from services.token_service import refresh_token_background
from settings import get_settings

logger = logging.getLogger(__name__)

APP_DESCRIPTION = """
## G-CODE — система управления маркировкой Честный Знак

### Основные разделы:
- **Аутентификация** (`/auth`) — логин, регистрация, профиль
- **Организации** (`/organizations`) — управление компаниями
- **Национальный каталог** (`/product-cards`) — карточки товаров в НК
- **Заказы СУЗ** (`/emission-orders`) — заказы и коды маркировки
- **Этикетки** (`/labels`) — генерация PDF с DataMatrix
- **УПД** (`/upd`) — универсальный передаточный документ
- **Ввод в оборот** (`/utilisation`) — отчёт о нанесении КМ
- **Вывод из оборота** (`/withdrawal`) — документ LK_RECEIPT
- **Агрегация КИТУ** (`/aggregation`) — транспортные упаковки
- **Возврат в оборот** (`/returns`) — документ LP_RETURN
- **Токены** (`/token`) — управление токенами СУЗ и True API
- **Журнал** (`/journal`) — история всех операций
- **Админ** (`/admin`) — управление пользователями (только admin)

### Авторизация:
Все эндпоинты (кроме `/auth/login` и `/auth/register`) требуют заголовок:
```
Authorization: Bearer {access_token}
```
Токен получается через POST /api/v1/auth/login.
"""


async def create_default_templates(db) -> None:
    """Создать шаблоны по умолчанию при первом запуске.

    Размеры 58×40, 43×25, 80×50, 40×20 должны совпадать с frontend LABEL_SIZE_PRESETS
    (frontend/src/labels/sizePresets.ts).
    """
    from sqlalchemy import select

    from models import LabelTemplate

    existing = await db.scalar(select(LabelTemplate).limit(1))
    if existing:
        return

    defaults = [
        LabelTemplate(
            name="Стандарт 58×40мм",
            width_mm=58,
            height_mm=40,
            is_default=True,
            org_id=None,
            layout_data={
                "elements": [
                    {"type": "datamatrix", "x": 20, "y": 2, "size": 36},
                    {
                        "type": "text",
                        "x": 2,
                        "y": 2,
                        "text": "{name}",
                        "font_size": 6,
                        "bold": True,
                        "max_width": 17,
                    },
                    {
                        "type": "text",
                        "x": 2,
                        "y": 10,
                        "text": "Арт: {article}",
                        "font_size": 5,
                        "max_width": 17,
                    },
                    {
                        "type": "text",
                        "x": 2,
                        "y": 16,
                        "text": "GTIN: {gtin}",
                        "font_size": 4,
                        "max_width": 17,
                    },
                    {
                        "type": "text",
                        "x": 2,
                        "y": 22,
                        "text": "Размер: {size}",
                        "font_size": 5,
                        "max_width": 17,
                    },
                ]
            },
        ),
        LabelTemplate(
            name="Малая 43×25мм",
            width_mm=43,
            height_mm=25,
            is_default=False,
            org_id=None,
            layout_data={
                "elements": [
                    {"type": "datamatrix", "x": 21, "y": 2, "size": 21},
                    {
                        "type": "text",
                        "x": 2,
                        "y": 2,
                        "text": "{name}",
                        "font_size": 5,
                        "bold": True,
                        "max_width": 18,
                    },
                    {
                        "type": "text",
                        "x": 2,
                        "y": 10,
                        "text": "{gtin}",
                        "font_size": 4,
                        "max_width": 18,
                    },
                    {
                        "type": "text",
                        "x": 2,
                        "y": 15,
                        "text": "Арт: {article}",
                        "font_size": 4,
                        "max_width": 18,
                    },
                ]
            },
        ),
        LabelTemplate(
            name="Широкая 80×50мм",
            width_mm=80,
            height_mm=50,
            is_default=False,
            org_id=None,
            layout_data={
                "elements": [
                    {"type": "datamatrix", "x": 34, "y": 2, "size": 45},
                    {
                        "type": "text",
                        "x": 2,
                        "y": 2,
                        "text": "{name}",
                        "font_size": 8,
                        "bold": True,
                        "max_width": 31,
                    },
                    {
                        "type": "text",
                        "x": 2,
                        "y": 14,
                        "text": "Арт: {article}",
                        "font_size": 6,
                        "max_width": 31,
                    },
                    {
                        "type": "text",
                        "x": 2,
                        "y": 22,
                        "text": "GTIN: {gtin}",
                        "font_size": 5,
                        "max_width": 31,
                    },
                    {
                        "type": "text",
                        "x": 2,
                        "y": 30,
                        "text": "Размер: {size}",
                        "font_size": 6,
                        "max_width": 31,
                    },
                ]
            },
        ),
        LabelTemplate(
            name="SSCC 40×20мм",
            width_mm=40,
            height_mm=20,
            is_default=False,
            org_id=None,
            layout_data={
                "elements": [
                    {
                        "type": "barcode_ean13",
                        "x": 2,
                        "y": 2,
                        "width": 36,
                        "height": 10,
                    },
                    {
                        "type": "field",
                        "x": 2,
                        "y": 14,
                        "field_key": "kitu_code",
                        "font_size": 5,
                        "max_width": 36,
                    },
                ]
            },
        ),
    ]
    for template in defaults:
        db.add(template)
    await db.commit()


async def ensure_sscc_default_template(db) -> None:
    """Добавить шаблон SSCC 40×20, если его ещё нет (для существующих установок)."""
    from sqlalchemy import select

    from models import LabelTemplate

    existing = await db.scalar(
        select(LabelTemplate).where(LabelTemplate.name == "SSCC 40×20мм").limit(1)
    )
    if existing:
        return

    db.add(
        LabelTemplate(
            name="SSCC 40×20мм",
            width_mm=40,
            height_mm=20,
            is_default=False,
            org_id=None,
            layout_data={
                "elements": [
                    {
                        "type": "barcode_ean13",
                        "x": 2,
                        "y": 2,
                        "width": 36,
                        "height": 10,
                    },
                    {
                        "type": "field",
                        "x": 2,
                        "y": 14,
                        "field_key": "kitu_code",
                        "font_size": 5,
                        "max_width": 36,
                    },
                ]
            },
        )
    )
    await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with async_session_maker() as db:
        from services.auth_service import create_admin_if_not_exists

        await create_admin_if_not_exists(db)
        await create_default_templates(db)
        await ensure_sscc_default_template(db)

    task = asyncio.create_task(refresh_token_background())
    logger.info("Фоновый мониторинг токена СУЗ запущен")
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="G-CODE API",
    description=APP_DESCRIPTION,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(auth_router.router)
api_v1.include_router(org_router.router)
api_v1.include_router(admin_router.router)
api_v1.include_router(device.router)
api_v1.include_router(ozon.router)
api_v1.include_router(excel.router)
api_v1.include_router(upd.router)
api_v1.include_router(incoming_upd_router.router)
api_v1.include_router(product_card.router)
api_v1.include_router(emission_order.router)
api_v1.include_router(extra_fields.router)
api_v1.include_router(labels.router)
api_v1.include_router(token_router.router)
api_v1.include_router(utilisation_router.router)
api_v1.include_router(withdrawal_router.router)
api_v1.include_router(aggregation_router.router)
api_v1.include_router(returns_router.router)
api_v1.include_router(journal_router.router)
api_v1.include_router(dashboard_router.router)
api_v1.include_router(marketplace_router.router)
app.include_router(api_v1)

_settings = get_settings()
_origins = [o.strip() for o in _settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title="G-CODE API",
        version="1.0.0",
        description=APP_DESCRIPTION,
        routes=app.routes,
        tags=[
            {"name": "auth", "description": "Аутентификация и управление профилем"},
            {"name": "organizations", "description": "Организации пользователя"},
            {
                "name": "National Catalog",
                "description": "Карточки товаров в Национальном каталоге",
            },
            {"name": "SUZ", "description": "Заказы на эмиссию КМ в СУЗ"},
            {"name": "labels", "description": "Генерация этикеток с DataMatrix"},
            {"name": "upd", "description": "Документы УПД"},
            {"name": "utilisation", "description": "Ввод в оборот (отчёт о нанесении)"},
            {"name": "withdrawal", "description": "Вывод из оборота"},
            {"name": "aggregation", "description": "Агрегация КИТУ (транспортные упаковки)"},
            {"name": "returns", "description": "Возврат в оборот"},
            {"name": "token", "description": "Токены СУЗ и True API"},
            {"name": "journal", "description": "Журнал операций"},
            {"name": "admin", "description": "Административная панель (только admin)"},
        ],
    )
    openapi_schema.setdefault("components", {})
    openapi_schema["components"]["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
        }
    }
    openapi_schema["security"] = [{"BearerAuth": []}]
    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
