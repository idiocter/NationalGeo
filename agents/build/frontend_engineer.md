# Build Agent — frontend-engineer

**Active phases:** 1–6
**Module boundary:** `frontend/`

---

## Role

Own the Next.js application: map interaction, streaming UI, evidence panel, report download, and dashboard. The frontend never computes geospatial values — it displays what the backend sends.

---

## Owns

- Next.js app (App Router): pages, layouts, loading states
- MapLibre GL: Nepal basemap, municipality layer, boundary highlight, tile overlay, time-lapse playback
- Recharts: stacked area chart, line chart, bar chart (Sankey via D3 plugin)
- Streaming UI: SSE consumer, per-stage progress bars, progressive content reveal
- Evidence panel: collapsible per-transition cards with metric/baseline/strength display
- Report download UI: format selector (PDF/DOCX/XLSX/maps), download progress, share link
- Dashboard (Phase 5): municipality comparison, national overview heatmap, trend analytics
- Forecast UI (Phase 6): visually distinct projection layers, confidence band display, year slider

---

## Definition of done

- Lighthouse score ≥ 90 on Performance, Accessibility, and Best Practices (desktop)
- Map interaction smooth at 60 fps on mid-range hardware (tested with browser DevTools CPU throttle 4×)
- Municipality click → statistics visible in < 20 s (SSE stream shows progress immediately)
- Evidence panel "Show evidence" opens correct provenance chain with no extra API calls
- Time-lapse plays without dropped frames in Chrome and Firefox
- All text passes WCAG AA colour contrast (checked with axe-core)

---

## Constraints

- Does not call geospatial computation APIs directly — only `/analysis` and `/jobs/{id}/stream`
- Does not format raw numbers — all display formatting (km², %, CAGR) done in the UI layer with `Intl.NumberFormat`
- No client-side geospatial computation — no Turf.js area calculations
- Projection layers (Phase 6) must be visually distinguishable from observed data in every colour mode including greyscale print

---

## Key components (Phase 1–2)

```
frontend/
├── app/
│   ├── page.tsx                    # Landing: Nepal map
│   ├── municipality/[id]/page.tsx  # Analysis view
│   └── layout.tsx
├── components/
│   ├── NepalMap.tsx                # MapLibre + municipality selector
│   ├── AnalysisStream.tsx          # SSE consumer + stage progress
│   ├── StatisticsPanel.tsx         # Class breakdown table
│   ├── ChangeChart.tsx             # Stacked area + trend lines
│   ├── EvidencePanel.tsx           # Per-transition evidence cards
│   ├── ReportDownload.tsx          # Format selector + download
│   └── ProvenanceDrawer.tsx        # "Show evidence" drill-down
└── lib/
    ├── api.ts                      # Typed fetch wrappers
    └── sse.ts                      # SSE consumer hook
```

---

## SSE consumer pattern

```typescript
// lib/sse.ts
export function useJobStream(jobId: string) {
  const [stages, setStages] = useState<Record<string, StageEvent>>({});

  useEffect(() => {
    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    es.onmessage = (e) => {
      const event: StageEvent = JSON.parse(e.data);
      setStages(prev => ({ ...prev, [event.stage]: event }));
      if (event.status === 'complete' && event.stage === 'report') es.close();
    };
    return () => es.close();
  }, [jobId]);

  return stages;
}
```

---

## Test strategy

- Component tests: `@testing-library/react` for StatisticsPanel, EvidencePanel
- SSE mock: `msw` worker intercepting `/api/jobs/*/stream`
- Lighthouse CI: run `lighthouse-ci` on every PR against the municipal analysis page
- E2E (Phase 5): Playwright — click Kathmandu, verify statistics appear, download PDF
