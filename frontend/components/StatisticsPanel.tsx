"use client";

import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import type { LandCoverStatistics } from "@/types/api";

interface Props {
  stats: LandCoverStatistics;
}

export function StatisticsPanel({ stats }: Props) {
  const sorted = [...stats.classes].sort((a, b) => b.share_pct - a.share_pct);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Land cover — {stats.year}
        </h3>
        {stats.data_quality_flags.length > 0 && (
          <span className="text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 rounded px-2 py-0.5">
            {stats.data_quality_flags[0]}
          </span>
        )}
      </div>

      {/* Stacked colour bar */}
      <div className="flex h-3 rounded-full overflow-hidden">
        {sorted.map((cls) => (
          <div
            key={cls.code}
            style={{
              width: `${cls.share_pct}%`,
              backgroundColor: CLASS_COLOURS[cls.code] ?? "#ccc",
            }}
            title={`${cls.name}: ${cls.share_pct.toFixed(1)}%`}
          />
        ))}
      </div>

      {/* Table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400 border-b border-gray-100">
            <th className="text-left pb-1 font-medium">Class</th>
            <th className="text-right pb-1 font-medium">Area km²</th>
            <th className="text-right pb-1 font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((cls) => (
            <tr key={cls.code} className="border-b border-gray-50">
              <td className="py-1 flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: CLASS_COLOURS[cls.code] ?? "#ccc" }}
                />
                {CLASS_NAMES[cls.code] ?? cls.name}
              </td>
              <td className="text-right py-1 tabular-nums">
                {cls.area_km2.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </td>
              <td className="text-right py-1 tabular-nums text-gray-500">
                {cls.share_pct.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-gray-400">
        Projection: {stats.crs_used} · Nodata: {stats.cloud_or_nodata_pct.toFixed(1)}%
      </p>
    </div>
  );
}
