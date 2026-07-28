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
    let forestStable = 0;  // forest → forest (any subtype, including same-code)
    let forestLoss   = 0;  // forest → non-forest
    let forestGain   = 0;  // non-forest → forest
    let nonStable    = 0;  // non-forest → non-forest

    for (const t of change.transitions) {
      const fromF = FOREST_CODES.has(t.from_code);
      const toF   = FOREST_CODES.has(t.to_code);
      if       (fromF &&  toF) forestStable += t.area_km2;
      else if  (fromF && !toF) forestLoss   += t.area_km2;
      else if (!fromF &&  toF) forestGain   += t.area_km2;
      else                     nonStable    += t.area_km2;
    }
    return { forestLoss, forestGain, forestStable, nonStable };
  }, [change]);

  const hasAny = forestStable > 0.01 || nonStable > 0.01 || forestLoss > 0.01 || forestGain > 0.01;

  if (!hasAny) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">
          Forest Transitions ({change.from_year} → {change.to_year})
        </h3>
        <p className="text-xs text-gray-400">No transitions detected.</p>
      </div>
    );
  }

  // ── SVG layout: 4 flows including stable ─────────────────────────────────
  //
  // Source Forest  → Target Forest      (stable forest, dark green)
  // Source Forest  → Target Non-Forest  (forest loss, red)
  // Source Non-Forest → Target Non-Forest (stable non-forest, grey)
  // Source Non-Forest → Target Forest   (forest gain, dark blue)
  //
  // Node sizes proportional to total area flowing through them.

  const SVG_H  = 260;
  const availH = SVG_H - 24;
  const total  = forestStable + nonStable + forestLoss + forestGain || 1;

  const srcForestH = Math.max(((forestStable + forestLoss) / total) * availH, 8);
  const srcNonH    = Math.max(((nonStable + forestGain)   / total) * availH, 8);
  const tgtForestH = Math.max(((forestStable + forestGain) / total) * availH, 8);
  const tgtNonH    = Math.max(((nonStable + forestLoss)    / total) * availH, 8);

  const NODE_PAD = 14;

  const srcTotalH = srcForestH + srcNonH + NODE_PAD;
  const srcStartY = 12 + Math.max(0, (availH - srcTotalH) / 2);
  const srcForestY = srcStartY;
  const srcNonY    = srcStartY + srcForestH + NODE_PAD;

  const tgtTotalH = tgtForestH + tgtNonH + NODE_PAD;
  const tgtStartY = 12 + Math.max(0, (availH - tgtTotalH) / 2);
  const tgtForestY = tgtStartY;
  const tgtNonY    = tgtStartY + tgtForestH + NODE_PAD;

  const srcX = MARGIN_X;
  const tgtX = SVG_W - MARGIN_X - NODE_W;
  const cpX  = FLOW_W / 2.5;

  // Ribbon heights from total scale
  const sfH = Math.max((forestStable / total) * availH, forestStable > 0.01 ? 4 : 0);
  const lH  = Math.max((forestLoss   / total) * availH, forestLoss  > 0.01 ? 4 : 0);
  const snH = Math.max((nonStable    / total) * availH, nonStable   > 0.01 ? 4 : 0);
  const gH  = Math.max((forestGain   / total) * availH, forestGain  > 0.01 ? 4 : 0);

  const ribbon = (sx: number, sy: number, tx: number, ty: number, h: number) =>
    [
      `M ${sx} ${sy}`,
      `C ${sx + cpX} ${sy}, ${tx - cpX} ${ty}, ${tx} ${ty}`,
      `L ${tx} ${ty + h}`,
      `C ${tx - cpX} ${ty + h}, ${sx + cpX} ${sy + h}, ${sx} ${sy + h}`,
      "Z",
    ].join(" ");

  // Stacking: stable top, cross-class below
  const stableForestPath = ribbon(srcX + NODE_W, srcForestY, tgtX, tgtForestY, sfH);
  const lossPath         = ribbon(srcX + NODE_W, srcForestY + sfH, tgtX, tgtNonY + snH, lH);
  const stableNonPath    = ribbon(srcX + NODE_W, srcNonY, tgtX, tgtNonY, snH);
  const gainPath         = ribbon(srcX + NODE_W, srcNonY + snH, tgtX, tgtForestY + sfH, gH);

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
          {" · "}
          <span className="text-gray-500">
            Stable: Forest {fmt(forestStable)} km² · Non-Forest {fmt(nonStable)} km²
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

          {/* Stable non-forest — drawn first, behind */}
          {nonStable > 0.01 && (
            <path d={stableNonPath} fill={NON_FOREST_COLOUR} fillOpacity={0.5}
                  stroke={NON_FOREST_COLOUR} strokeOpacity={0.3} strokeWidth={0.5}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover({ label: "Stable Non-Forest", area: nonStable })}
                  onMouseLeave={() => setHover(null)} />
          )}

          {/* Stable forest */}
          {forestStable > 0.01 && (
            <path d={stableForestPath} fill={FOREST_COLOUR} fillOpacity={0.5}
                  stroke={FOREST_COLOUR} strokeOpacity={0.3} strokeWidth={0.5}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover({ label: "Stable Forest", area: forestStable })}
                  onMouseLeave={() => setHover(null)} />
          )}

          {/* Forest loss (red) */}
          {forestLoss > 0.01 && (
            <path d={lossPath} fill="#dc2626" fillOpacity={0.3}
                  stroke="#dc2626" strokeOpacity={0.25} strokeWidth={0.5}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover({ label: "Forest → Non-Forest (loss)", area: forestLoss })}
                  onMouseLeave={() => setHover(null)} />
          )}

          {/* Forest gain (dark blue) */}
          {forestGain > 0.01 && (
            <path d={gainPath} fill="#1d4ed8" fillOpacity={0.28}
                  stroke="#1d4ed8" strokeOpacity={0.2} strokeWidth={0.5}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover({ label: "Non-Forest → Forest (gain)", area: forestGain })}
                  onMouseLeave={() => setHover(null)} />
          )}

          {/* Source nodes */}
          <rect x={srcX} y={srcForestY} width={NODE_W} height={srcForestH} fill={FOREST_COLOUR} rx={3} />
          <text x={srcX - 8} y={srcForestY + srcForestH / 2}
                textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#374151">
            Forest
          </text>
          <text x={srcX - 8} y={srcForestY + srcForestH / 2 + 12}
                textAnchor="end" dominantBaseline="middle" fontSize={8} fill="#9ca3af">
            {fmt(forestStable + forestLoss)} km²
          </text>

          <rect x={srcX} y={srcNonY} width={NODE_W} height={srcNonH} fill={NON_FOREST_COLOUR} rx={3} />
          <text x={srcX - 8} y={srcNonY + srcNonH / 2}
                textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#374151">
            Non-Forest
          </text>
          <text x={srcX - 8} y={srcNonY + srcNonH / 2 + 12}
                textAnchor="end" dominantBaseline="middle" fontSize={8} fill="#9ca3af">
            {fmt(nonStable + forestGain)} km²
          </text>

          {/* Target nodes */}
          <rect x={tgtX} y={tgtForestY} width={NODE_W} height={tgtForestH} fill={FOREST_COLOUR} rx={3} />
          <text x={tgtX + NODE_W + 8} y={tgtForestY + tgtForestH / 2}
                textAnchor="start" dominantBaseline="middle" fontSize={10} fill="#374151">
            Forest
          </text>
          <text x={tgtX + NODE_W + 8} y={tgtForestY + tgtForestH / 2 + 12}
                textAnchor="start" dominantBaseline="middle" fontSize={8} fill="#9ca3af">
            {fmt(forestStable + forestGain)} km²
          </text>

          <rect x={tgtX} y={tgtNonY} width={NODE_W} height={tgtNonH} fill={NON_FOREST_COLOUR} rx={3} />
          <text x={tgtX + NODE_W + 8} y={tgtNonY + tgtNonH / 2}
                textAnchor="start" dominantBaseline="middle" fontSize={10} fill="#374151">
            Non-Forest
          </text>
          <text x={tgtX + NODE_W + 8} y={tgtNonY + tgtNonH / 2 + 12}
                textAnchor="start" dominantBaseline="middle" fontSize={8} fill="#9ca3af">
            {fmt(nonStable + forestLoss)} km²
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

      <p className="text-[10px] text-gray-400">
        Source: ICIMOD Nepal Land Cover · EPSG:32645 · Transitions computed at pixel level (30 m resolution)
      </p>
    </div>
  );
}
