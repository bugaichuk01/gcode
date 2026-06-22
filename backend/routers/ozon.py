from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session
from schemas import OzonParseXmlResponse, OzonParsedProduct
from services import xml_parser_service
router = APIRouter(tags=["ozon"])
@router.post("/ozon/parse-xml", response_model=OzonParseXmlResponse)
async def parse_ozon_xml(
    file: UploadFile = File(..., description="XML-файл с товарами Ozon"),
    session: AsyncSession = Depends(get_db_session),
) -> OzonParseXmlResponse:
    name = (file.filename or "").lower()
    if not name.endswith(".xml"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Ожидается файл с расширением .xml",
        )
    body = await file.read()
    try:
        rows = await xml_parser_service.parse_ozon_xml_file(session, body)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    products = [OzonParsedProduct.model_validate(r) for r in rows]
    return OzonParseXmlResponse(products=products)
