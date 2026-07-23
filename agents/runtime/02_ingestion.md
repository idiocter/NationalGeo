# Agent 2 — Ingestion Agent

**Phase introduced:** 1 (core), extended in Phase 3 (supporting datasets)
**Type:** Deterministic
**Module:** `backend/agents/ingestion/`

---

## Goal

Guarantee that every raster and vector entering the system is valid, aligned, and versioned.
Bad data here poisons everything downstream — this is the most important agent to get right first.

---

## Trigger

- New dataset drop (manual or automated)
- A job referencing an unregistered `dataset_version`

---

## Process

### Phase 1: Land-cover rasters

1. Read raster metadata: CRS, resolution, extent, nodata value, dtype, band count.
2. Reject or flag anomalies:
   - Mismatched grid alignment across years
   - Unexpected class codes (anything not in the codebook)
   - Resolution drift between years
   - CRS inconsistency
3. Convert to COG (`gdal_translate` with `-co TILED=YES -co COMPRESS=DEFLATE -co COPY_SRC_OVERVIEWS=YES`); build overviews at levels 2, 4, 8, 16, 32.
4. Write to object store under `landcover/{version}/{year}.tif`.
5. Load boundary layers into PostGIS; fix invalid geometries with `ST_MakeValid`; build spatial indexes (`GIST`).
6. Register the dataset version in the `datasets` table with: checksum (SHA-256), source URL, license, ingest timestamp, operator note.
7. Run a class-histogram sanity check per year; store as the baseline in `class_histograms`.

### Phase 3 extension: Supporting datasets

8. Ingest road network (DoR), DEM, river network, protected area boundaries, population grids.
9. Apply the same registration, checksum, and versioning logic.
10. Store vectors in PostGIS; rasters as COG in the `supporting/` prefix.

---

## Outputs

- Registered `dataset_version` record in PostGIS
- COG files in object store
- Indexed PostGIS boundary and supporting layers
- Ingest report: per-file status, anomalies found, class-histogram baseline

---

## Guardrails

- Datasets are **immutable once registered**. Corrections create a new version — never an overwrite. This is what makes old reports reproducible.
- A dataset with any mismatched grid alignment must be rejected, not coerced.
- Ingest must fail loudly — no silent partial ingest. Either all years pass or none are registered.

---

## Done when

- All 23 years share identical CRS, resolution, and grid origin
- Every class code in every year maps to the class codebook
- The `datasets` table has a checksum-verified record for every ingested file
- Supporting datasets (Phase 3) have their own versioned records

---

## Key implementation notes

- Use `rasterio.open` with `'r'` mode for metadata; never load the full array during validation
- CRS equivalence check: compare PROJ WKT, not EPSG code strings (same projection, different authority strings)
- COG validation: use `cogeo-mosaic` or `rio-cogeo validate` to confirm output is a valid COG
- Histogram baseline is used by the Validation Agent in later phases to flag impossible values
- Equal-area check: verify the raster's projection supports area computation before accepting it
