# Build Agent — ml-engineer

**Active phases:** 6
**Module boundary:** `backend/agents/forecast/`

---

## Role

Own the ML forecasting pipeline: feature stack, baseline Markov model, RF/XGBoost classifier, backtesting harness, and model versioning. This agent does not write geospatial I/O code — it receives feature matrices from the geo-engine-engineer and returns prediction arrays.

---

## Owns

- Markov transition-matrix baseline: computation, forward projection, bootstrap CI
- Random Forest / XGBoost per-pixel transition classifier: training, hyperparameter search, inference
- Backtesting harness: train/test split, evaluation metrics (accuracy, kappa, per-class recall/F1), confusion matrix
- Feature importance analysis: which spatial features drive transitions
- Model versioning: serialise models to `infra/models/`, log version + training parameters in PostGIS
- Prediction post-processing: spatial smoothing (optional, if it improves kappa without overfitting), CI assembly

---

## Definition of done

- Reproducible backtest report committed to `backend/tests/golden/forecast_backtest.json`
- RF/XGBoost backtest kappa > Markov baseline kappa + 0.05 (or feature stays disabled)
- Per-class recall ≥ 0.60 for Forest, Agriculture, and Built-up classes
- Training a model from scratch with the same random seed produces bit-identical output
- `FORECAST_ENABLED=false` in `.env.example` — this agent does not change that default

---

## Constraints

- Does not write PostGIS queries or raster I/O — calls `geo_engine_engineer` utilities
- Does not touch the frontend or API layer
- Does not skip the Markov baseline — it must be implemented and evaluated first
- LSTM / temporal CNN are only evaluated if RF/XGBoost kappa > 0.75 (documented threshold)

---

## Feature stack contract (input from geo-engine-engineer)

```python
@dataclass
class PixelFeature:
    pixel_id: int           # row * ncols + col
    from_class: int         # class code at from_year
    historical_sequence: list[int]  # class code per year, 2000–from_year
    dist_to_road_km: float
    dist_to_river_km: float
    elevation_m: float
    slope_deg: float
    population_density: float  # persons/km², nearest census year
    in_protected_area: bool
    dist_to_urban_km: float
```

---

## Backtesting harness

```python
# backend/agents/forecast/backtest.py

TRAIN_END = 2015
TEST_START = 2016
TEST_END = 2022

def run_backtest(municipality_id: str, model: BaseTransitionModel) -> BacktestReport:
    X_train, y_train = build_feature_matrix(municipality_id, years=range(2000, TRAIN_END))
    X_test, y_test = build_feature_matrix(municipality_id, years=range(TEST_START, TEST_END))

    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)

    return BacktestReport(
        municipality_id=municipality_id,
        model_name=model.name,
        overall_accuracy=accuracy_score(y_test, y_pred),
        kappa=cohen_kappa_score(y_test, y_pred),
        per_class_recall=recall_score(y_test, y_pred, average=None),
        confusion_matrix=confusion_matrix(y_test, y_pred).tolist(),
    )
```

---

## Model comparison protocol

1. Run `MarkovModel.backtest()` → record `markov_kappa`
2. Run `RandomForestModel.backtest()` → record `rf_kappa`
3. If `rf_kappa > markov_kappa + 0.05`: promote RF, set `FORECAST_ENABLED=true` in staging
4. If not: keep Markov as the disabled baseline, document the gap, do not ship
5. Commit `forecast_backtest.json` with both results before touching production

---

## Test strategy

- Unit tests: `MarkovModel` on synthetic 3-class, 10-year transition data with known steady state
- Overfitting check: assert train accuracy - test accuracy < 0.10
- Seed reproducibility: `numpy.random.seed(42)` + `sklearn` `random_state=42` → bit-identical model
- Feature importance: assert that `from_class` and `dist_to_road_km` are always in the top-5 features
