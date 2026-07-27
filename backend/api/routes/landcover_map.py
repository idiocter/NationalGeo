"""Land-cover map tile endpoints.

Renders clipped, colour-mapped RGBA PNGs from the ICIMOD COG stack.
Supports municipality, district, province, and country level.
Also provides a change-detection overlay PNG.

MapLibre GL JS v3 sends a HEAD preflight before updateImage(); all GET routes
are registered with both GET and HEAD methods.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
from functools import partial
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_session
from backend.config import get_settings
from backend.contracts.geo_utils import reproject_geometry

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(tags=["landcover"])

_ALPHA = 255

_PALETTE: dict[int, tuple[int, int, int, int]] = {
    0:  (  0,   0,   0,   0),
    1:  ( 74, 144, 217, _ALPHA),
    2:  (176, 214, 235, _ALPHA),
    3:  (196, 178, 138, _ALPHA),
    4:  ( 26, 122,  74, _ALPHA),
    5:  (144, 212,  75, _ALPHA),
    6:  (168, 201, 127, _ALPHA),
    7:  (245, 212,  78, _ALPHA),
    8:  (214,  59,  47, _ALPHA),
    9:  ( 93, 160, 111, _ALPHA),
    10: (139, 115,  85, _ALPHA),
    11: (176, 176, 176, _ALPHA),
}
_UNKNOWN_RGBA = (128, 0, 128, 220)

# Change-overlay colours: unchanged=transparent, changed=coloured by destination class
_CHANGE_UNCHANGED = (0, 0, 0, 0)

# Forest/non-forest binary classification
# Forest Area = Forest + Grassland + Shrubland + Cultivated Land + Open Woodland
_FOREST_CODES: frozenset[int] = frozenset({4, 5, 6, 9})  # Forest, Grassland, Shrubland, Open Woodland
_FOREST_RGBA     = ( 45, 106,  79, 255)  # deep green
_NON_FOREST_RGBA = (158, 158, 158, 255)  # neutral grey


def _apply_forest_palette(band: np.ndarray) -> np.ndarray:
    """Return RGBA array with binary forest / non-forest classification."""
    h, w = band.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    valid = band > 0  # exclude NoData (code 0)
    rgba[valid & np.isin(band, list(_FOREST_CODES))] = _FOREST_RGBA
    rgba[valid & ~np.isin(band, list(_FOREST_CODES))] = _NON_FOREST_RGBA
    return rgba


# ── Core rendering (geometry-first) ──────────────────────────────────────────

def _render_png_from_geojson(
    geom_json: str,
    year: int,
    dataset_version: str,
    mode: str = "standard",
) -> tuple[bytes, list[float]]:
    """Render land-cover PNG given a GeoJSON geometry string (EPSG:4326).

    mode="standard" — full 11-class colour map
    mode="forest"   — binary forest-area / non-forest classification
    """
    import rasterio
    from rasterio.mask import mask as rasterio_mask
    from shapely.geometry import shape
    from PIL import Image

    geom_4326 = shape(json.loads(geom_json))
    bounds = geom_4326.bounds  # (west, south, east, north)

    cog = Path(settings.object_store_path) / "landcover" / dataset_version / f"{year}.tif"
    if not cog.exists():
        raise FileNotFoundError(f"COG not found: {cog}")

    with rasterio.open(cog) as src:
        raster_epsg = src.crs.to_epsg()
        geom_raster = reproject_geometry(geom_4326, from_epsg=4326, to_epsg=raster_epsg)
        nodata_fill = int(src.nodata) if src.nodata is not None else 0
        masked, _ = rasterio_mask(
            src,
            [geom_raster.__geo_interface__],
            crop=True,
            all_touched=False,
            nodata=nodata_fill,
            filled=True,
        )

    band = masked[0]

    if mode == "forest":
        rgba = _apply_forest_palette(band)
    else:
        h, w = band.shape
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        for code, colour in _PALETTE.items():
            rgba[band == code] = colour
        unknown = np.ones((h, w), dtype=bool)
        for code in _PALETTE:
            unknown &= band != code
        rgba[unknown] = _UNKNOWN_RGBA

    img = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return buf.getvalue(), list(bounds)


def _render_png(municipality_id: str, year: int, dataset_version: str, mode: str = "standard") -> tuple[bytes, list[float]]:
    """Fetch municipality geometry from DB then render."""
    from sqlalchemy import create_engine, text as stext

    raw_url = settings.database_url
    suffix = raw_url.split("://", 1)[1]
    sync_url = f"postgresql+psycopg2://{suffix}"
    engine = create_engine(sync_url, pool_size=1, max_overflow=0)
    with engine.connect() as conn:
        row = conn.execute(
            stext("SELECT ST_AsGeoJSON(geom) AS g FROM municipalities WHERE id = :id"),
            {"id": municipality_id},
        ).first()
    engine.dispose()
    if row is None:
        raise ValueError(f"Municipality '{municipality_id}' not found")
    return _render_png_from_geojson(row.g, year, dataset_version, mode=mode)


def _fetch_union_geojson(sql: str, params: dict) -> str:
    """Run a ST_Union query synchronously and return the GeoJSON string."""
    from sqlalchemy import create_engine, text as stext

    raw_url = settings.database_url
    suffix = raw_url.split("://", 1)[1]
    sync_url = f"postgresql+psycopg2://{suffix}"
    engine = create_engine(sync_url, pool_size=1, max_overflow=0)
    with engine.connect() as conn:
        row = conn.execute(stext(sql), params).first()
    engine.dispose()
    if row is None or row.g is None:
        raise ValueError("No geometry found")
    return row.g


def _render_change_png(
    geom_json: str,
    from_year: int,
    to_year: int,
    dataset_version: str,
) -> tuple[bytes, list[float]]:
    """Render change-detection overlay: unchanged = transparent; changed = destination class colour."""
    import rasterio
    from rasterio.mask import mask as rasterio_mask
    from shapely.geometry import shape
    from PIL import Image

    geom_4326 = shape(json.loads(geom_json))
    bounds = geom_4326.bounds

    def _mask(year: int):
        cog = Path(settings.object_store_path) / "landcover" / dataset_version / f"{year}.tif"
        if not cog.exists():
            raise FileNotFoundError(f"COG not found: {cog}")
        with rasterio.open(cog) as src:
            raster_epsg = src.crs.to_epsg()
            geom_r = reproject_geometry(geom_4326, from_epsg=4326, to_epsg=raster_epsg)
            nodata_fill = int(src.nodata) if src.nodata is not None else 0
            masked, _ = rasterio_mask(
                src, [geom_r.__geo_interface__],
                crop=True, all_touched=False, nodata=nodata_fill, filled=True,
            )
        return masked[0], nodata_fill

    band_from, nodata_f = _mask(from_year)
    band_to,   nodata_t = _mask(to_year)

    if band_from.shape != band_to.shape:
        # resize to_year to match from_year
        from PIL import Image as _PIL
        img_to = _PIL.fromarray(band_to.astype(np.uint8))
        img_to = img_to.resize((band_from.shape[1], band_from.shape[0]), _PIL.NEAREST)
        band_to = np.array(img_to)

    h, w = band_from.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    valid = (band_from != nodata_f) & (band_to != nodata_t)
    changed = valid & (band_from != band_to)

    # Colour changed pixels by their destination class (with 80% opacity to overlay on basemap)
    for code, (r, g, b, _) in _PALETTE.items():
        if code == 0:
            continue
        mask = changed & (band_to == code)
        rgba[mask] = (r, g, b, 200)

    img = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return buf.getvalue(), list(bounds)


# ── Shared response builder ───────────────────────────────────────────────────

def _png_response(png_bytes: bytes, bounds: list[float], *, is_head: bool) -> Response:
    west, south, east, north = bounds
    headers = {
        "Cache-Control": "public, max-age=3600",
        "X-Bbox-West": str(west),
        "X-Bbox-South": str(south),
        "X-Bbox-East": str(east),
        "X-Bbox-North": str(north),
    }
    return Response(
        content=b"" if is_head else png_bytes,
        media_type="image/png",
        headers=headers,
    )


def _head_response(cog_path: Path) -> Response:
    if not cog_path.exists():
        raise HTTPException(status_code=404, detail=f"COG not found: {cog_path.name}")
    return Response(
        content=b"",
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600",
                 "X-Bbox-West": "0", "X-Bbox-South": "0",
                 "X-Bbox-East": "0", "X-Bbox-North": "0"},
    )


def _cog_path(dataset_version: str, year: int) -> Path:
    return Path(settings.object_store_path) / "landcover" / dataset_version / f"{year}.tif"


_VALID_YEARS = {2000, 2005, 2010, 2015, 2020}


async def _validate_year(year: int) -> None:
    if year not in _VALID_YEARS:
        raise HTTPException(
            status_code=404,
            detail=f"Year {year} not in dataset (valid: {sorted(_VALID_YEARS)})",
        )


# ── Municipality land-cover PNG ───────────────────────────────────────────────

@router.api_route(
    "/municipalities/{municipality_id}/landcover/{year}.png",
    methods=["GET", "HEAD"],
)
async def municipality_landcover_png(
    request: Request,
    municipality_id: str,
    year: int,
    dataset_version: str = Query(default="landcover-v3.1"),
    mode: str = Query(default="standard", pattern="^(standard|forest)$"),
    db: AsyncSession = Depends(get_session),
) -> Response:
    result = await db.execute(
        text("SELECT id FROM municipalities WHERE id = :id"),
        {"id": municipality_id},
    )
    if result.first() is None:
        raise HTTPException(status_code=404, detail=f"Municipality '{municipality_id}' not found")

    await _validate_year(year)

    if request.method == "HEAD":
        return _head_response(_cog_path(dataset_version, year))

    try:
        loop = asyncio.get_event_loop()
        png_bytes, bounds = await loop.run_in_executor(
            None, partial(_render_png, municipality_id, year, dataset_version, mode)
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return _png_response(png_bytes, bounds, is_head=False)


# ── Municipality change-detection overlay PNG ─────────────────────────────────

@router.api_route(
    "/municipalities/{municipality_id}/landcover/change/{from_year}-{to_year}.png",
    methods=["GET", "HEAD"],
)
async def municipality_change_png(
    request: Request,
    municipality_id: str,
    from_year: int,
    to_year: int,
    dataset_version: str = Query(default="landcover-v3.1"),
    db: AsyncSession = Depends(get_session),
) -> Response:
    result = await db.execute(
        text("SELECT ST_AsGeoJSON(geom) AS g FROM municipalities WHERE id = :id"),
        {"id": municipality_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Municipality '{municipality_id}' not found")

    await _validate_year(from_year)
    await _validate_year(to_year)

    if request.method == "HEAD":
        return _head_response(_cog_path(dataset_version, from_year))

    geom_json = json.dumps(row["g"])

    try:
        loop = asyncio.get_event_loop()
        png_bytes, bounds = await loop.run_in_executor(
            None, partial(_render_change_png, geom_json, from_year, to_year, dataset_version)
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return _png_response(png_bytes, bounds, is_head=False)


# ── Province land-cover PNG ───────────────────────────────────────────────────

@router.api_route(
    "/provinces/{province_name}/landcover/{year}.png",
    methods=["GET", "HEAD"],
)
async def province_landcover_png(
    request: Request,
    province_name: str,
    year: int,
    dataset_version: str = Query(default="landcover-v3.1"),
    mode: str = Query(default="standard", pattern="^(standard|forest)$"),
    db: AsyncSession = Depends(get_session),
) -> Response:
    row = (await db.execute(
        text("SELECT ST_AsGeoJSON(ST_Union(geom)) AS g FROM municipalities WHERE province = :p"),
        {"p": province_name},
    )).mappings().first()
    if row is None or row["g"] is None:
        raise HTTPException(status_code=404, detail=f"Province '{province_name}' not found")

    await _validate_year(year)

    if request.method == "HEAD":
        return _head_response(_cog_path(dataset_version, year))

    geom_json = json.dumps(row["g"])
    try:
        loop = asyncio.get_event_loop()
        png_bytes, bounds = await loop.run_in_executor(
            None, partial(_render_png_from_geojson, geom_json, year, dataset_version, mode)
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return _png_response(png_bytes, bounds, is_head=False)


# ── District land-cover PNG ───────────────────────────────────────────────────

@router.api_route(
    "/districts/{district_name}/landcover/{year}.png",
    methods=["GET", "HEAD"],
)
async def district_landcover_png(
    request: Request,
    district_name: str,
    year: int,
    dataset_version: str = Query(default="landcover-v3.1"),
    mode: str = Query(default="standard", pattern="^(standard|forest)$"),
    db: AsyncSession = Depends(get_session),
) -> Response:
    row = (await db.execute(
        text("SELECT ST_AsGeoJSON(ST_Union(geom)) AS g FROM municipalities WHERE district = :d"),
        {"d": district_name},
    )).mappings().first()
    if row is None or row["g"] is None:
        raise HTTPException(status_code=404, detail=f"District '{district_name}' not found")

    await _validate_year(year)

    if request.method == "HEAD":
        return _head_response(_cog_path(dataset_version, year))

    geom_json = json.dumps(row["g"])
    try:
        loop = asyncio.get_event_loop()
        png_bytes, bounds = await loop.run_in_executor(
            None, partial(_render_png_from_geojson, geom_json, year, dataset_version, mode)
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return _png_response(png_bytes, bounds, is_head=False)


# ── Country land-cover PNG ────────────────────────────────────────────────────

@router.api_route(
    "/country/landcover/{year}.png",
    methods=["GET", "HEAD"],
)
async def country_landcover_png(
    request: Request,
    year: int,
    dataset_version: str = Query(default="landcover-v3.1"),
    mode: str = Query(default="standard", pattern="^(standard|forest)$"),
    db: AsyncSession = Depends(get_session),
) -> Response:
    row = (await db.execute(
        text("SELECT ST_AsGeoJSON(ST_Union(geom)) AS g FROM municipalities"),
    )).mappings().first()
    if row is None or row["g"] is None:
        raise HTTPException(status_code=404, detail="No municipality data found")

    await _validate_year(year)

    if request.method == "HEAD":
        return _head_response(_cog_path(dataset_version, year))

    geom_json = json.dumps(row["g"])
    try:
        loop = asyncio.get_event_loop()
        png_bytes, bounds = await loop.run_in_executor(
            None, partial(_render_png_from_geojson, geom_json, year, dataset_version, mode)
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return _png_response(png_bytes, bounds, is_head=False)
