# Agent 5 — Evidence Agent

**Phase introduced:** 3
**Type:** Deterministic
**Module:** `backend/agents/evidence/`

---

## Goal

Ground *why* changes happened in supporting datasets, so explanations are correlational and inspectable rather than invented. The Evidence Agent produces statements the Narrative Agent can cite — statements that come from spatial math, not from the LLM.

---

## Trigger

Dispatched by the Orchestrator after Change Detection Agent completes. Runs in parallel with Cartography Agent in Phase 4.

---

## Inputs

- Top-N transitions from the Change Detection Agent (area-ranked, priority-flagged)
- Supporting datasets registered by the Ingestion Agent: road network, DEM, rivers, protected areas, population grids
- Municipality boundary polygon

---

## Process

1. Take the top-N transitions from the Change Detection Agent and rasterize their spatial footprint (transition pixels → binary mask).
2. For each transition footprint, run spatial association tests against supporting layers:

   | Test | Method |
   |---|---|
   | **Distance-to-road decay** | Compute distance from each transition pixel to nearest road; compare distribution to matched random baseline in same municipality |
   | **Protected-area overlap** | Compute fraction of transition pixels within protected area boundaries |
   | **Elevation + slope distribution** | Extract DEM values at transition pixels; compare to municipality baseline |
   | **River proximity** | Fraction of transition pixels within 200 m / 500 m / 1000 m of river network |
   | **Population pressure** | If population grid covers the year range, compute correlation of population change with built-up expansion |

3. Compute effect sizes with explicit uncertainty (Mann-Whitney U, chi-squared, or distance-distribution comparison with bootstrap CI).
4. Assign strength label based on effect size and sample adequacy:
   - `strong` — large effect, sufficient sample, consistent with prior literature
   - `moderate` — moderate effect or borderline sample size
   - `weak` — detectable but small effect
   - `insufficient data` — supporting dataset not available, or sample too small to interpret

5. Rank evidence statements by strength × transition area.

---

## Outputs

Per transition, one or more `EvidenceStatement` objects:

```json
{
  "transition": {"from": "Forest", "to": "Built-up"},
  "claim": "Forest→Built-up concentrated near roads",
  "metric": "68% of transition area within 500 m of road network",
  "baseline": "31% for random points in same municipality",
  "effect_size": 0.41,
  "ci_95": [0.35, 0.47],
  "strength": "strong",
  "sources": ["roads-dor-2020", "landcover-v3.1"],
  "provenance_id": "uuid"
}
```

For transitions with no available supporting data:

```json
{
  "transition": {"from": "Agriculture", "to": "Water"},
  "strength": "insufficient data",
  "reason": "River network dataset does not cover the 2000–2010 period for this municipality"
}
```

---

## Guardrails

- The words **`caused`**, **`because`**, and **`due to`** are forbidden in all output fields.
- Required phrasing for association: **`associated with`**, **`concentrated near`**, **`co-occurs with`**.
- Insufficient data must return `"strength": "insufficient data"` — never a plausible guess.
- Every statement must list its `sources` array so the Provenance Agent can link them.
- Bare correlation coefficients are forbidden — always pair with effect size and CI.

---

## Done when

Every top-N transition for the analyzed municipality has either:
- A ranked `EvidenceStatement` with `strength`, `metric`, `baseline`, and `sources`, OR
- An explicit `"strength": "insufficient data"` with a `reason` string

---

## Key implementation notes

```python
# Distance-to-road decay test
transition_distances = compute_distances_to_roads(transition_pixels, road_network)
baseline_distances = compute_distances_to_roads(random_sample_pixels, road_network)
statistic, pvalue = mannwhitneyu(transition_distances, baseline_distances, alternative='less')
# "less" = transition pixels are closer to roads than baseline
effect_size = rank_biserial_correlation(transition_distances, baseline_distances)
```

- Random baseline: stratified sample of N pixels from the same municipality (N = min(1000, transition_pixels × 3))
- Distance computation: use `scipy.spatial.cKDTree` against road network vertex coordinates
- Rasterize transition footprint at the resolution of the COG raster before spatial tests
- If municipality has < 50 transition pixels for a class pair, return `insufficient data`
