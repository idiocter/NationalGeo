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
  wide?: boolean;   // spans the full width (for the 2:1 comparison map)
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
    wide: true,
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

// Forest = Forest, Open Woodland — true tree cover only (matches the backend map)
const FOREST_SET = new Set([4, 9]);
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

interface Chip { label: string; value: string; tone?: "emerald" | "red" | "blue" | "gray" }

const TONE: Record<NonNullable<Chip["tone"]>, string> = {
  emerald: "text-emerald-700 bg-emerald-50 border-emerald-100",
  red:     "text-red-700 bg-red-50 border-red-100",
  blue:    "text-blue-700 bg-blue-50 border-blue-100",
  gray:    "text-gray-700 bg-gray-50 border-gray-200",
};

// Key figures shown beside each map, computed from the job result.
function figureChips(key: FigureKey, result: JobResult): Chip[] {
  const stats = [...(result.statistics ?? [])].sort((a, b) => a.year - b.year);
  const cm = result.change_matrix?.[0] ?? null;
  const latest = stats[stats.length - 1];

  if (key === "comparison_map") {
    if (!latest) return [];
    const valid = latest.classes.filter((c) => c.code !== 0);
    const total = valid.reduce((s, c) => s + c.area_km2, 0);
    const top = [...valid].sort((a, b) => b.area_km2 - a.area_km2)[0];
    const chips: Chip[] = [{ label: "Total area", value: `${fmt(total)} km²`, tone: "gray" }];
    if (top) chips.push({ label: `Dominant · ${latest.year}`, value: `${top.name} (${top.share_pct.toFixed(1)}%)`, tone: "gray" });
    if (cm) chips.push({ label: "Period", value: `${cm.from_year} → ${cm.to_year}`, tone: "gray" });
    return chips;
  }

  if (key === "forest_change_4class") {
    if (!cm) return [];
    let sf = 0, snf = 0, loss = 0, gain = 0;
    for (const t of cm.transitions) {
      const f0 = FOREST_SET.has(t.from_code), f1 = FOREST_SET.has(t.to_code);
      if (f0 && f1) sf += t.area_km2;
      else if (f0 && !f1) loss += t.area_km2;
      else if (!f0 && f1) gain += t.area_km2;
      else snf += t.area_km2;
    }
    const tot = sf + snf + loss + gain || 1;
    const v = (x: number) => `${fmt(x)} km² · ${((100 * x) / tot).toFixed(1)}%`;
    return [
      { label: "Stable Forest", value: v(sf), tone: "emerald" },
      { label: "Stable Non-Forest", value: v(snf), tone: "gray" },
      { label: "Forest Loss", value: v(loss), tone: "red" },
      { label: "Forest Gain", value: v(gain), tone: "blue" },
    ];
  }

  // change_map
  if (!cm) return [];
  const changed = cm.transitions
    .filter((t) => t.from_code !== t.to_code)
    .reduce((s, t) => s + t.area_km2, 0);
  const nets = [...(cm.net_change ?? [])].filter((n) => Math.abs(n.delta_km2) > 0.01);
  const topGain = [...nets].sort((a, b) => b.delta_km2 - a.delta_km2)[0];
  const topLoss = [...nets].sort((a, b) => a.delta_km2 - b.delta_km2)[0];
  const chips: Chip[] = [{ label: "Area changed", value: `${fmt(changed)} km²`, tone: "gray" }];
  if (topGain && topGain.delta_km2 > 0)
    chips.push({ label: "Largest gain", value: `${topGain.class_name} +${fmt(topGain.delta_km2)} km²`, tone: "emerald" });
  if (topLoss && topLoss.delta_km2 < 0)
    chips.push({ label: "Largest loss", value: `${topLoss.class_name} ${fmt(topLoss.delta_km2)} km²`, tone: "red" });
  return chips;
}

export function ReportFigures({ jobId, result }: Props) {
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {visible.map((f) => {
          const src = f.url(jobId);
          return (
            <figure key={f.key} className={`space-y-2 ${f.wide ? "lg:col-span-2" : ""}`}>
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
                 className="block rounded-lg border border-gray-200 overflow-hidden bg-gray-50
                            hover:border-blue-400 transition-colors">
                {/* Placeholder keeps height while the on-demand PNG is generated */}
                {!loaded[f.key] && (
                  <div className="w-full h-48 flex items-center justify-center gap-2 text-xs text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    Rendering {f.label}…
                  </div>
                )}
                {/* Image fills its grid cell; the wide comparison map spans both
                    columns. Click opens the full-resolution image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={f.label}
                  className={`w-full h-auto object-contain ${loaded[f.key] ? "block" : "hidden"}`}
                  onLoad={() => setLoaded((prev) => ({ ...prev, [f.key]: true }))}
                  onError={() => setFailed((prev) => ({ ...prev, [f.key]: true }))}
                />
              </a>

              {/* Key numbers computed from the analysis result */}
              {(() => {
                const chips = figureChips(f.key, result);
                if (chips.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((c) => (
                      <span
                        key={c.label}
                        className={`inline-flex items-baseline gap-1 rounded-md border px-2 py-1
                                    text-[11px] ${TONE[c.tone ?? "gray"]}`}
                      >
                        <span className="font-medium opacity-70">{c.label}:</span>
                        <span className="font-semibold tabular-nums">{c.value}</span>
                      </span>
                    ))}
                  </div>
                );
              })()}

              <p className="text-[11px] text-gray-400">{f.caption}</p>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
