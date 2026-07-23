# Agent 6 — Cartography Agent

**Phase introduced:** 4
**Type:** Deterministic
**Module:** `backend/agents/cartography/`

---

## Goal

Produce maps and charts good enough to appear in a government publication without editing.
Cartographic furniture and class colours are fixed — consistency across the entire platform is not optional.

---

## Trigger

Dispatched by the Orchestrator after Raster Analysis and Change Detection are complete. Runs in parallel with the Evidence Agent.

---

## Inputs

- Clipped raster chips (from Raster Analysis Agent)
- Statistics JSON and transition matrices (from Raster Analysis and Change Detection Agents)
- Municipality boundary polygon and metadata
- Map type requested: `land_cover | change_detection | forest_loss | urban_expansion | heat_map`

---

## Process

1. Select layout template by map type (one Jinja template per type; templates are version-controlled).
2. Apply the fixed class colour palette (see below) — colour-blind safe, identical across all maps.
3. Compose cartographic furniture on every map:
   - North arrow (top-right)
   - Scale bar (bottom-left, with km and miles)
   - Legend with class names and colours
   - CRS label (`EPSG:32645 / WGS 84 / UTM Zone 45N`)
   - Data source and dataset version
   - Generation date and provenance ID
4. Render at 300 DPI PNG (print) + vector SVG (web embedding).
5. Generate web tiles (XYZ tile scheme, zoom 8–16) for MapLibre rendering.
6. Build charts:
   - **Stacked area chart** — land-cover composition over all available years
   - **Line chart** — per-class area trend
   - **Sankey diagram** — top-N class transitions between two years
   - **Bar chart** — top-N changes ranked by absolute area
7. Time-lapse (when full 2000–2022 range is requested):
   - Render one PNG frame per year with fixed classification and year stamp
   - Encode to MP4 (H.264, 2 fps, 720p) and animated GIF (256-colour, 15 fps)

---

## Fixed class colour palette

| Code | Class | Hex | RGB |
|---|---|---|---|
| 1 | Forest | `#1a7a4a` | 26, 122, 74 |
| 2 | Agriculture | `#f5d44e` | 245, 212, 78 |
| 3 | Water | `#3b89c9` | 59, 137, 201 |
| 4 | Grassland | `#90d44b` | 144, 212, 75 |
| 5 | Open woodland | `#a8c97f` | 168, 201, 127 |
| 6 | Built-up | `#d63b2f` | 214, 59, 47 |
| 7 | Barren | `#c4b28a` | 196, 178, 138 |
| 8 | Snow | `#f0f0f0` | 240, 240, 240 |
| 0 | NoData | `#cccccc` | 204, 204, 204 |

These colours never vary between maps, between municipalities, or between reports.

---

## Outputs

- `maps/`: PNG (300 DPI), SVG, tile directory per map type
- `charts/`: JSON chart specs (Recharts-compatible) + rendered PNG
- `timelapse/`: MP4 + GIF for the full year series
- Every exported file carries its provenance ID in the filename and embedded metadata

---

## Guardrails

- Class colours never vary — no per-municipality colour customisation.
- Every exported map must contain all cartographic furniture. A map missing any element is a build failure.
- Provenance ID must be embedded in PNG EXIF (`ImageDescription`) and SVG `<metadata>`.
- Tiles must be clipped to the municipality boundary — no national-extent tile bleeding.

---

## Done when

- A map printed at A3 is legible and self-describing with no external caption
- All requested chart types are rendered without error
- SVG validates with no text outside the viewBox
- Time-lapse MP4 plays correctly in VLC and in browser `<video>` element

---

## Key implementation notes

- Use `matplotlib` with `cartopy` for static map rendering at 300 DPI
- Use `rio-tiler` or `titiler` for on-demand XYZ tile generation
- Sankey chart spec: output JSON in the format consumed by the `d3-sankey` library
- SVG dimensions: A4 (210 × 297 mm) for reports, 1200 × 900 px for web
- Time-lapse: use `imageio` or `ffmpeg` subprocess for MP4 encoding
- Tile zoom range: 8 (country) to 16 (ward-level detail); generate only what the municipality extent needs
