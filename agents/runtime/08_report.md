# Agent 8 — Report Agent

**Phase introduced:** 4
**Type:** Deterministic
**Module:** `backend/agents/report/`

---

## Goal

Assemble all upstream outputs into professional, self-contained deliverables that are identical across PDF viewers and portable without external files.

---

## Trigger

Dispatched by the Orchestrator as the final stage, after Validation Agent confirms all inputs are clean.

---

## Inputs

- Statistics JSON (Raster Analysis Agent)
- Transition matrix and trend series (Change Detection Agent)
- Evidence statements (Evidence Agent)
- Maps, charts, and time-lapse (Cartography Agent)
- Narrative sections with citation IDs (Narrative Agent)
- Complete provenance record (Provenance Agent)
- Municipality metadata (PostGIS)

---

## Process

1. Build a document model in memory:
   - Cover page: municipality name, province, analysis period, generation date, provenance ID, verification URL
   - Methodology section: projection used, boundary version, dataset version, class codebook
   - Statistics tables: one per year, all classes, area in km² and share %
   - Map section: land-cover map, change-detection map, additional requested maps
   - Charts section: stacked area trend, top-N transitions Sankey, class trend lines
   - Narrative section: executive summary → key changes → evidence discussion → limitations
   - Evidence appendix: full evidence statement list with metrics and sources
   - Provenance appendix: per-stage audit record with checksums and library versions

2. Render to all four formats:
   - **PDF** (WeasyPrint): vector text, embedded 300 DPI maps, embedded charts as SVG
   - **DOCX** (python-docx): editable tables, embedded PNG maps, narrative as styled paragraphs
   - **XLSX** (openpyxl): raw numeric tables — no formatted text, no merged cells, no colour; pure data for reuse
   - **Map bundle** (ZIP): all PNG and SVG maps + time-lapse MP4 + GIF

3. Version and store each artefact in object storage.
4. Return download links and artefact checksums.

---

## Outputs

```json
{
  "job_id": "uuid",
  "municipality_id": "np-bag-ktm-01",
  "period": "2000–2022",
  "artefacts": {
    "pdf": {"url": "...", "checksum": "sha256:...", "size_bytes": 4200000},
    "docx": {"url": "...", "checksum": "sha256:..."},
    "xlsx": {"url": "...", "checksum": "sha256:..."},
    "map_bundle": {"url": "...", "checksum": "sha256:..."}
  },
  "provenance_id": "uuid",
  "generated_at": "2024-03-15T09:23:41Z"
}
```

---

## Guardrails

- No report ships without the provenance appendix. A report missing provenance is a hard build failure.
- XLSX exports contain raw values only: no formatted text, no `%` symbols in cells, no currency formatting — the consumer formats their own view.
- PDF must embed all fonts (no system font dependencies).
- Provenance ID and verification URL appear on the cover page of every format that supports it.
- DOCX and PDF must be identical in content (not necessarily layout); discrepancies are a bug.

---

## Done when

- All four formats generate without error
- PDF renders identically in Adobe Acrobat, browsers, and Evince
- XLSX opens in Excel and LibreOffice Calc with correct numeric values
- Provenance appendix links every figure to its producing stage
- All maps in the PDF are 300 DPI when printed at A3

---

## Key implementation notes

- WeasyPrint: use `@page` CSS for A4 sizing; embed charts as `<img src="data:image/svg+xml;base64,...">` to avoid external file references
- python-docx: use `Document.add_picture` with `BytesIO` — never write temp files to disk for images
- openpyxl: set `number_format = '#,##0.00'` only on numeric cells; string columns must not have number formats
- Artefact storage path: `reports/{municipality_id}/{job_id}/{format}.{ext}`
- Verification URL format: `https://{host}/verify/{provenance_id}` — points to the evidence panel
- Report generation timeout: 60 s per format; fail that format, emit the others
