"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { JobResult } from "@/types/api";

interface Props {
  jobId: string;
  result: JobResult;
}

type FigureKey = "comparison_map" | "forest_change_4class" | "change_map";

interface FigureDef {
  key: FigureKey;
  label: string;
  caption: string;
  url: (jobId: string) => string;
  filename: string;
}

// Map figures only — trend & transition (Sankey) are shown as the interactive
// charts above, so the static versions are not duplicated here.
const FIGURES: FigureDef[] = [
  {
    key: "comparison_map",
    label: "Land Cover Comparison Map",
    caption: "Side-by-side land cover for the baseline vs. analysis year, with north arrow and scale bar.",
    url: (id) => api.analysis.comparisonMapUrl(id),
    filename: "comparison_map.png",
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
    caption: "Spatial distribution of gain / loss within the municipality boundary.",
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
        <h3 className="text-base font-semibold text-gray-800">Report Maps</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Full-resolution maps from the generated report — click any map to open full size, or use the PNG link to download.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5">
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
                 title="Open full size"
                 className="flex items-center justify-center rounded-lg border border-gray-200
                            overflow-hidden bg-gray-50 p-2 hover:border-blue-400 transition-colors">
                {/* Placeholder keeps height while the on-demand PNG is generated */}
                {!loaded[f.key] && (
                  <div className="w-full h-48 flex items-center justify-center gap-2 text-xs text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    Rendering {f.label}…
                  </div>
                )}
                {/* Capped display height so square maps don't dominate the page;
                    click opens the full-resolution image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={f.label}
                  className={`max-h-[360px] w-auto max-w-full object-contain mx-auto
                              ${loaded[f.key] ? "block" : "hidden"}`}
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
