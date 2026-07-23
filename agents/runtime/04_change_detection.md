# Agent 4 — Change Detection Agent

**Phase introduced:** 2
**Type:** Deterministic
**Module:** `backend/agents/change/`

---

## Goal

Quantify *what became what* between years — not merely that totals moved.
The transition matrix is the foundation for both the Evidence Agent and the Narrative Agent.

---

## Trigger

Dispatched by the Orchestrator after Raster Analysis Agent has completed for all requested years.

---

## Process

1. Load the two year-rasters for the municipality (windowed chips, already clipped by Raster Analysis Agent — reuse or re-clip as needed).
2. Assert identical grid: same shape, same transform, same CRS. If not identical, raise and halt — this is an Ingestion Agent failure.
3. Build the full transition matrix: `from_class × to_class` pixel counts using `numpy` vectorized comparison.
4. Convert pixel counts → area in km² (same equal-area projection as Raster Analysis Agent).
5. Compute net change per class (`to_year_area - from_year_area`).
6. Compute percent of source class lost/gained for each transition.
7. Rank transitions by area; flag priority pairs with a `priority_flag`:
   - `Forest→Built-up`
   - `Forest→Agriculture`
   - `Agriculture→Built-up`
   - `Water→Agriculture`
8. For multi-year requests (full 2000–2022 series):
   - Compute pairwise transition matrices for consecutive years
   - Aggregate into annual class totals → trend series
   - Compute CAGR per class
   - Detect trend breakpoints using change-point detection (Pettitt test or similar)
9. Attach a confidence note: `"single-date annual composite; sub-pixel change not detectable"`.

---

## Outputs

One `ChangeMatrix` object per year pair:

```json
{
  "municipality_id": "np-bag-ktm-01",
  "from_year": 2015,
  "to_year": 2022,
  "crs_used": "EPSG:32645",
  "transitions": [
    {
      "from_code": 1, "from": "Forest",
      "to_code": 6, "to": "Built-up",
      "pixels": 7011, "area_km2": 6.31, "pct_of_source": 1.7,
      "priority_flag": true
    }
  ],
  "net_change": [
    {"class": "Forest", "code": 1, "delta_km2": -18.42, "delta_pct": -4.7}
  ],
  "trend_series": [
    {"year": 2000, "classes": [{"code": 1, "area_km2": 390.1}]},
    {"year": 2001, "classes": [{"code": 1, "area_km2": 388.4}]}
  ],
  "cagr_pct": [{"class": "Forest", "cagr": -0.8}, {"class": "Built-up", "cagr": 3.2}],
  "breakpoints": [{"class": "Forest", "year": 2012, "confidence": "moderate"}],
  "confidence_note": "single-date annual composite; sub-pixel change not detectable",
  "provenance_id": "uuid"
}
```

---

## Guardrails

- Never interpret causes — that is the Evidence Agent's job.
- Report noisy single-year class flips as a `noise_flag` rather than treating them as real events (e.g., class totals that reverse in the following year).
- Never smooth the transition counts — report what the pixels say.
- The word "caused" is forbidden in output.

---

## Done when

- Transition matrix row sums equal the source-year class totals exactly (to the pixel)
- Net-change values are consistent with the difference between year totals from Raster Analysis Agent

---

## Key implementation notes

```python
# Vectorized transition matrix
from_flat = from_array[mask].ravel()
to_flat = to_array[mask].ravel()
n_classes = 9  # codes 0–8
matrix = numpy.zeros((n_classes, n_classes), dtype=numpy.int64)
numpy.add.at(matrix, (from_flat, to_flat), 1)
# matrix[i][j] = pixels that were class i and became class j
```

- Row sum validation: `matrix[i].sum() == from_year_stats.classes[i].pixels` for every i
- Store the raw pixel matrix in the provenance record before converting to km²
- CAGR formula: `((end_value / start_value) ** (1 / n_years) - 1) * 100`
- Noisy flip filter: flag if a class loses > X% in year N and gains back > 80% in year N+1
