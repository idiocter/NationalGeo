"use client";

import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import type { LandCoverStatistics } from "@/types/api";

interface Props {
  stats: LandCoverStatistics;
}

export function StatisticsPanel({ stats }: Props) {
  const sorted = [...stats.classes]
    .filter((c) => c.code !== 0 && c.share_pct > 0.05)
    .sort((a, b) => b.share_pct - a.share_pct);

  const maxArea = sorted[0]?.area_km2 ?? 1;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Land cover · {stats.year}
        </h3>
        {stats.data_quality_flags.length > 0 && (
          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
            {stats.data_quality_flags[0]}
          </span>
        )}
      </div>

      {/* Stacked colour bar */}
      <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
        {sorted.map((cls) => (
          <div
            key={cls.code}
            style={{ width: `${cls.share_pct}%`, backgroundColor: CLASS_COLOURS[cls.code] ?? "#ccc" }}
            title={`${CLASS_NAMES[cls.code] ?? cls.name}: ${cls.share_pct.toFixed(1)}%`}
          />
        ))}
      </div>

      {/* Row list with inline bars */}
      <div className="space-y-1.5">
        {sorted.map((cls) => {
          const name   = CLASS_NAMES[cls.code] ?? cls.name;
          const colour = CLASS_COLOURS[cls.code] ?? "#ccc";
          const barPct = (cls.area_km2 / maxArea) * 100;
          return (
            <div key={cls.code}>
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: colour }}
                  />
                  <span className="text-xs text-gray-700 truncate">{name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-xs tabular-nums text-gray-500">
                    {cls.area_km2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
                  </span>
                  <span className="text-xs tabular-nums text-gray-400 w-9 text-right">
                    {cls.share_pct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${barPct}%`, backgroundColor: colour, opacity: 0.7 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-gray-400">
        {stats.crs_used} · {stats.cloud_or_nodata_pct.toFixed(1)}% no-data
      </p>
    </div>
  );
}
