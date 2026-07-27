from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_session

router = APIRouter(tags=["municipalities"])


# ── Municipality endpoints ────────────────────────────────────────────────────

@router.get("/municipalities")
async def list_municipalities(db: AsyncSession = Depends(get_session)) -> list[dict]:
    result = await db.execute(
        text(
            """
            SELECT id, name, name_np, province, district, type,
                   total_area_km2, population,
                   ST_AsGeoJSON(
                       ST_Multi(ST_SimplifyPreserveTopology(geom, 0.001))
                   )::json AS geometry
            FROM municipalities
            ORDER BY province, name
            """
        )
    )
    return [dict(r) for r in result.mappings().all()]


@router.get("/municipalities/{municipality_id}")
async def get_municipality(
    municipality_id: str, db: AsyncSession = Depends(get_session)
) -> dict:
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


# ── Province endpoints ────────────────────────────────────────────────────────

@router.get("/provinces")
async def list_provinces(db: AsyncSession = Depends(get_session)) -> list[dict]:
    result = await db.execute(
        text(
            """
            SELECT province,
                   COUNT(*)              AS municipality_count,
                   COUNT(DISTINCT district) AS district_count,
                   ROUND(SUM(total_area_km2)::numeric, 2) AS total_area_km2,
                   SUM(population)       AS population
            FROM municipalities
            GROUP BY province
            ORDER BY province
            """
        )
    )
    return [dict(r) for r in result.mappings().all()]


@router.get("/provinces/{province_name}")
async def get_province(
    province_name: str, db: AsyncSession = Depends(get_session)
) -> dict:
    result = await db.execute(
        text(
            """
            SELECT province,
                   COUNT(*)              AS municipality_count,
                   COUNT(DISTINCT district) AS district_count,
                   ROUND(SUM(total_area_km2)::numeric, 2) AS total_area_km2,
                   SUM(population)       AS population,
                   ST_AsGeoJSON(ST_Union(geom))::json AS geometry
            FROM municipalities
            WHERE province = :p
            GROUP BY province
            """
        ),
        {"p": province_name},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Province '{province_name}' not found")
    return dict(row)


@router.get("/provinces/{province_name}/districts")
async def list_province_districts(
    province_name: str, db: AsyncSession = Depends(get_session)
) -> list[dict]:
    result = await db.execute(
        text(
            """
            SELECT district, province,
                   COUNT(*) AS municipality_count,
                   ROUND(SUM(total_area_km2)::numeric, 2) AS total_area_km2,
                   SUM(population) AS population
            FROM municipalities
            WHERE province = :p
            GROUP BY district, province
            ORDER BY district
            """
        ),
        {"p": province_name},
    )
    return [dict(r) for r in result.mappings().all()]


@router.get("/provinces/{province_name}/municipalities")
async def list_province_municipalities(
    province_name: str, db: AsyncSession = Depends(get_session)
) -> list[dict]:
    result = await db.execute(
        text(
            """
            SELECT id, name, name_np, district, type, total_area_km2, population
            FROM municipalities
            WHERE province = :p
            ORDER BY district, name
            """
        ),
        {"p": province_name},
    )
    return [dict(r) for r in result.mappings().all()]


# ── District endpoints ────────────────────────────────────────────────────────

@router.get("/districts")
async def list_districts(db: AsyncSession = Depends(get_session)) -> list[dict]:
    result = await db.execute(
        text(
            """
            SELECT district, province,
                   COUNT(*) AS municipality_count,
                   ROUND(SUM(total_area_km2)::numeric, 2) AS total_area_km2,
                   SUM(population) AS population
            FROM municipalities
            GROUP BY district, province
            ORDER BY province, district
            """
        )
    )
    return [dict(r) for r in result.mappings().all()]


@router.get("/districts/{district_name}")
async def get_district(
    district_name: str, db: AsyncSession = Depends(get_session)
) -> dict:
    result = await db.execute(
        text(
            """
            SELECT district, province,
                   COUNT(*) AS municipality_count,
                   ROUND(SUM(total_area_km2)::numeric, 2) AS total_area_km2,
                   SUM(population) AS population,
                   ST_AsGeoJSON(ST_Union(geom))::json AS geometry
            FROM municipalities
            WHERE district = :d
            GROUP BY district, province
            """
        ),
        {"d": district_name},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"District '{district_name}' not found")
    return dict(row)


@router.get("/districts/{district_name}/municipalities")
async def list_district_municipalities(
    district_name: str, db: AsyncSession = Depends(get_session)
) -> list[dict]:
    result = await db.execute(
        text(
            """
            SELECT id, name, name_np, province, type, total_area_km2, population
            FROM municipalities
            WHERE district = :d
            ORDER BY name
            """
        ),
        {"d": district_name},
    )
    return [dict(r) for r in result.mappings().all()]


# ── Country endpoint ──────────────────────────────────────────────────────────

@router.get("/country")
async def get_country(db: AsyncSession = Depends(get_session)) -> dict:
    result = await db.execute(
        text(
            """
            SELECT COUNT(*)                  AS municipality_count,
                   COUNT(DISTINCT district)  AS district_count,
                   COUNT(DISTINCT province)  AS province_count,
                   ROUND(SUM(total_area_km2)::numeric, 2) AS total_area_km2,
                   SUM(population)           AS population
            FROM municipalities
            """
        )
    )
    row = result.mappings().first()
    return {"name": "Nepal", **dict(row)}
