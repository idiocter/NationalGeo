"use client";

import { useMemo, useState } from "react";
import { FOREST_CODES, FOREST_COLOUR, NON_FOREST_COLOUR } from "@/lib/constants";
import type { ChangeMatrix, CustomClassGroup } from "@/types/api";

interface Props {
  change: ChangeMatrix;
  customGroups?: CustomClassGroup[] | null;
}

// SVG layout constants
const NODE_W    = 14;
const SVG_W     = 520;
const MARGIN_X  = 120;
const FLOW_W    = SVG_W - 2 * MARGIN_X - 2 * NODE_W;

interface HoverInfo { label: string; area: number }

export function AlluvialChart({ change }: Props) {
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const { forestLoss, forestGain, forestStable, nonStable } = useMemo(() => {
    let forestStable = 0;
    let forestLoss   = 0; // forest → non-forest
    let forestGain   = 0; // non-forest → forest
    let nonStable    = 0;

    for (const t of change.transitions) {
      if (t.from_code === t.to_code) continue;
      const fromF = FOREST_CODES.has(t.from_code);
      const toF   = FOREST_CODES.has(t.to_code);
      if  (fromF &&  toF) forestStable += t.area_km2;
      else if (fromF)     forestLoss   += t.area_km2;
      else if (toF)       forestGain   += t.area_km2;
      else                nonStable    += t.area_km2;
    }
    return { forestLoss, forestGain, forestStable, nonStable };
  }, [change]);

  const hasChange = forestLoss > 0.01 || forestGain > 0.01;

  if (!hasChange) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">
          Forest Transitions ({change.from_year} → {change.to_year})
        </h3>
        <p className="text-xs text-gray-400">No significant forest boundary changes detected.</p>
      </div>
    );
  }

  // ── SVG layout: 2 source nodes, 2 target nodes ────────────────────────────
  //
  // We show only the CROSS-BOUNDARY flows in the diagram:
  //   Forest (from) → Non-Forest (to)   [forest loss, red-tinted green]
  //   Non-Forest (from) → Forest (to)   [forest gain, green]
  //
  // Within-category changes (forest→forest subtype, non→non subtype) are
  // shown as reference text, not as Sankey flows, so they don't dwarf the
  // cross-boundary transitions that actually matter.
  //
  // Node sizes are proportional to the cross-boundary flow they carry.

  const SVG_H  = 220;
  const availH = SVG_H - 24;

  // Two source nodes: Forest (carries forestLoss), Non-Forest (carries forestGain)
  // Two target nodes: Forest (carries forestGain), Non-Forest (carries forestLoss)
  const totalFlow  = forestLoss + forestGain || 1;
  const fLossH     = Math.max((forestLoss / totalFlow) * availH, 6);
  const fGainH     = Math.max((forestGain / totalFlow) * availH, 6);

  const NODE_PAD = 16;

  // Source: Forest node (top) + Non-Forest node (bottom)
  const srcForestH    = fLossH;
  const srcNonH       = fGainH;
  const srcTotalH     = srcForestH + srcNonH + NODE_PAD;
  const srcStartY     = 12 + (availH - srcTotalH) / 2;
  const srcForestY    = srcStartY;
  const srcNonY       = srcStartY + srcForestH + NODE_PAD;

  // Target: Forest node (top) + Non-Forest node (bottom)
  const tgtForestH    = fGainH;
  const tgtNonH       = fLossH;
  const tgtTotalH     = tgtForestH + tgtNonH + NODE_PAD;
  const tgtStartY     = 12 + (availH - tgtTotalH) / 2;
  const tgtForestY    = tgtStartY;
  const tgtNonY       = tgtStartY + tgtForestH + NODE_PAD;

  const srcX = MARGIN_X;
  const tgtX = SVG_W - MARGIN_X - NODE_W;
  const cpX  = FLOW_W / 2.5;

  // Loss link: src Forest → tgt Non-Forest
  const lossPath = [
    `M ${srcX + NODE_W} ${srcForestY}`,
    `C ${srcX + NODE_W + cpX} ${srcForestY}, ${tgtX - cpX} ${tgtNonY}, ${tgtX} ${tgtNonY}`,
    `L ${tgtX} ${tgtNonY + fLossH}`,
    `C ${tgtX - cpX} ${tgtNonY + fLossH}, ${srcX + NODE_W + cpX} ${srcForestY + fLossH}, ${srcX + NODE_W} ${srcForestY + fLossH}`,
    "Z",
  ].join(" ");

  // Gain link: src Non-Forest → tgt Forest
  const gainPath = [
    `M ${srcX + NODE_W} ${srcNonY}`,
    `C ${srcX + NODE_W + cpX} ${srcNonY}, ${tgtX - cpX} ${tgtForestY}, ${tgtX} ${tgtForestY}`,
    `L ${tgtX} ${tgtForestY + fGainH}`,
    `C ${tgtX - cpX} ${tgtForestY + fGainH}, ${srcX + NODE_W + cpX} ${srcNonY + fGainH}, ${srcX + NODE_W} ${srcNonY + fGainH}`,
    "Z",
  ].join(" ");

  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const netDelta = forestGain - forestLoss;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Forest Transitions — {change.from_year} → {change.to_year}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          <span className="text-red-500 font-medium">Loss: {fmt(forestLoss)} km²</span>
          {" · "}
          <span className="text-emerald-600 font-medium">Gain: {fmt(forestGain)} km²</span>
          {" · "}
          <span className={netDelta >= 0 ? "text-emerald-600" : "text-red-500"}>
            Net: {netDelta >= 0 ? "+" : ""}{fmt(netDelta)} km²
          </span>
        </p>
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-1.5 text-xs text-gray-700 w-fit">
          <span className="font-semibold">{hover.label}</span>
          {" — "}{hover.area.toLocaleString(undefined, { maximumFractionDigits: 1 })} km²
        </div>
      )}

      {/* SVG alluvial diagram */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full"
          style={{ height: SVG_H }}
          aria-label={`Forest transition flows ${change.from_year} to ${change.to_year}`}
        >
          {/* Year labels */}
          <text x={srcX + NODE_W / 2} y={9} textAnchor="middle"
                fontSize={9} fill="#9ca3af" fontWeight="700">{change.from_year}</text>
          <text x={tgtX + NODE_W / 2} y={9} textAnchor="middle"
                fontSize={9} fill="#9ca3af" fontWeight="700">{change.to_year}</text>

          {/* Forest Loss flow (Forest → Non-Forest): use a muted red-green */}
          {forestLoss > 0.01 && (
            <path
              d={lossPath}
              fill="#dc2626"
              fillOpacity={0.22}
              stroke="#dc2626"
              strokeOpacity={0.2}
              strokeWidth={0.5}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover({ label: "Forest → Non-Forest (loss)", area: forestLoss })}
              onMouseLeave={() => setHover(null)}
            />
          )}

          {/* Forest Gain flow (Non-Forest → Forest): green */}
          {forestGain > 0.01 && (
            <path
              d={gainPath}
              fill={FOREST_COLOUR}
              fillOpacity={0.32}
              stroke={FOREST_COLOUR}
              strokeOpacity={0.2}
              strokeWidth={0.5}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover({ label: "Non-Forest → Forest (gain)", area: forestGain })}
              onMouseLeave={() => setHover(null)}
            />
          )}

          {/* Source nodes */}
          <rect x={srcX} y={srcForestY} width={NODE_W} height={srcForestH} fill={FOREST_COLOUR} rx={3} />
          <text x={srcX - 7} y={srcForestY + srcForestH / 2}
                textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#374151">
            Forest
          </text>

          <rect x={srcX} y={srcNonY} width={NODE_W} height={srcNonH} fill={NON_FOREST_COLOUR} rx={3} />
          <text x={srcX - 7} y={srcNonY + srcNonH / 2}
                textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#374151">
            Non-Forest
          </text>

          {/* Target nodes */}
          <rect x={tgtX} y={tgtForestY} width={NODE_W} height={tgtForestH} fill={FOREST_COLOUR} rx={3} />
          <text x={tgtX + NODE_W + 7} y={tgtForestY + tgtForestH / 2}
                textAnchor="start" dominantBaseline="middle" fontSize={10} fill="#374151">
            Forest
          </text>

          <rect x={tgtX} y={tgtNonY} width={NODE_W} height={tgtNonH} fill={NON_FOREST_COLOUR} rx={3} />
          <text x={tgtX + NODE_W + 7} y={tgtNonY + tgtNonH / 2}
                textAnchor="start" dominantBaseline="middle" fontSize={10} fill="#374151">
            Non-Forest
          </text>
        </svg>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-red-50 border border-red-100 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-0.5">
            Forest Lost
          </p>
          <p className="text-sm font-bold text-red-700 tabular-nums">
            {fmt(forestLoss)} km²
          </p>
          <p className="text-[10px] text-red-400">converted to non-forest</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide mb-0.5">
            Forest Gained
          </p>
          <p className="text-sm font-bold text-emerald-700 tabular-nums">
            {fmt(forestGain)} km²
          </p>
          <p className="text-[10px] text-emerald-400">recovered from non-forest</p>
        </div>
      </div>

      {/* Within-category reference (non-zero only) */}
      {(forestStable > 0.01 || nonStable > 0.01) && (
        <p className="text-[10px] text-gray-400">
          Within-category changes not shown in diagram:{" "}
          {forestStable > 0.01 && (
            <span>forest subtype changes {fmt(forestStable)} km²{nonStable > 0.01 ? " · " : ""}</span>
          )}
          {nonStable > 0.01 && <span>non-forest subtype changes {fmt(nonStable)} km²</span>}
        </p>
      )}

      <p className="text-[10px] text-gray-400">
        Source: ICIMOD Nepal Land Cover · EPSG:32645 · Transitions computed at pixel level (30 m resolution)
      </p>
    </div>
  );
}
