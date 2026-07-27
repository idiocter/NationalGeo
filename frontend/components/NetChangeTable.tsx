"use client";

import { FOREST_CODES, FOREST_COLOUR, NON_FOREST_COLOUR } from "@/lib/constants";
import type { ChangeMatrix } from "@/types/api";

interface Props {
  matrix: ChangeMatrix;
}

export function NetChangeTable({ matrix }: Props) {
  if (!matrix.net_change.length) return null;

  const forestDeltaKm2    = matrix.net_change.filter((n) =>  FOREST_CODES.has(n.code)).reduce((s, n) => s + n.delta_km2, 0);
  const nonForestDeltaKm2 = matrix.net_change.filter((n) => !FOREST_CODES.has(n.code)).reduce((s, n) => s + n.delta_km2, 0);

  // Weighted average CAGR for forest codes
  const forestCagr = (() => {
    if (!matrix.cagr?.length) return null;
    const entries = matrix.cagr.filter((e) => FOREST_CODES.has(e.code) && Math.abs(e.cagr_pct) > 0);
    if (!entries.length) return null;
    return entries.reduce((s, e) => s + e.cagr_pct, 0) / entries.length;
  })();
  const nonForestCagr = (() => {
    if (!matrix.cagr?.length) return null;
    const entries = matrix.cagr.filter((e) => !FOREST_CODES.has(e.code) && Math.abs(e.cagr_pct) > 0);
    if (!entries.length) return null;
    return entries.reduce((s, e) => s + e.cagr_pct, 0) / entries.length;
  })();

  const rows = [
    { label: "Forest Area",     colour: FOREST_COLOUR,     delta: forestDeltaKm2,    cagr: forestCagr },
    { label: "Non-Forest Area", colour: NON_FOREST_COLOUR, delta: nonForestDeltaKm2, cagr: nonForestCagr },
  ];

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.delta)), 1);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        What changed · {matrix.from_year}–{matrix.to_year}
      </h3>

      <div className="space-y-2">
        {rows.map(({ label, colour, delta, cagr }) => {
          const isGain   = delta > 0;
          const barW     = (Math.abs(delta) / maxAbs) * 100;
          const sign     = isGain ? "+" : "−";
          const textCls  = isGain ? "text-emerald-700" : "text-red-600";
          const barColor = isGain ? "#10b981" : "#ef4444";

          return (
            <div key={label}>
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colour }} />
                  <span className="text-xs text-gray-700 truncate">{label}</span>
                </div>
                <span className={`text-xs tabular-nums font-medium shrink-0 ml-2 ${textCls}`}>
                  {sign}{Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${barW}%`, backgroundColor: barColor, opacity: 0.75,
                           marginLeft: isGain ? 0 : `${100 - barW}%` }}
                />
              </div>
              {cagr != null && (
                <p className={`text-[10px] mt-0.5 ${cagr > 0 ? "text-emerald-600" : "text-red-500"}`}>
                  CAGR: {cagr > 0 ? "+" : ""}{cagr.toFixed(2)}%/yr
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
