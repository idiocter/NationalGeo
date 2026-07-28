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

export function ReportFigures({ jobId, result }: Props) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  // Only show figures whose artefact was actually generated for this job
  const available = FIGURES.filter(
    (f) => result.artefacts?.[f.key]?.url && !failed[f.key],
  );

  if (available.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">Report Figures</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          High-resolution figures from the generated report — click any figure to open full size.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5">
        {available.map((f) => {
          const src = f.url(jobId);
          return (
            <figure key={f.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <figcaption className="text-xs font-semibold text-gray-700">{f.label}</figcaption>
                <a
                  href={src}
                  download={f.filename}
                  aria-label={`Download ${f.label}`}
                  className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={f.label}
                  className="w-full h-auto object-contain"
                  loading="lazy"
                  onError={() => setFailed((prev) => ({ ...prev, [f.key]: true }))}
                />
              </a>
              <p className="text-[10px] text-gray-400">{f.caption}</p>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
