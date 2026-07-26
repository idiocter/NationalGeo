"use client";

import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import type { ChangeMatrix } from "@/types/api";

interface Props {
  matrix: ChangeMatrix;
}

export function NetChangeTable({ matrix }: Props) {
  if (!matrix.net_change.length) return null;

  const entries = [...matrix.net_change]
    .filter((n) => Math.abs(n.delta_km2) > 0.01)
    .sort((a, b) => b.delta_km2 - a.delta_km2);

  const maxAbs = Math.max(...entries.map((n) => Math.abs(n.delta_km2)), 1);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        What changed · {matrix.from_year}–{matrix.to_year}
      </h3>

      <div className="space-y-2">
        {entries.map((nc) => {
          const isGain   = nc.delta_km2 > 0;
          const name     = CLASS_NAMES[nc.code] ?? nc.class_name;
          const colour   = CLASS_COLOURS[nc.code] ?? "#ccc";
          const barW     = (Math.abs(nc.delta_km2) / maxAbs) * 100;
          const sign     = isGain ? "+" : "−";
          const textCls  = isGain ? "text-emerald-700" : "text-red-600";
          const barColor = isGain ? "#10b981" : "#ef4444";

          return (
            <div key={nc.code}>
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colour }} />
                  <span className="text-xs text-gray-700 truncate">{name}</span>
                </div>
                <span className={`text-xs tabular-nums font-medium shrink-0 ml-2 ${textCls}`}>
                  {sign}{Math.abs(nc.delta_km2).toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
                  <span className="text-gray-400 font-normal ml-1">
                    ({sign}{Math.abs(nc.delta_pct).toFixed(1)}%)
                  </span>
                </span>
              </div>
              {/* Bar — grows from centre */}
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${barW}%`, backgroundColor: barColor, opacity: 0.75,
                           marginLeft: isGain ? 0 : `${100 - barW}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* CAGR — always visible, collapsed into compact rows */}
      {matrix.cagr && matrix.cagr.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            Annual growth rate (CAGR)
          </p>
          <div className="space-y-0.5">
            {matrix.cagr
              .filter((e) => Math.abs(e.cagr_pct) > 0.01)
              .sort((a, b) => Math.abs(b.cagr_pct) - Math.abs(a.cagr_pct))
              .map((entry) => {
                const isPos = entry.cagr_pct > 0;
                return (
                  <div key={entry.code} className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 truncate">
                      {CLASS_NAMES[entry.code] ?? entry.class_name}
                    </span>
                    <span className={`text-xs tabular-nums ${isPos ? "text-emerald-600" : "text-red-500"}`}>
                      {isPos ? "+" : ""}{entry.cagr_pct.toFixed(2)}%/yr
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
