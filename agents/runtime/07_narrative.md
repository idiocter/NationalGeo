# Agent 7 — Narrative Agent

**Phase introduced:** 4
**Type:** LLM (the only LLM agent in the system)
**Module:** `backend/agents/narrative/`

---

## Goal

Turn validated, structured numbers into clear prose for a planner who does not read GIS.
The model explains what the engine computed — it does not compute anything itself.

---

## Model

- **Primary:** Ollama serving `llama3.1:8b` or `mistral:7b` locally
- **Fallback (premium long-form reports):** Cloud API (`claude-haiku-4-5-20251001` or equivalent)
- **Deterministic fallback (numeric guard failure):** Template-based prose (no LLM)

---

## Trigger

Dispatched by the Orchestrator after Validation Agent confirms all upstream outputs are valid.
The Narrative Agent must be the second-to-last stage — only the Report Agent comes after.

---

## Inputs (strict — nothing else)

- Statistics JSON — `LandCoverStatistics` objects for all requested years (§5.2)
- Transition matrix — `ChangeMatrix` for each year pair (§5.3)
- Evidence statements — `EvidenceStatement` array from Evidence Agent
- Municipality metadata — name, province, total area, population (from PostGIS)

**Never receives:** raw rasters, unvalidated data, intermediate computations, anything not in the above list.

---

## Process

1. Build a strict prompt template with all numeric slots pre-filled from the input JSON.
   The model never receives empty slots — it fills prose around numbers it is given.
2. Generate structured narrative sections:
   - **Executive summary** (3–5 sentences: municipality, period, dominant land cover, biggest single change)
   - **Key changes** (one paragraph per top-3 transitions, citing the transition area and percentage)
   - **Evidence discussion** (what supporting data says about each top transition, at the strength provided)
   - **Data limitations** (nodata percentage, confidence note from Change Detection, any quality flags)
3. Every quantitative sentence must include a citation ID referencing the source statistic or evidence statement.
4. **Numeric guard (mandatory post-generation step):**
   - Extract every number from the generated prose using regex
   - Diff each extracted number against the source JSON
   - Any mismatch (absolute or relative > 0.1%) → regenerate once with an explicit correction instruction
   - Second mismatch → fall back to deterministic template; log the failure for review
5. Label all output sections as `"source": "machine-generated-narrative"`.

---

## Outputs

```json
{
  "sections": {
    "executive_summary": {
      "text": "Kathmandu metropolitan area experienced a net forest loss of 18.4 km² between 2015 and 2022 [stat:2015-2022-net-change-forest], representing 4.7% of the 2015 forest cover.",
      "citations": ["stat:2015-2022-net-change-forest", "stat:2015-forest-share"]
    },
    "key_changes": {...},
    "evidence_discussion": {...},
    "data_limitations": {...}
  },
  "numeric_guard_passed": true,
  "fallback_used": false,
  "model": "llama3.1:8b",
  "source": "machine-generated-narrative"
}
```

---

## Guardrails

- **Temperature ≤ 0.3** — no creative variation on factual output.
- **No arithmetic** — the model does not compute percentages, differences, or rates. All numbers are pre-filled.
- **No causal claims** beyond what the Evidence Agent supplied, at the strength it supplied.
  - If Evidence Agent said `"strength": "moderate"`, narrative must not escalate to `"strong"` language.
- **Citation required** on every quantitative sentence.
- **Machine-generated label** must appear in every section header.
- **Forbidden phrasing:** `caused by`, `because of`, `due to`, `proves`, `confirms`.

---

## Done when

- Numeric guard passes on all generated sections
- Every quantitative sentence carries a citation ID that resolves to a real statistic or evidence statement
- Fallback template is tested independently and produces grammatically correct prose for all municipalities

---

## Key implementation notes

```python
# Numeric guard
import re
numbers_in_prose = re.findall(r'\b\d+\.?\d*\b', narrative_text)
for num in numbers_in_prose:
    if not any(abs(float(num) - ref) / max(ref, 1) < 0.001 for ref in source_numbers):
        raise NumericMismatchError(f"Number {num} not found in source JSON")
```

- System prompt: `"You are a technical writer summarising GIS analysis results. You do not perform any calculations. You do not make causal claims. Every number you write must come exactly from the data provided. You do not add context, interpretation, or examples not in the data."`
- Prompt template variables: `{{municipality_name}}`, `{{period}}`, `{{top_class}}`, `{{top_class_share}}`, etc. — all pre-filled
- Ollama inference timeout: 30 s (single municipality); 90 s (full series report)
- If Ollama is unavailable, fall through to deterministic template immediately without retry
