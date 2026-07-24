"use client";

import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import type { ChangeMatrix } from "@/types/api";

interface Props {
  matrix: ChangeMatrix;
}

export function NetChangeTable({ matrix }: Props) {
  if (!matrix.net_change.length) return null;

  const sorted = [...matrix.net_change].sort((a, b) => b.delta_km2 - a.delta_km2);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">
        Net change — {matrix.from_year}→{matrix.to_year}
      </h3>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400 border-b border-gray-100">
            <th className="text-left pb-1 font-medium">Class</th>
            <th className="text-right pb-1 font-medium">Δ km²</th>
            <th className="text-right pb-1 font-medium">Δ %</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((nc) => {
            const isGain = nc.delta_km2 > 0;
            const colour = isGain ? "text-green-700" : "text-red-600";
            const bgColour = isGain ? "bg-green-50" : "bg-red-50";
            const classColour = CLASS_COLOURS[nc.code] ?? "#ccc";
            const name = CLASS_NAMES[nc.code] ?? nc.class_name;
            return (
              <tr key={nc.code} className="border-b border-gray-50">
                <td className="py-1 flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: classColour }}
                  />
                  {name}
                </td>
                <td className={`text-right py-1 tabular-nums font-medium ${colour}`}>
                  {isGain ? "+" : ""}{nc.delta_km2.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td className={`text-right py-1 tabular-nums rounded px-1 ${colour} ${bgColour}`}>
                  {isGain ? "+" : ""}{nc.delta_pct.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {matrix.cagr && matrix.cagr.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
            CAGR by class
          </summary>
          <table className="w-full text-xs mt-1">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left pb-1 font-medium">Class</th>
                <th className="text-right pb-1 font-medium">CAGR %/yr</th>
              </tr>
            </thead>
            <tbody>
              {matrix.cagr.map((entry) => {
                const isPos = entry.cagr_pct > 0;
                return (
                  <tr key={entry.code} className="border-b border-gray-50">
                    <td className="py-0.5">{CLASS_NAMES[entry.code] ?? entry.class_name}</td>
                    <td className={`text-right tabular-nums ${isPos ? "text-green-700" : "text-red-600"}`}>
                      {isPos ? "+" : ""}{entry.cagr_pct.toFixed(2)}%/yr
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
