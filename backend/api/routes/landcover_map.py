"""Land-cover map tile endpoint.

Returns a clipped, colour-mapped RGBA PNG of the ICIMOD land-cover raster
for a specific municipality and year.  The PNG is positioned in geographic
space using the bbox headers the frontend reads to place a MapLibre image
layer.
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

router = APIRouter(prefix="/municipalities", tags=["landcover"])

# ICIMOD 11-class RGBA palette — verified against national VAT pixel counts.
# Codes 2/7 and 3/6 were previously swapped; corrected here.
# Nodata (code 0) is fully transparent so the base map shows through.
_ALPHA = 255  # fully opaque — no basemap behind the overlay

_PALETTE: dict[int, tuple[int, int, int, int]] = {
    0:  (  0,   0,   0,   0),  # NoData        — fully transparent
    1:  ( 74, 144, 217, _ALPHA),  # Water Body    — blue
    2:  (176, 214, 235, _ALPHA),  # Snow/Glacier  — mid blue (more visible than near-white)
    3:  (196, 178, 138, _ALPHA),  # Barren Land   — tan
    4:  ( 26, 122,  74, _ALPHA),  # Forest        — dark green
    5:  (144, 212,  75, _ALPHA),  # Grassland     — light green
    6:  (168, 201, 127, _ALPHA),  # Shrubland     — olive green
    7:  (245, 212,  78, _ALPHA),  # Cultivated    — yellow
    8:  (214,  59,  47, _ALPHA),  # Settlement    — red
    9:  ( 93, 160, 111, _ALPHA),  # Open Woodland — medium green
    10: (139, 115,  85, _ALPHA),  # Rocky/Bare    — brown
    11: (176, 176, 176, _ALPHA),  # Others        — grey
}

# Fallback colour for any unexpected class code
_UNKNOWN_RGBA = (128, 0, 128, 220)


def _render_png(municipality_id: str, year: int, dataset_version: str) -> tuple[bytes, list[float]]:
    """Synchronous: clip COG → colour map → PNG bytes + [west, south, east, north]."""
    import rasterio
    from rasterio.mask import mask as rasterio_mask
    from shapely.geometry import shape
    from PIL import Image
    from sqlalchemy import create_engine, text as stext

    # Build a short-lived sync engine for this thread
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

    geom_4326 = shape(json.loads(row.g))
    bounds = geom_4326.bounds  # (minx/west, miny/south, maxx/east, maxy/north)

    cog = Path(settings.object_store_path) / "landcover" / dataset_version / f"{year}.tif"
    if not cog.exists():
        raise FileNotFoundError(f"COG not found: {cog}")

    with rasterio.open(cog) as src:
        raster_epsg = src.crs.to_epsg()
        geom_raster = reproject_geometry(geom_4326, from_epsg=4326, to_epsg=raster_epsg)
        nodata_fill = int(src.nodata) if src.nodata is not None else 0

        masked, transform = rasterio_mask(
            src,
            [geom_raster.__geo_interface__],
            crop=True,
            all_touched=False,
            nodata=nodata_fill,
            filled=True,
        )

    band = masked[0]  # (H, W) uint8 land-cover codes

    # Map class codes → RGBA
    h, w = band.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for code, colour in _PALETTE.items():
        mask = band == code
        rgba[mask] = colour
    # Pixels with codes outside the palette (shouldn't happen but defensive)
    unknown_mask = np.ones((h, w), dtype=bool)
    for code in _PALETTE:
        unknown_mask &= band != code
    rgba[unknown_mask] = _UNKNOWN_RGBA

    img = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return buf.getvalue(), list(bounds)


@router.api_route("/{municipality_id}/landcover/{year}.png", methods=["GET", "HEAD"])
async def landcover_png(
    request: Request,
    municipality_id: str,
    year: int,
    dataset_version: str = Query(default="landcover-v3.1"),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Return a clipped, colour-mapped RGBA PNG for the given municipality and year.

    Supports both GET (full render) and HEAD (headers only, no render).
    MapLibre GL JS v3 sends a HEAD preflight before updateImage(); responding
    correctly to HEAD is required for year-switch to work.

    Response headers expose the geographic bounding box so the frontend can
    place the image precisely as a MapLibre image-source overlay:
        X-Bbox-West, X-Bbox-South, X-Bbox-East, X-Bbox-North
    """
    # Validate municipality exists
    result = await db.execute(
        text("SELECT id FROM municipalities WHERE id = :id"),
        {"id": municipality_id},
    )
    if result.first() is None:
        raise HTTPException(status_code=404, detail=f"Municipality '{municipality_id}' not found")

    valid_years = {2000, 2005, 2010, 2015, 2020}
    if year not in valid_years:
        raise HTTPException(status_code=404, detail=f"Year {year} not in dataset (valid: {sorted(valid_years)})")

    # HEAD: validate existence cheaply without rendering the PNG
    if request.method == "HEAD":
        cog = Path(settings.object_store_path) / "landcover" / dataset_version / f"{year}.tif"
        if not cog.exists():
            raise HTTPException(status_code=404, detail=f"COG not found for year {year}")
        return Response(
            content=b"",
            media_type="image/png",
            headers={
                "Cache-Control": "public, max-age=3600",
                "X-Bbox-West": "0", "X-Bbox-South": "0",
                "X-Bbox-East": "0", "X-Bbox-North": "0",
            },
        )

    # GET: render PNG
    try:
        loop = asyncio.get_event_loop()
        png_bytes, bbox = await loop.run_in_executor(
            None,
            partial(_render_png, municipality_id, year, dataset_version),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    west, south, east, north = bbox
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Bbox-West":  str(west),
            "X-Bbox-South": str(south),
            "X-Bbox-East":  str(east),
            "X-Bbox-North": str(north),
        },
    )
