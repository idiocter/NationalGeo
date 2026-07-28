"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { JobResult } from "@/types/api";

interface Props {
  jobId: string;
  result: JobResult;
}

type FigureKey = "trend_chart" | "comparison_map" | "sankey" | "forest_change_4class" | "change_map";

interface FigureDef {
  key: FigureKey;
  label: string;
  caption: string;
  url: (jobId: string) => string;
  filename: string;
}

// Order mirrors the PDF report layout
const FIGURES: FigureDef[] = [
  {
    key: "trend_chart",
    label: "Land Cover Area Trend",
    caption: "Major classes (larger area) and minor classes (smaller area) on separate panels.",
    url: (id) => api.analysis.trendChartUrl(id),
    filename: "trend_chart.png",
  },
  {
    key: "comparison_map",
    label: "Land Cover Comparison",
    caption: "Side-by-side land cover for the baseline vs. analysis year, with north arrows.",
    url: (id) => api.analysis.comparisonMapUrl(id),
    filename: "comparison_map.png",
  },
  {
    key: "sankey",
    label: "Land Cover Transition Flow",
    caption: "Alluvial (Sankey) diagram of all transitions including stable cover. Ribbon width ∝ area.",
    url: (id) => api.analysis.sankeyUrl(id),
    filename: "sankey.png",
  },
  {
    key: "forest_change_4class",
    label: "Forest Change Map",
    caption: "Stable Non-Forest, Stable Forest, Forest Loss and Forest Gain, with percentage shares.",
    url: (id) => api.analysis.forestChangeMapUrl(id),
    filename: "forest_change_4class.png",
  },
  {
    key: "change_map",
    label: "Change Detection Map",
    caption: "Spatial distribution of gain / loss between the two years.",
    url: (id) => api.analysis.changeMapUrl(id),
    filename: "change_map.png",
  },
];

export function ReportFigures({ jobId }: Props) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  // Attempt every figure — the backend generates them on-demand. Figures that
  // genuinely cannot be produced (e.g. maps without source rasters) error out
  // and are hidden. This does not depend on artefacts being pre-populated.
  const visible = FIGURES.filter((f) => !failed[f.key]);

  if (visible.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-800">Report Figures</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Full-resolution figures from the generated report — click any figure to open full size.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {visible.map((f) => {
          const src = f.url(jobId);
          return (
            <figure key={f.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <figcaption className="text-sm font-semibold text-gray-700">{f.label}</figcaption>
                <a
                  href={src}
                  download={f.filename}
                  aria-label={`Download ${f.label}`}
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium
                             text-emerald-600 hover:text-emerald-700"
                >
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor"
                       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2v8m0 0l-3-3m3 3l3-3" />
                    <path d="M3 12h10" />
                  </svg>
                  PNG
                </a>
              </div>
              <a href={src} target="_blank" rel="noopener noreferrer"
                 className="block rounded-lg border border-gray-200 overflow-hidden bg-gray-50
                            hover:border-blue-400 transition-colors">
                {/* Placeholder keeps height while the on-demand PNG is generated */}
                {!loaded[f.key] && (
                  <div className="w-full h-56 flex items-center justify-center gap-2 text-xs text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    Rendering {f.label}…
                  </div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={f.label}
                  className={`w-full h-auto object-contain ${loaded[f.key] ? "block" : "hidden"}`}
                  onLoad={() => setLoaded((prev) => ({ ...prev, [f.key]: true }))}
                  onError={() => setFailed((prev) => ({ ...prev, [f.key]: true }))}
                />
              </a>
              <p className="text-[11px] text-gray-400">{f.caption}</p>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
