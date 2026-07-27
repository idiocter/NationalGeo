"use client";

import { useMemo } from "react";
import { Sankey, Tooltip, ResponsiveContainer } from "recharts";

import { FOREST_CODES, FOREST_COLOUR, NON_FOREST_COLOUR } from "@/lib/constants";
import type { ChangeMatrix, CustomClassGroup } from "@/types/api";

interface Props {
  change: ChangeMatrix;
  customGroups?: CustomClassGroup[] | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomNode({ x, y, width, height, payload }: any) {
  if (height <= 0) return null;
  const { color, label, side } = payload;
  const isSource = side === "source";
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 2)} fill={color} rx={3} />
      <text
        x={isSource ? x + width + 6 : x - 6}
        y={y + height / 2}
        textAnchor={isSource ? "start" : "end"}
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
  return (
    <path
      d={d}
      fill={payload?.sourceColor ?? "#94a3b8"}
      fillOpacity={0.45}
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
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 text-xs min-w-[180px]">
        <p className="font-semibold text-gray-800 mb-1">{d.sourceLabel} → {d.targetLabel}</p>
        <p className="text-gray-600">{d.area_km2?.toLocaleString(undefined, { maximumFractionDigits: 1 })} km²</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 text-xs">
      <p className="font-semibold text-gray-800">{d.label}</p>
      {d.total_km2 != null && (
        <p className="text-gray-600">{d.total_km2.toLocaleString(undefined, { maximumFractionDigits: 1 })} km² total</p>
      )}
    </div>
  );
}

export function AlluvialChart({ change }: Props) {
  const { nodes, links, forestLoss, forestGain } = useMemo(() => {
    // Aggregate transitions into binary forest/non-forest flows
    let forestToForest    = 0;
    let forestToNon       = 0; // forest loss
    let nonToForest       = 0; // forest gain
    let nonToNon          = 0;

    for (const t of change.transitions) {
      if (t.from_code === t.to_code) continue;
      const fromForest = FOREST_CODES.has(t.from_code);
      const toForest   = FOREST_CODES.has(t.to_code);
      if (fromForest && toForest)   forestToForest += t.area_km2;
      else if (fromForest)          forestToNon    += t.area_km2;
      else if (toForest)            nonToForest    += t.area_km2;
      else                          nonToNon       += t.area_km2;
    }

    // Nodes: [0] Forest from, [1] Non-Forest from, [2] Forest to, [3] Non-Forest to
    const allNodes = [
      { name: `Forest (${change.from_year})`,     label: "Forest Area",     color: FOREST_COLOUR,     side: "source" },
      { name: `Non-Forest (${change.from_year})`, label: "Non-Forest Area", color: NON_FOREST_COLOUR, side: "source" },
      { name: `Forest (${change.to_year})`,       label: "Forest Area",     color: FOREST_COLOUR,     side: "target" },
      { name: `Non-Forest (${change.to_year})`,   label: "Non-Forest Area", color: NON_FOREST_COLOUR, side: "target" },
    ];

    const sankeyLinks = [];
    if (forestToForest > 0.01) sankeyLinks.push({ source: 0, target: 2, value: forestToForest, area_km2: forestToForest, sourceLabel: "Forest Area",     targetLabel: "Forest Area",     sourceColor: FOREST_COLOUR });
    if (forestToNon    > 0.01) sankeyLinks.push({ source: 0, target: 3, value: forestToNon,    area_km2: forestToNon,    sourceLabel: "Forest Area",     targetLabel: "Non-Forest Area", sourceColor: FOREST_COLOUR });
    if (nonToForest    > 0.01) sankeyLinks.push({ source: 1, target: 2, value: nonToForest,    area_km2: nonToForest,    sourceLabel: "Non-Forest Area", targetLabel: "Forest Area",     sourceColor: NON_FOREST_COLOUR });
    if (nonToNon       > 0.01) sankeyLinks.push({ source: 1, target: 3, value: nonToNon,       area_km2: nonToNon,       sourceLabel: "Non-Forest Area", targetLabel: "Non-Forest Area", sourceColor: NON_FOREST_COLOUR });

    return { nodes: allNodes, links: sankeyLinks, forestLoss: forestToNon, forestGain: nonToForest };
  }, [change]);

  if (links.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">
          Forest Transitions ({change.from_year} → {change.to_year})
        </h3>
        <p className="text-xs text-gray-400">No significant transitions detected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Forest Transitions — {change.from_year} → {change.to_year}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          <span className="text-red-500">Forest loss: {forestLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</span>
          {" · "}
          <span className="text-emerald-600">Forest gain: {forestGain.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</span>
        </p>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <Sankey
          data={{ nodes, links }}
          nodePadding={16}
          nodeWidth={14}
          iterations={0}
          node={<CustomNode />}
          link={<CustomLink />}
          margin={{ top: 8, right: 130, left: 130, bottom: 8 }}
        >
          <Tooltip content={<CustomTooltip />} />
        </Sankey>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-red-50 border border-red-100 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-0.5">Forest Lost</p>
          <p className="text-sm font-bold text-red-700 tabular-nums">
            {forestLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
          </p>
          <p className="text-[10px] text-red-400">converted to non-forest</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide mb-0.5">Forest Gained</p>
          <p className="text-sm font-bold text-emerald-700 tabular-nums">
            {forestGain.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
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
