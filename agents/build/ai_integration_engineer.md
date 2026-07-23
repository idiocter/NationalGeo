# Build Agent — ai-integration-engineer

**Active phases:** 4
**Module boundary:** `backend/agents/narrative/`

---

## Role

Own the Ollama integration, prompt templates, numeric guard, and deterministic fallback. This agent is responsible for one thing: ensuring the Narrative Agent produces prose that is accurate, citable, and never invents a number. The LLM is a formatting tool — not an inference tool.

---

## Owns

- Ollama serving configuration: model pull, keep-alive, context length, timeout
- Prompt templates: Jinja2 templates for each narrative section (executive summary, key changes, evidence discussion, limitations)
- Numeric guard: extraction regex, diff logic, threshold, regeneration trigger
- Deterministic fallback: template-based prose generator that produces grammatically correct output with zero LLM involvement
- Citation ID injection: linking every quantitative sentence to a `stat:` or `evidence:` ID
- Machine-generated labelling: ensuring every output section carries the machine-generated marker

---

## Definition of done

- Numeric guard catches 100% of injected mismatches in the test suite (tested by deliberately seeding wrong numbers into prompts)
- Deterministic fallback produces correct prose for all 5 golden-municipality test cases without Ollama running
- Regeneration path is exercised in tests: first generation fails numeric guard → regenerate → pass
- Ollama service is optional: if not running, system falls through to deterministic template without crashing
- All narrative output in golden tests carries citation IDs that resolve to real statistic IDs

---

## Constraints

- Does not call any geospatial API or compute any number itself
- Model temperature must be ≤ 0.3 — do not raise this without a documented regression test showing it does not cause numeric drift
- The words `caused`, `because`, `due to`, `proves`, `confirms` are forbidden in prompt templates and must be checked by the numeric guard's text validator

---

## Prompt template structure (Phase 4)

```jinja2
{# templates/executive_summary.j2 #}
SYSTEM: You are a technical writer summarising GIS analysis results for a government planner.
You do not perform any calculations. Every number you write must come exactly from the data below.
Do not add context, interpretation, or examples not in the data.
Do not use the words: caused, because, due to, proves, confirms.
After each number, add its citation ID in brackets.

DATA:
Municipality: {{ municipality_name }} ({{ province }}, total area {{ total_area_km2 }} km²)
Analysis period: {{ from_year }}–{{ to_year }}
Dominant land cover: {{ dominant_class }} at {{ dominant_share_pct }}% [stat:{{ dominant_stat_id }}]
Largest single change: {{ top_change_class }} {{ top_change_direction }} {{ top_change_delta_km2 }} km² [stat:{{ top_change_stat_id }}]

TASK:
Write the executive summary section (3–5 sentences). Use only the data above.
```

---

## Numeric guard implementation

```python
# backend/agents/narrative/numeric_guard.py
import re
from dataclasses import dataclass

def extract_numbers(text: str) -> list[float]:
    return [float(m) for m in re.findall(r'\b\d+\.?\d*\b', text)]

def guard(narrative_text: str, source_numbers: set[float], tolerance: float = 0.001) -> bool:
    """Return True if all numbers in narrative_text exist in source_numbers."""
    for num in extract_numbers(narrative_text):
        if not any(abs(num - ref) / max(ref, 1.0) < tolerance for ref in source_numbers):
            return False
    return True
```

---

## Deterministic fallback template (must not use LLM)

```python
# backend/agents/narrative/fallback.py
def generate_executive_summary(stats, municipality_name, from_year, to_year) -> str:
    dominant = max(stats.classes, key=lambda c: c.share_pct)
    top_change = max(stats.net_change, key=lambda c: abs(c.delta_km2))
    direction = "decreased" if top_change.delta_km2 < 0 else "increased"
    return (
        f"{municipality_name} land cover analysis for {from_year}–{to_year} "
        f"[MACHINE-GENERATED]. "
        f"The dominant land cover class is {dominant.name} at {dominant.share_pct:.1f}% "
        f"of total area [stat:{dominant.stat_id}]. "
        f"{top_change.class_name} {direction} by {abs(top_change.delta_km2):.2f} km² "
        f"over the analysis period [stat:{top_change.stat_id}]."
    )
```

---

## Test strategy

- Numeric guard: inject 20 deliberate mismatches (off-by-one, percentage swap, sign flip) → assert all caught
- Regeneration: mock Ollama to return text with wrong number on first call, correct on second → assert single regeneration
- Fallback: disconnect Ollama → assert deterministic template output is grammatically correct for all 5 test municipalities
- Forbidden words: scan all generated output with regex for `caused|because|due to|proves|confirms`
