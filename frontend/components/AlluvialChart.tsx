"use client";

import { useMemo } from "react";
import { Sankey, Tooltip, ResponsiveContainer } from "recharts";

import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import type { ChangeMatrix, CustomClassGroup } from "@/types/api";

interface Props {
  change: ChangeMatrix;
  customGroups?: CustomClassGroup[] | null;
}

const MIN_AREA_KM2 = 0.5; // filter out very trivial transitions

function resolveLabel(code: number, customGroups?: CustomClassGroup[] | null): string {
  if (customGroups) {
    const grp = customGroups.find((g) => g.codes.includes(code));
    if (grp) return grp.name;
  }
  return CLASS_NAMES[code] ?? `Class ${code}`;
}

function resolveColor(code: number, customGroups?: CustomClassGroup[] | null): string {
  if (customGroups) {
    const grp = customGroups.find((g) => g.codes.includes(code));
    if (grp) return grp.color;
  }
  return CLASS_COLOURS[code] ?? "#999";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomNode({ x, y, width, height, payload }: any) {
  if (height <= 0) return null;
  const { color, label } = payload;
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 2)} fill={color} rx={3} />
      <text
        x={x < 100 ? x + width + 6 : x - 6}
        y={y + height / 2}
        textAnchor={x < 100 ? "start" : "end"}
        dominantBaseline="middle"
        fontSize={10}
        fill="#374151"
      >
        {label}
      </text>
    </g>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomLink({ sourceX, targetX, sourceY, sourceControlX, targetControlX, targetY, linkWidth, payload }: any) {
  if (linkWidth <= 0) return null;
  const d = `
    M${sourceX},${sourceY + linkWidth / 2}
    C${sourceControlX},${sourceY + linkWidth / 2}
     ${targetControlX},${targetY + linkWidth / 2}
     ${targetX},${targetY + linkWidth / 2}
    L${targetX},${targetY - linkWidth / 2}
    C${targetControlX},${targetY - linkWidth / 2}
     ${sourceControlX},${sourceY - linkWidth / 2}
     ${sourceX},${sourceY - linkWidth / 2}
    Z
  `;
  const isMajor = payload?.priority_flag;
  return (
    <path
      d={d}
      fill={payload?.sourceColor ?? "#94a3b8"}
      fillOpacity={isMajor ? 0.55 : 0.28}
      stroke={payload?.sourceColor ?? "#94a3b8"}
      strokeOpacity={0.3}
      strokeWidth={0.5}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  if (d.sourceLabel) {
    // link
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 text-xs min-w-[180px]">
        <p className="font-semibold text-gray-800 mb-1">{d.sourceLabel} → {d.targetLabel}</p>
        <p className="text-gray-600">{d.area_km2?.toLocaleString(undefined, { maximumFractionDigits: 1 })} km²</p>
        {d.pct_of_source != null && (
          <p className="text-gray-400">{d.pct_of_source.toFixed(1)}% of source class</p>
        )}
        {d.priority_flag && (
          <p className="text-amber-600 mt-1 font-medium">Priority transition</p>
        )}
      </div>
    );
  }
  // node
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 text-xs">
      <p className="font-semibold text-gray-800">{d.label}</p>
      {d.total_km2 != null && (
        <p className="text-gray-600">{d.total_km2.toLocaleString(undefined, { maximumFractionDigits: 1 })} km² total</p>
      )}
    </div>
  );
}

export function AlluvialChart({ change, customGroups }: Props) {
  const { nodes, links } = useMemo(() => {
    const transitions = change.transitions
      .filter((t) => t.from_code !== t.to_code && t.area_km2 >= MIN_AREA_KM2)
      .sort((a, b) => b.area_km2 - a.area_km2);

    if (transitions.length === 0) return { nodes: [], links: [] };

    const fromCodes = [...new Set(transitions.map((t) => t.from_code))].sort();
    const toCodes   = [...new Set(transitions.map((t) => t.to_code))].sort();

    // Deduplicate codes that appear on both sides
    const sourceNodes = fromCodes.map((code) => ({
      name: `${resolveLabel(code, customGroups)} (${change.from_year})`,
      label: resolveLabel(code, customGroups),
      color: resolveColor(code, customGroups),
      code,
      side: "source" as const,
    }));

    const targetNodes = toCodes.map((code) => ({
      name: `${resolveLabel(code, customGroups)} (${change.to_year})`,
      label: resolveLabel(code, customGroups),
      color: resolveColor(code, customGroups),
      code,
      side: "target" as const,
    }));

    const allNodes = [...sourceNodes, ...targetNodes];
    const sourceOffset = 0;
    const targetOffset = sourceNodes.length;

    const sankeyLinks = transitions.map((t) => {
      const srcIdx = fromCodes.indexOf(t.from_code) + sourceOffset;
      const tgtIdx = toCodes.indexOf(t.to_code) + targetOffset;
      return {
        source: srcIdx,
        target: tgtIdx,
        value: Math.max(t.area_km2, 0.01),
        area_km2: t.area_km2,
        pct_of_source: t.pct_of_source,
        priority_flag: t.priority_flag,
        sourceLabel: resolveLabel(t.from_code, customGroups),
        targetLabel: resolveLabel(t.to_code, customGroups),
        sourceColor: resolveColor(t.from_code, customGroups),
      };
    });

    return { nodes: allNodes, links: sankeyLinks };
  }, [change, customGroups]);

  const majorCount = change.transitions.filter((t) => t.priority_flag && t.from_code !== t.to_code).length;
  const totalChanged = change.transitions
    .filter((t) => t.from_code !== t.to_code)
    .reduce((s, t) => s + t.area_km2, 0);

  if (nodes.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">Land Cover Transitions ({change.from_year} → {change.to_year})</h3>
        <p className="text-xs text-gray-400">No significant transitions detected above {MIN_AREA_KM2} km².</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Land Cover Transitions — {change.from_year} → {change.to_year}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Total area changed: {totalChanged.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
          {" · "}{majorCount} priority transitions
          {" · "} flows ≥ {MIN_AREA_KM2} km² shown
        </p>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(260, nodes.length * 22)}>
        <Sankey
          data={{ nodes, links }}
          nodePadding={8}
          nodeWidth={14}
          iterations={64}
          node={<CustomNode />}
          link={<CustomLink />}
          margin={{ top: 8, right: 120, left: 120, bottom: 8 }}
        >
          <Tooltip content={<CustomTooltip />} />
        </Sankey>
      </ResponsiveContainer>

      {/* CSV-style data table for major transitions */}
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
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: resolveColor(t.from_code, customGroups) }} />
                        {resolveLabel(t.from_code, customGroups)}
                      </span>
                    </td>
                    <td className="py-1 pr-3">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: resolveColor(t.to_code, customGroups) }} />
                        {resolveLabel(t.to_code, customGroups)}
                      </span>
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-gray-700">
                      {t.area_km2.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                    <td className={`py-1 text-right tabular-nums ${t.priority_flag ? "text-amber-600 font-semibold" : "text-gray-500"}`}>
                      {t.pct_of_source.toFixed(1)}%
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Minor transitions summary */}
        {(() => {
          const minor = change.transitions.filter((t) => t.from_code !== t.to_code && t.area_km2 > 0 && t.area_km2 < 5);
          if (!minor.length) return null;
          const minorTotal = minor.reduce((s, t) => s + t.area_km2, 0);
          return (
            <p className="text-[10px] text-gray-400 mt-1.5">
              + {minor.length} minor transitions totalling {minorTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} km² (each &lt; 5 km²)
            </p>
          );
        })()}
      </div>

      <p className="text-[10px] text-gray-400">
        Source: ICIMOD Nepal Land Cover · EPSG:32645 · Transitions computed at pixel level (30 m resolution)
      </p>
    </div>
  );
}
