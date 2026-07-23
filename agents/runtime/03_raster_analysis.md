# Agent 3 — Raster Analysis Agent

**Phase introduced:** 2
**Type:** Deterministic
**Module:** `backend/agents/raster/`

---

## Goal

Produce exact, projection-correct land-cover statistics for a boundary and year.
This is the engine of the entire platform — correctness here is non-negotiable.

---

## Trigger

Dispatched by the Orchestrator after the Ingestion Agent confirms the dataset is registered.

---

## Process

1. Fetch the municipality polygon at the pinned `boundary_version` from PostGIS.
2. Reproject the polygon to the raster's native CRS (for windowed read alignment).
3. Compute a windowed read from the COG — never load the national extent into memory.
4. Reproject the clipped raster chip to the Nepal equal-area projection (`EPSG:32645` — UTM Zone 45N) for all area math.
5. Mask the chip with `rasterio.mask` using `all_touched=False` (strict boundary; no partial pixels).
6. Count pixels per class with `numpy.bincount` on the masked array.
7. Convert pixel counts → area in km² using pixel area in the equal-area projection.
8. Compute per-class share percentages; verify they sum to 100 ± 0.01%.
9. Compute nodata percentage and boundary-edge pixel-fraction note.
10. Emit the statistics JSON (§5.2) and hand the input+output checksum to the Provenance Agent.

---

## Outputs

One `LandCoverStatistics` object per year:

```json
{
  "year": 2015,
  "municipality_id": "np-bag-ktm-01",
  "boundary_version": "mof-2021",
  "dataset_version": "landcover-v3.1",
  "crs_used": "EPSG:32645",
  "pixel_area_m2": 900,
  "total_pixels": 934120,
  "classes": [
    {"code": 1, "name": "Forest", "pixels": 412934, "area_km2": 371.64, "share_pct": 44.2}
  ],
  "unclassified_pct": 0.3,
  "cloud_or_nodata_pct": 1.1,
  "edge_pixel_fraction": 0.04,
  "provenance_id": "uuid"
}
```

---

## Guardrails

- No smoothing, interpolation, or gap-filling. Raw pixel counts only.
- If `cloud_or_nodata_pct > 5.0`, emit a `data_quality_flag` rather than proceeding silently.
- Area must be computed in the equal-area projection — never in degrees. Enforce with an assertion.
- `all_touched=False` is mandatory; never silently default to `True`.

---

## Done when

- Class shares sum to 100 ± 0.01% for every year requested
- Result reconciles with a QGIS control run within ±0.5%
- Golden-file tests pass for all 5 reference municipalities

---

## Key implementation notes

```python
# Enforce equal-area before any area math
assert raster_crs.is_projected, "Must reproject to equal-area before computing area"
pixel_area_m2 = transform.a * abs(transform.e)  # from equal-area transform
area_km2 = (pixel_count * pixel_area_m2) / 1_000_000
```

- Use `rasterio.windows.from_bounds` with the polygon bbox for the windowed read
- The windowed read chip can be entirely NoData for very small municipalities — handle gracefully
- Cache the result at `(municipality_id, year, dataset_version, boundary_version)` after validation passes
- Provenance record must log: input raster checksum, polygon WKT, CRS used, pixel_area_m2, library versions
