"""Интеграция с маркетплейсами WB и Ozon."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import Organization, User, WithdrawalReport, WithdrawalStatus
from services.marketplace_service import get_ozon_sales, get_wb_sales

router = APIRouter(prefix="/marketplace", tags=["marketplace"])


class SalesRequest(BaseModel):
    date_from: str
    date_to: str
    product_group: str = "perfumery"


class SaleItem(BaseModel):
    marking_code: str
    price: float
    sale_date: str
    order_id: str
    article: str = ""
    product_name: str = ""
    selected: bool = True


class SalesResponse(BaseModel):
    marketplace: str
    sales: list[SaleItem]
    total: int
    period: str


@router.post("/wb/sales", response_model=SalesResponse)
async def get_wb_sales_list(
    data: SalesRequest,
    current_user: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> SalesResponse:
    """Получить список продаж WB с кодами маркировки."""
    if not org:
        raise HTTPException(422, "Выберите организацию")

    api_key = org.wb_api_key or "DEMO_KEY"
    sales = await get_wb_sales(api_key, data.date_from, data.date_to)

    return SalesResponse(
        marketplace="wb",
        sales=[
            SaleItem(
                marking_code=s.marking_code,
                price=s.price,
                sale_date=s.sale_date,
                order_id=s.order_id,
                article=s.article,
                product_name=s.product_name,
                selected=True,
            )
            for s in sales
        ],
        total=len(sales),
        period=f"{data.date_from} — {data.date_to}",
    )


@router.post("/ozon/sales", response_model=SalesResponse)
async def get_ozon_sales_list(
    data: SalesRequest,
    current_user: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> SalesResponse:
    """Получить список продаж Ozon с кодами маркировки."""
    if not org:
        raise HTTPException(422, "Выберите организацию")

    client_id = org.ozon_client_id or "DEMO_CLIENT"
    api_key = org.ozon_api_key or "DEMO_KEY"
    sales = await get_ozon_sales(client_id, api_key, data.date_from, data.date_to)

    return SalesResponse(
        marketplace="ozon",
        sales=[
            SaleItem(
                marking_code=s.marking_code,
                price=s.price,
                sale_date=s.sale_date,
                order_id=s.order_id,
                article=s.article,
                product_name=s.product_name,
                selected=True,
            )
            for s in sales
        ],
        total=len(sales),
        period=f"{data.date_from} — {data.date_to}",
    )


class CreateWithdrawalFromMarketplace(BaseModel):
    marketplace: str
    marking_codes: list[str]
    prices: list[float]
    product_group: str = "perfumery"
    date_from: str
    date_to: str


@router.post("/create-withdrawal")
async def create_withdrawal_from_marketplace(
    data: CreateWithdrawalFromMarketplace,
    current_user: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Создать черновик вывода из оборота по данным маркетплейса."""
    if not data.marking_codes:
        raise HTTPException(400, "Нет кодов для вывода")

    avg_price = sum(data.prices) / len(data.prices) if data.prices else 0

    report = WithdrawalReport(
        withdrawal_type="DISTANCE_SOLD",
        product_group=data.product_group,
        marking_codes=data.marking_codes,
        status=WithdrawalStatus.DRAFT,
        price=avg_price,
        primary_document_name="Акт приёма-передачи",
        primary_document_number=f"{data.marketplace.upper()}-{data.date_from}",
        primary_document_date=data.date_to,
        marketplace_source=data.marketplace,
        org_id=org.id if org else None,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    return {
        "withdrawal_id": str(report.id),
        "codes_count": len(data.marking_codes),
        "marketplace": data.marketplace,
        "status": "draft",
        "message": (
            f"Создан черновик вывода {len(data.marking_codes)} кодов. "
            "Перейдите в раздел «Вывод из оборота» для подписи."
        ),
    }


@router.get("/status")
async def get_marketplace_status(
    current_user: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
) -> dict:
    """Статус подключения маркетплейсов."""
    return {
        "wb": {
            "connected": bool(org and org.wb_api_key),
            "label": "Wildberries",
            "description": "Statistics API для отчётов о маркированных товарах",
        },
        "ozon": {
            "connected": bool(org and org.ozon_client_id and org.ozon_api_key),
            "label": "Ozon",
            "description": "Seller API для FBS отправлений",
        },
    }
