"""Сервис интеграции с маркетплейсами WB и Ozon."""
from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class MarketplaceSale:
    """Одна продажа с кодом маркировки."""

    marking_code: str
    price: float
    sale_date: str
    order_id: str
    article: str = ""
    product_name: str = ""
    barcode: str = ""


async def get_wb_sales(
    api_key: str,
    date_from: str,
    date_to: str,
) -> list[MarketplaceSale]:
    """
    Получить продажи с кодами маркировки из WB.

    Реальный API: GET https://statistics-api.wildberries.ru/api/v1/analytics/excise-report
    Параметры: dateFrom, dateTo
    Заголовок: Authorization: {api_key}
    Поле с КМ: excise_short (укороченный код без кода проверки)
    Поле с ценой: price
    Поле с датой: fiscal_dt

    СЕЙЧАС: возвращаем моковые данные для демонстрации.
    """
    logger.info("WB sales request: date_from=%s, date_to=%s", date_from, date_to)

    # TODO: раскомментировать когда будет реальный API ключ:
    # import httpx
    # async with httpx.AsyncClient() as client:
    #     resp = await client.get(
    #         "https://statistics-api.wildberries.ru/api/v1/analytics/excise-report",
    #         headers={"Authorization": api_key},
    #         params={"dateFrom": date_from, "dateTo": date_to},
    #         timeout=30,
    #     )
    #     resp.raise_for_status()
    #     data = resp.json()
    #     sales = []
    #     for item in data.get("response", {}).get("data", []):
    #         code = item.get("excise_short", "")
    #         if not code:
    #             continue
    #         sales.append(MarketplaceSale(
    #             marking_code=code,
    #             price=float(item.get("price", 0)),
    #             sale_date=item.get("fiscal_dt", date_from),
    #             order_id=str(item.get("rid", "")),
    #             article=item.get("supplierArticle", ""),
    #             barcode=item.get("barcode", ""),
    #         ))
    #     return sales

    # ЗАГЛУШКА — моковые данные
    return [
        MarketplaceSale(
            marking_code=f"010290000406494821DEMO_WB_{i:04d}",
            price=1500.0 + i * 100,
            sale_date=date_from,
            order_id=f"WB-ORDER-{i:06d}",
            article=f"ART-{i:04d}",
            product_name=f"Товар WB #{i}",
            barcode=f"29000040649{i:03d}",
        )
        for i in range(1, 4)
    ]


async def get_ozon_sales(
    client_id: str,
    api_key: str,
    date_from: str,
    date_to: str,
) -> list[MarketplaceSale]:
    """
    Получить продажи с кодами маркировки из Ozon.

    Реальный API: POST https://api-seller.ozon.ru/v2/posting/fbs/list
    + POST https://api-seller.ozon.ru/v4/posting/fbs/get (для кодов маркировки)
    Заголовки: Client-Id, Api-Key
    Коды маркировки: в поле exemplar_info[].mandatory_mark

    СЕЙЧАС: возвращаем моковые данные.
    """
    logger.info("Ozon sales request: date_from=%s, date_to=%s", date_from, date_to)

    # TODO: раскомментировать когда будет реальный API:
    # import httpx
    # async with httpx.AsyncClient() as client:
    #     resp = await client.post(
    #         "https://api-seller.ozon.ru/v2/posting/fbs/list",
    #         headers={"Client-Id": client_id, "Api-Key": api_key},
    #         json={
    #             "dir": "asc",
    #             "filter": {
    #                 "since": f"{date_from}T00:00:00Z",
    #                 "to": f"{date_to}T23:59:59Z",
    #                 "status": "delivered",
    #             },
    #             "limit": 1000,
    #             "offset": 0,
    #             "with": {"mandatory_mark": True},
    #         },
    #         timeout=30,
    #     )
    #     resp.raise_for_status()
    #     data = resp.json()
    #     sales = []
    #     for posting in data.get("result", {}).get("postings", []):
    #         for product in posting.get("products", []):
    #             for exemplar in product.get("exemplar_info", []):
    #                 code = exemplar.get("mandatory_mark", "")
    #                 if code:
    #                     sales.append(MarketplaceSale(
    #                         marking_code=code,
    #                         price=float(product.get("price", 0)),
    #                         sale_date=posting.get("shipment_date", date_from)[:10],
    #                         order_id=posting.get("posting_number", ""),
    #                         article=product.get("offer_id", ""),
    #                         product_name=product.get("name", ""),
    #                     ))
    #     return sales

    # ЗАГЛУШКА — моковые данные
    return [
        MarketplaceSale(
            marking_code=f"010290000406494821DEMO_OZ_{i:04d}",
            price=2000.0 + i * 150,
            sale_date=date_from,
            order_id=f"OZON-{i:010d}",
            article=f"OZ-ART-{i:04d}",
            product_name=f"Товар Ozon #{i}",
        )
        for i in range(1, 4)
    ]
