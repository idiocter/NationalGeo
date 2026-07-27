"use client";

import { FOREST_CODES, FOREST_COLOUR, NON_FOREST_COLOUR } from "@/lib/constants";
import type { LandCoverStatistics } from "@/types/api";

interface Props {
  stats: LandCoverStatistics;
}

export function StatisticsPanel({ stats }: Props) {
  const valid = stats.classes.filter((c) => c.code !== 0 && c.area_km2 > 0);

  const forestKm2    = valid.filter((c) =>  FOREST_CODES.has(c.code)).reduce((s, c) => s + c.area_km2, 0);
  const nonForestKm2 = valid.filter((c) => !FOREST_CODES.has(c.code)).reduce((s, c) => s + c.area_km2, 0);
  const total = forestKm2 + nonForestKm2 || 1;

  const entries = [
    { label: "Forest Area",     colour: FOREST_COLOUR,     km2: forestKm2,    pct: (forestKm2    / total) * 100 },
    { label: "Non-Forest Area", colour: NON_FOREST_COLOUR, km2: nonForestKm2, pct: (nonForestKm2 / total) * 100 },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Forest Cover · {stats.year}
        </h3>
        {stats.data_quality_flags.length > 0 && (
          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
            {stats.data_quality_flags[0]}
          </span>
        )}
      </div>

      {/* Stacked bar */}
      <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
        {entries.map(({ label, colour, pct }) => (
          <div
            key={label}
            style={{ width: `${pct}%`, backgroundColor: colour }}
            title={`${label}: ${pct.toFixed(1)}%`}
          />
        ))}
      </div>

      {/* Row list */}
      <div className="space-y-1.5">
        {entries.map(({ label, colour, km2, pct }) => (
          <div key={label}>
            <div className="flex items-center justify-between mb-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colour }} />
                <span className="text-xs text-gray-700 truncate">{label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-xs tabular-nums text-gray-500">
                  {km2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
                </span>
                <span className="text-xs tabular-nums text-gray-400 w-9 text-right">
                  {pct.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: colour, opacity: 0.7 }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-gray-400">
        {stats.crs_used} · {stats.cloud_or_nodata_pct.toFixed(1)}% no-data
      </p>
    </div>
  );
}
