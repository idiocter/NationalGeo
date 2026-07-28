"use client";

import { useMemo, useState } from "react";
import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import type { ChangeMatrix, CustomClassGroup } from "@/types/api";

interface Props {
  change: ChangeMatrix;
  customGroups?: CustomClassGroup[] | null;
}

const MIN_FLOW_KM2 = 0.5;
const NODE_W       = 14;
const NODE_PAD     = 12;   // px between nodes
const MIN_NODE_PX  = 5;    // minimum rendered node height
const MARGIN_L     = 126;  // space for left labels
const MARGIN_R     = 126;  // space for right labels
const SVG_W        = 560;
const FLOW_W       = SVG_W - MARGIN_L - MARGIN_R - 2 * NODE_W;

function resolveLabel(code: number, cg?: CustomClassGroup[] | null) {
  if (cg) { const g = cg.find((g) => g.codes.includes(code)); if (g) return g.name; }
  return CLASS_NAMES[code] ?? `Class ${code}`;
}
function resolveColor(code: number, cg?: CustomClassGroup[] | null) {
  if (cg) { const g = cg.find((g) => g.codes.includes(code)); if (g) return g.color; }
  return CLASS_COLOURS[code] ?? "#94a3b8";
}

interface HoverInfo { label: string; area: number; pct?: number }

export function AlluvialChart({ change, customGroups }: Props) {
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const { flows, srcCodes, tgtCodes, totalArea } = useMemo(() => {
    const flows = change.transitions
      .filter((t) => t.from_code !== t.to_code && t.area_km2 >= MIN_FLOW_KM2)
      .sort((a, b) => b.area_km2 - a.area_km2);

    const srcTotals = new Map<number, number>();
    const tgtTotals = new Map<number, number>();
    for (const f of flows) {
      srcTotals.set(f.from_code, (srcTotals.get(f.from_code) ?? 0) + f.area_km2);
      tgtTotals.set(f.to_code,   (tgtTotals.get(f.to_code)   ?? 0) + f.area_km2);
    }

    const srcCodes = [...srcTotals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const tgtCodes = [...tgtTotals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const totalArea = [...srcTotals.values()].reduce((s, v) => s + v, 0) || 1;

    return { flows, srcCodes, tgtCodes, totalArea };
  }, [change, customGroups]);

  if (flows.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">
          Land Cover Transitions ({change.from_year} → {change.to_year})
        </h3>
        <p className="text-xs text-gray-400">
          No significant transitions detected above {MIN_FLOW_KM2} km².
        </p>
      </div>
    );
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  const nMax   = Math.max(srcCodes.length, tgtCodes.length);
  const SVG_H  = Math.max(240, nMax * 42 + 32);
  const availH = SVG_H - 24; // 12px top + bottom margin

  // Link heights proportional to area
  const linkH = flows.map((f) => Math.max((f.area_km2 / totalArea) * availH, 1));

  // Node heights = sum of link heights through that node
  const srcH = new Map<number, number>();
  const tgtH = new Map<number, number>();
  flows.forEach((f, i) => {
    srcH.set(f.from_code, (srcH.get(f.from_code) ?? 0) + linkH[i]);
    tgtH.set(f.to_code,   (tgtH.get(f.to_code)   ?? 0) + linkH[i]);
  });
  // Enforce minimum node height without distorting layout
  for (const [k, v] of srcH) srcH.set(k, Math.max(v, MIN_NODE_PX));
  for (const [k, v] of tgtH) tgtH.set(k, Math.max(v, MIN_NODE_PX));

  // Source node Y positions (vertically centred)
  const srcTotalH = srcCodes.reduce((s, c) => s + (srcH.get(c) ?? 0), 0)
    + (srcCodes.length - 1) * NODE_PAD;
  let srcStart = 12 + Math.max(0, (availH - srcTotalH) / 2);
  const srcY = new Map<number, number>();
  for (const c of srcCodes) { srcY.set(c, srcStart); srcStart += (srcH.get(c) ?? 0) + NODE_PAD; }

  // Target node Y positions
  const tgtTotalH = tgtCodes.reduce((s, c) => s + (tgtH.get(c) ?? 0), 0)
    + (tgtCodes.length - 1) * NODE_PAD;
  let tgtStart = 12 + Math.max(0, (availH - tgtTotalH) / 2);
  const tgtY = new Map<number, number>();
  for (const c of tgtCodes) { tgtY.set(c, tgtStart); tgtStart += (tgtH.get(c) ?? 0) + NODE_PAD; }

  // Draw links — cursor tracks how far into each node we've consumed
  const srcCursor = new Map(srcCodes.map((c) => [c, srcY.get(c) ?? 0]));
  const tgtCursor = new Map(tgtCodes.map((c) => [c, tgtY.get(c) ?? 0]));

  const linkElems = flows.map((f, i) => {
    const h   = linkH[i];
    const sx  = MARGIN_L + NODE_W;
    const tx  = SVG_W - MARGIN_R - NODE_W;
    const sy  = srcCursor.get(f.from_code) ?? 0;
    const ty  = tgtCursor.get(f.to_code)   ?? 0;
    const cpX = FLOW_W / 2.8;

    srcCursor.set(f.from_code, sy + h);
    tgtCursor.set(f.to_code,   ty + h);

    const d = [
      `M ${sx} ${sy}`,
      `C ${sx + cpX} ${sy}, ${tx - cpX} ${ty}, ${tx} ${ty}`,
      `L ${tx} ${ty + h}`,
      `C ${tx - cpX} ${ty + h}, ${sx + cpX} ${sy + h}, ${sx} ${sy + h}`,
      "Z",
    ].join(" ");

    const colour = resolveColor(f.from_code, customGroups);
    const srcLabel = resolveLabel(f.from_code, customGroups);
    const tgtLabel = resolveLabel(f.to_code, customGroups);

    return (
      <path
        key={i}
        d={d}
        fill={colour}
        fillOpacity={f.priority_flag ? 0.52 : 0.28}
        stroke={colour}
        strokeOpacity={0.25}
        strokeWidth={0.5}
        style={{ cursor: "pointer" }}
        onMouseEnter={() =>
          setHover({ label: `${srcLabel} → ${tgtLabel}`, area: f.area_km2, pct: f.pct_of_source })
        }
        onMouseLeave={() => setHover(null)}
      />
    );
  });

  // Node rectangles + labels
  const srcElems = srcCodes.map((code) => {
    const y = srcY.get(code) ?? 0;
    const h = srcH.get(code) ?? 0;
    const colour = resolveColor(code, customGroups);
    const label  = resolveLabel(code, customGroups);
    return (
      <g key={`src-${code}`}>
        <rect x={MARGIN_L} y={y} width={NODE_W} height={h} fill={colour} rx={3} />
        <text
          x={MARGIN_L - 7}
          y={y + h / 2}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={10}
          fill="#374151"
        >
          {label}
        </text>
      </g>
    );
  });

  const tgtElems = tgtCodes.map((code) => {
    const x = SVG_W - MARGIN_R - NODE_W;
    const y = tgtY.get(code) ?? 0;
    const h = tgtH.get(code) ?? 0;
    const colour = resolveColor(code, customGroups);
    const label  = resolveLabel(code, customGroups);
    return (
      <g key={`tgt-${code}`}>
        <rect x={x} y={y} width={NODE_W} height={h} fill={colour} rx={3} />
        <text
          x={x + NODE_W + 7}
          y={y + h / 2}
          textAnchor="start"
          dominantBaseline="middle"
          fontSize={10}
          fill="#374151"
        >
          {label}
        </text>
      </g>
    );
  });

  const totalChanged = flows.reduce((s, t) => s + t.area_km2, 0);
  const majorCount   = flows.filter((t) => t.priority_flag).length;

  const minor = change.transitions.filter(
    (t) => t.from_code !== t.to_code && t.area_km2 > 0 && t.area_km2 < 5,
  );
  const minorTotal = minor.reduce((s, t) => s + t.area_km2, 0);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Land Cover Transitions — {change.from_year} → {change.to_year}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Total area changed:{" "}
          {totalChanged.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
          {" · "}{majorCount} priority transitions
          {" · "} flows ≥ {MIN_FLOW_KM2} km² shown
        </p>
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-1.5 text-xs text-gray-700 w-fit">
          <span className="font-semibold">{hover.label}</span>
          {" — "}
          {hover.area.toLocaleString(undefined, { maximumFractionDigits: 1 })} km²
          {hover.pct != null && (
            <span className="text-gray-400 ml-1">({hover.pct.toFixed(1)}% of source)</span>
          )}
        </div>
      )}

      {/* SVG alluvial diagram */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full"
          style={{ height: SVG_H, maxHeight: 500 }}
          aria-label={`Alluvial diagram of land cover transitions from ${change.from_year} to ${change.to_year}`}
        >
          {/* Year column labels */}
          <text x={MARGIN_L + NODE_W / 2} y={9} textAnchor="middle"
                fontSize={9} fill="#9ca3af" fontWeight="700" letterSpacing="0.05em">
            {change.from_year}
          </text>
          <text x={SVG_W - MARGIN_R - NODE_W / 2} y={9} textAnchor="middle"
                fontSize={9} fill="#9ca3af" fontWeight="700" letterSpacing="0.05em">
            {change.to_year}
          </text>

          {/* Links drawn first so nodes appear on top */}
          {linkElems}
          {srcElems}
          {tgtElems}
        </svg>
      </div>

      {/* Major transitions table */}
      <div>
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Major transitions (≥ 5 km²)
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1 pr-3 font-semibold text-gray-500">From</th>
                <th className="text-left py-1 pr-3 font-semibold text-gray-500">To</th>
                <th className="text-right py-1 pr-3 font-semibold text-gray-500">Area km²</th>
                <th className="text-right py-1 font-semibold text-gray-500">% of Source</th>
              </tr>
            </thead>
            <tbody>
              {change.transitions
                .filter((t) => t.from_code !== t.to_code && t.area_km2 >= 5)
                .sort((a, b) => b.area_km2 - a.area_km2)
                .slice(0, 12)
                .map((t, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1 pr-3">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-sm shrink-0"
                          style={{ backgroundColor: resolveColor(t.from_code, customGroups) }}
                        />
                        {resolveLabel(t.from_code, customGroups)}
                      </span>
                    </td>
                    <td className="py-1 pr-3">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-sm shrink-0"
                          style={{ backgroundColor: resolveColor(t.to_code, customGroups) }}
                        />
                        {resolveLabel(t.to_code, customGroups)}
                      </span>
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-gray-700">
                      {t.area_km2.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                    <td
                      className={`py-1 text-right tabular-nums
                        ${t.priority_flag ? "text-amber-600 font-semibold" : "text-gray-500"}`}
                    >
                      {t.pct_of_source.toFixed(1)}%
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {minor.length > 0 && (
          <p className="text-[10px] text-gray-400 mt-1.5">
            + {minor.length} minor transitions totalling{" "}
            {minorTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} km² (each &lt; 5 km²)
          </p>
        )}
      </div>

      <p className="text-[10px] text-gray-400">
        Source: ICIMOD Nepal Land Cover · EPSG:32645 · Transitions computed at pixel level (30 m resolution)
      </p>
    </div>
  );
}
