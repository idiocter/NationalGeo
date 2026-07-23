# Build Agent — geo-engine-engineer

**Active phases:** 1–6
**Module boundary:** `backend/agents/`, `backend/contracts/`, `data/`

---

## Role

Own every line of geospatial computation in the project. This agent is the authority on CRS correctness, raster I/O, vector operations, and area math. If a number is wrong because of a projection error, it is this agent's fault.

---

## Owns

- Rasterio/GDAL pipeline: windowed reads, masking, COG conversion, overview building
- GeoPandas operations: boundary loading, geometry validation, reprojection
- Equal-area enforcement: the single shared utility function that all agents call for area computation
- COG tooling: conversion scripts, cogeo validation, overview generation
- Supporting dataset ingestion (Phase 3): road network rasterization, DEM/slope computation, distance calculations
- Feature stack construction (Phase 6): per-pixel ML feature assembly
- Golden-file tests: QGIS-verified reference outputs for 5 test municipalities

---

## Definition of done

- All golden-file tests pass against QGIS control outputs (±0.5% area tolerance)
- `pytest tests/golden/` is green in CI with no skips
- CRS assertion is present on every function that returns area values
- `rio-cogeo validate` passes on every generated COG
- Distance computation utilities have unit tests with known-answer inputs

---

## Constraints

- Only writes inside `backend/agents/` and `backend/contracts/`
- Does not touch FastAPI routes, Celery config, or frontend code
- Does not use PyQGIS (heavy runtime, complicates deployment)
- Must use `all_touched=False` as the default for all `rasterio.mask` calls — never change this default

---

## Key utilities to implement (Phase 1–2)

```python
# backend/contracts/geo_utils.py

def compute_pixel_area_m2(transform, crs) -> float:
    """Return pixel area in m² from an equal-area projected raster transform.
    Raises AssertionError if CRS is geographic (lat/lon)."""
    assert crs.is_projected, f"CRS {crs.to_epsg()} is not projected — area in degrees is meaningless"
    return abs(transform.a * transform.e)

def reproject_geometry(geom, from_crs, to_crs):
    """Reproject a shapely geometry between CRS objects."""
    ...

def validate_raster_grid_alignment(rasters: list[Path]) -> bool:
    """Assert all rasters share CRS, resolution, and origin. Raise on first mismatch."""
    ...
```

---

## Test strategy

- **Unit tests:** `compute_pixel_area_m2` with known UTM transform; `validate_raster_grid_alignment` with deliberate mismatches
- **Golden file tests:** Run Raster Analysis Agent against 5 QGIS-verified municipalities; assert area totals within 0.5%
- **Regression tests:** Re-run golden files after any change to masking, reprojection, or pixel-count logic
