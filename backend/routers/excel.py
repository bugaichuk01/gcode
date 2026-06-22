import io
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session
from schemas import ExcelImportResult, ExcelTemplateRequest, MarkingCodesImportResult
from services import excel_service
router = APIRouter(tags=["excel"])
@router.post("/excel/generate-template")
async def generate_excel_template(
    payload: ExcelTemplateRequest,
) -> StreamingResponse:
    data = excel_service.generate_template_bytes(payload.items)
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="ozon_mapping_template.xlsx"',
        },
    )
@router.post("/excel/import-ozon-id", response_model=ExcelImportResult)
async def import_ozon_ids(
    file: UploadFile = File(..., description="Заполненный .xlsx или .csv"),
    session: AsyncSession = Depends(get_db_session),
) -> ExcelImportResult:
    fname = file.filename or ""
    lower = fname.lower()
    if not (lower.endswith(".xlsx") or lower.endswith(".csv")):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Допустимы только файлы .xlsx или .csv",
        )
    body = await file.read()
    try:
        created, updated, skipped = await excel_service.import_ozon_ids_from_file(
            session,
            fname,
            body,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ExcelImportResult(created=created, updated=updated, skipped=skipped)
@router.post("/excel/import-marking-codes", response_model=MarkingCodesImportResult)
async def import_marking_codes(
    file: UploadFile = File(..., description="CSV или Excel с кодами маркировки"),
    session: AsyncSession = Depends(get_db_session),
) -> MarkingCodesImportResult:
    fname = file.filename or ""
    lower = fname.lower()
    if not (lower.endswith(".xlsx") or lower.endswith(".csv")):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Допустимы только файлы .xlsx или .csv",
        )
    body = await file.read()
    try:
        added, skipped, errors = await excel_service.import_marking_codes_from_file(
            session,
            fname,
            body,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MarkingCodesImportResult(
        added=added,
        skipped=skipped,
        errors=errors[:10],
    )
