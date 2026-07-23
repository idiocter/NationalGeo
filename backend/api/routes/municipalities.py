from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_session

router = APIRouter(prefix="/municipalities", tags=["municipalities"])


@router.get("")
async def list_municipalities(db: AsyncSession = Depends(get_session)) -> list[dict]:
    """Return all 753 Nepal local units with id, name, province, type, and bbox."""
    result = await db.execute(
        text(
            """
            SELECT id, name, name_np, province, district, type,
                   total_area_km2, population,
                   ST_AsGeoJSON(ST_Envelope(geom))::json AS bbox
            FROM municipalities
            ORDER BY province, name
            """
        )
    )
    rows = result.mappings().all()
    return [dict(r) for r in rows]


@router.get("/{municipality_id}")
async def get_municipality(
    municipality_id: str, db: AsyncSession = Depends(get_session)
) -> dict:
    """Return metadata and GeoJSON boundary for a single municipality."""
    result = await db.execute(
        text(
            """
            SELECT id, name, name_np, province, district, type,
                   total_area_km2, population,
                   ST_AsGeoJSON(geom)::json AS geometry
            FROM municipalities
            WHERE id = :id
            """
        ),
        {"id": municipality_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Municipality '{municipality_id}' not found")
    return dict(row)
