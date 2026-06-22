from __future__ import annotations
from functools import lru_cache
from pathlib import Path
from uuid import UUID
from lxml import etree
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import DocumentUPD
def _text(value: object | None) -> str:
    if value is None:
        return ""
    return str(value)
@lru_cache
def _get_upd_xsd_schema() -> etree.XMLSchema:
    xsd_path = Path(__file__).resolve().parents[1] / "xsd" / "upd_820.xsd"
    with xsd_path.open("rb") as schema_file:
        parsed_schema = etree.parse(schema_file)
    return etree.XMLSchema(parsed_schema)
def validate_upd_xml(xml_bytes: bytes) -> None:
    xml_document = etree.fromstring(xml_bytes)
    schema = _get_upd_xsd_schema()
    if not schema.validate(xml_document):
        errors = "; ".join(error.message for error in schema.error_log)
        raise ValueError(f"UPD XML does not match XSD schema: {errors}")
async def generate_upd_xml(document_id: UUID, db: AsyncSession) -> bytes:
    result = await db.execute(select(DocumentUPD).where(DocumentUPD.id == document_id))
    document = result.scalar_one_or_none()
    if document is None:
        raise LookupError("UPD document not found")
    root = etree.Element(
        "Файл",
        ИдФайл=f"ON_UPD_{document.id}",
        ВерсФорм="5.03",
        ВерсПрог="g-code-clone",
    )
    doc_node = etree.SubElement(
        root,
        "Документ",
        КНД="1115131",
        Функция="СЧФДОП",
        НомерДок=_text(document.document_number),
        ДатаДок=document.created_at.date().isoformat(),
    )
    sf_node = etree.SubElement(
        doc_node,
        "СвСчФакт",
        НомерСчФ=_text(document.document_number),
        ДатаСчФ=document.created_at.date().isoformat(),
    )
    if any([document.seller_inn, document.seller_name]):
        seller_node = etree.SubElement(sf_node, "СвПрод")
        seller_id = etree.SubElement(seller_node, "ИдСв")
        if document.seller_inn:
            org_attrs: dict[str, str] = {"ИННЮЛ": _text(document.seller_inn)}
            if document.seller_kpp:
                org_attrs["КПП"] = _text(document.seller_kpp)
            if document.seller_name:
                org_attrs["НаимОрг"] = _text(document.seller_name)
            etree.SubElement(seller_id, "СвЮЛУч", attrib=org_attrs)
        if document.seller_address:
            addr = etree.SubElement(seller_node, "Адрес")
            etree.SubElement(
                addr,
                "АдрТекст",
                attrib={"АдрТекст": _text(document.seller_address)},
            )
    if any([document.buyer_inn, document.buyer_name]):
        buyer_node = etree.SubElement(sf_node, "СвПокуп")
        buyer_id = etree.SubElement(buyer_node, "ИдСв")
        if document.buyer_inn:
            org_attrs = {"ИННЮЛ": _text(document.buyer_inn)}
            if document.buyer_kpp:
                org_attrs["КПП"] = _text(document.buyer_kpp)
            if document.buyer_name:
                org_attrs["НаимОрг"] = _text(document.buyer_name)
            etree.SubElement(buyer_id, "СвЮЛУч", attrib=org_attrs)
        if document.buyer_address:
            addr = etree.SubElement(buyer_node, "Адрес")
            etree.SubElement(
                addr,
                "АдрТекст",
                attrib={"АдрТекст": _text(document.buyer_address)},
            )
    table_node = etree.SubElement(doc_node, "ТаблСчФакт")
    for idx, code in enumerate(document.marking_codes, start=1):
        etree.SubElement(
            table_node,
            "СведТов",
            НомСтр=str(idx),
            НаимТов="Маркированный товар",
            КодМаркировки=_text(code),
        )
    xml_bytes = etree.tostring(
        root,
        xml_declaration=True,
        encoding="UTF-8",
        pretty_print=True,
    )
    validate_upd_xml(xml_bytes)
    return xml_bytes
