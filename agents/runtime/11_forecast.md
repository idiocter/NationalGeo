# Agent 11 — Forecast Agent

**Phase introduced:** 6 (not MVP — disabled until backtest beats Markov baseline)
**Type:** ML
**Module:** `backend/agents/forecast/`

---

## Goal

Project land-cover to 2025, 2030, and 2040 with honest uncertainty intervals.
If the backtest accuracy is below the agreed threshold, this feature stays disabled rather than shipping.

---

## Trigger

Only dispatched when:
1. The feature flag `FORECAST_ENABLED` is `true` (set only after a passing backtest)
2. The user explicitly requests forecasting outputs
3. Phase 1–4 outputs are already available for the municipality

---

## Process

### Step 1 — Feature stack construction
For each pixel in the municipality:
- Historical class sequence (one value per year, 2000–2022)
- Distance to nearest road (km)
- Distance to nearest river (km)
- Elevation (m) from DEM
- Slope (degrees) from DEM
- Population density (persons/km²) for matching years
- Protected area flag (boolean)
- Distance to urban core (km) — from 2000 Built-up centroid

### Step 2 — Baseline: Markov projection
1. Compute transition probability matrix from historical data: `P(from_class → to_class)` per municipality.
2. Apply matrix forward to project 2023, 2025, 2030, 2040 class distributions.
3. Compute uncertainty: bootstrap 1000 samples from historical transitions → CI per class.
4. **Ship this baseline before touching any ML.** It is the benchmark all ML must beat.

### Step 3 — ML model (only after baseline is measured)
1. Train a per-pixel transition classifier (Random Forest or XGBoost):
   - Features: full feature stack per pixel
   - Target: `to_class` given `from_class` and context
2. Training split: 2000–2015 (train), 2016–2022 (test — never touched during training).
3. Report: overall accuracy, Cohen's kappa, per-class recall and F1, confusion matrix.
4. If kappa > Markov baseline kappa + 0.05 → promote to primary model.
5. Run inference to project 2025, 2030, 2040 with Monte Carlo dropout or bootstrap CI.

### Step 4 — Output assembly
1. Emit projection rasters (one per target year, COG format) to object store.
2. Emit class area projections with 90% confidence intervals.
3. Produce projection maps (visually distinct from observed maps — see guardrails).
4. Register projections in the provenance record with model version and backtest metrics.

---

## Outputs

```json
{
  "municipality_id": "np-bag-ktm-01",
  "model": "random_forest_v1.0",
  "backtest_kappa": 0.71,
  "markov_baseline_kappa": 0.59,
  "projections": [
    {
      "year": 2030,
      "classes": [
        {
          "code": 1, "name": "Forest",
          "area_km2": 310.2,
          "ci_90_low": 290.1, "ci_90_high": 328.5
        }
      ],
      "label": "PROJECTION",
      "confidence_note": "Random Forest trained on 2000–2015; validated on 2016–2022. Kappa=0.71."
    }
  ]
}
```

---

## Guardrails

- Predictions labelled **PROJECTION** in: UI map styling, chart axes, API responses, all export formats.
- Confidence intervals are mandatory — no point estimates without a CI.
- Visually distinct from observed data: striped fill on maps, lighter opacity, dashed chart lines, distinct colour scheme.
- Feature flag `FORECAST_ENABLED=false` by default. Set to true only after a documented passing backtest.
- If backtest kappa < baseline + 0.05, the ML model is not promoted. Markov baseline is the fallback.
- Projections never appear in the same section as observed statistics without a clear visual separator.

---

## Done when

- Backtest on 2016–2022 data beats the Markov baseline on kappa score
- Per-class recall is documented for the backtesting period
- All outputs carry "PROJECTION" labels in every export format
- Disabling the feature flag removes all forecast outputs without affecting Phase 1–5 functionality
- Backtest report is committed to `backend/tests/golden/forecast_backtest.json`

---

## Key implementation notes

```python
# Markov baseline
transition_counts = numpy.zeros((9, 9), dtype=numpy.int64)
for year in range(2000, 2022):
    m = load_transition_matrix(municipality_id, year, year + 1)
    transition_counts += m.pixel_matrix

# Normalize rows to get transition probabilities
row_sums = transition_counts.sum(axis=1, keepdims=True)
P = numpy.where(row_sums > 0, transition_counts / row_sums, 0)

# Project forward
current_distribution = get_class_areas(municipality_id, year=2022)
for target_year in [2025, 2030, 2040]:
    steps = target_year - 2022
    projected = current_distribution @ numpy.linalg.matrix_power(P, steps)
```

- Use `joblib` for feature matrix computation parallelism
- LSTM / temporal CNN: evaluate only if RF/XGBoost backtest kappa > 0.75
- Protected-area boundary interaction: if a pixel is inside a protected area, reduce its transition probabilities toward built-up
- Store backtest metrics in PostGIS `model_versions` table for reproducibility
