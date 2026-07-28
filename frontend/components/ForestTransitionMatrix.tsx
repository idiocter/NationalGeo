"use client";

import { useMemo } from "react";
import { FOREST_CODES } from "@/lib/constants";
import type { ChangeMatrix } from "@/types/api";

interface Props {
  change: ChangeMatrix;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

// Colours mirror the change / 4-class maps.
const C_STABLE_FOREST = "#2d6a4f"; // forest → forest
const C_LOSS          = "#cc3311"; // forest → non-forest
const C_GAIN          = "#2e8b57"; // non-forest → forest
const C_STABLE_NON    = "#9e9e9e"; // non-forest → non-forest

/**
 * Explicit 2×2 forest-transition breakdown between the two analysis years:
 *   Forest → Forest         (no change)
 *   Forest → Non-forest     (loss)
 *   Non-forest → Forest     (gain)
 *   Non-forest → Non-forest (no change)
 * with area (km²) and share of the municipality for each cell.
 */
export function ForestTransitionMatrix({ change }: Props) {
  const { ff, fn, nf, nn, total } = useMemo(() => {
    let ff = 0; // forest → forest
    let fn = 0; // forest → non-forest (loss)
    let nf = 0; // non-forest → forest (gain)
    let nn = 0; // non-forest → non-forest
    for (const t of change.transitions) {
      const fromF = FOREST_CODES.has(t.from_code);
      const toF   = FOREST_CODES.has(t.to_code);
      if      (fromF &&  toF) ff += t.area_km2;
      else if (fromF && !toF) fn += t.area_km2;
      else if (!fromF && toF) nf += t.area_km2;
      else                    nn += t.area_km2;
    }
    return { ff, fn, nf, nn, total: ff + fn + nf + nn };
  }, [change]);

  const t = total || 1;
  const pct = (v: number) => (v / t) * 100;
  const net = nf - fn; // gain − loss

  if (total <= 0.01) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">
          Forest Transition Matrix ({change.from_year} → {change.to_year})
        </h3>
        <p className="text-xs text-gray-400">No transitions detected.</p>
      </div>
    );
  }

  const Cell = ({
    area, colour, changed, label,
  }: { area: number; colour: string; changed: boolean; label: string }) => (
    <div className="rounded-lg p-3 border" style={{ borderColor: `${colour}44`, background: `${colour}12` }}>
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: colour }} />
        <span className="text-[11px] font-medium text-gray-700">{label}</span>
      </div>
      <div className="mt-1.5 text-lg font-bold text-gray-900 leading-none">
        {fmt(area)} <span className="text-xs font-medium text-gray-500">km²</span>
      </div>
      <div className="text-[11px] text-gray-500">
        {fmt(pct(area))}% of area · {changed ? "changed" : "no change"}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Forest Transition Matrix ({change.from_year} → {change.to_year})
        </h3>
        <p className="text-[11px] text-gray-400">
          Forest = Forest + Open Woodland. Rows = {change.from_year} state, columns = {change.to_year} state.
        </p>
      </div>

      {/* 2×2 matrix with row / column headers */}
      <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-stretch">
        <div />
        <div className="text-center text-[11px] font-semibold text-gray-500 self-end pb-1">
          → Forest {change.to_year}
        </div>
        <div className="text-center text-[11px] font-semibold text-gray-500 self-end pb-1">
          → Non-forest {change.to_year}
        </div>

        <div className="flex items-center text-[11px] font-semibold text-gray-500 pr-1 text-right">
          Forest {change.from_year} →
        </div>
        <Cell area={ff} colour={C_STABLE_FOREST} changed={false} label="Forest → Forest" />
        <Cell area={fn} colour={C_LOSS} changed label="Forest → Non-forest (loss)" />

        <div className="flex items-center text-[11px] font-semibold text-gray-500 pr-1 text-right">
          Non-forest {change.from_year} →
        </div>
        <Cell area={nf} colour={C_GAIN} changed label="Non-forest → Forest (gain)" />
        <Cell area={nn} colour={C_STABLE_NON} changed={false} label="Non-forest → Non-forest" />
      </div>

      {/* Summary strip */}
      <div className="flex flex-wrap gap-2 pt-1">
        <span className="text-[11px] rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200">
          Gain +{fmt(nf)} km² ({fmt(pct(nf))}%)
        </span>
        <span className="text-[11px] rounded-full px-2.5 py-1 bg-red-50 text-red-700 border border-red-200">
          Loss −{fmt(fn)} km² ({fmt(pct(fn))}%)
        </span>
        <span
          className={`text-[11px] rounded-full px-2.5 py-1 border ${
            net >= 0
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-red-50 text-red-700 border-red-200"
          }`}
        >
          Net {net >= 0 ? "+" : "−"}{fmt(Math.abs(net))} km² ({net >= 0 ? "+" : "−"}{fmt(Math.abs(pct(net)))}%)
        </span>
        <span className="text-[11px] rounded-full px-2.5 py-1 bg-gray-50 text-gray-600 border border-gray-200">
          Stable {fmt(pct(ff + nn))}%
        </span>
      </div>
    </div>
  );
}
