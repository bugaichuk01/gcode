from __future__ import annotations
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import Device
from schemas import DeviceCreate
async def list_devices(
    session: AsyncSession,
    org_id: uuid.UUID | None = None,
) -> list[Device]:
    q = select(Device)
    if org_id:
        q = q.where(Device.org_id == org_id)
    result = await session.scalars(q.order_by(Device.created_at.desc()))
    return list(result.all())
async def create_device(
    session: AsyncSession,
    data: DeviceCreate,
    org_id: uuid.UUID | None = None,
) -> Device:
    inn = (data.inn or "").strip() or None
    device = Device(
        name=data.name.strip(),
        oms_id=data.oms_id.strip(),
        connection_id=data.connection_id.strip(),
        inn=inn,
        org_id=org_id,
    )
    session.add(device)
    await session.commit()
    await session.refresh(device)
    return device
async def delete_device(session: AsyncSession, device_id: uuid.UUID) -> bool:
    device = await session.get(Device, device_id)
    if device is None:
        return False
    await session.delete(device)
    await session.commit()
    return True
