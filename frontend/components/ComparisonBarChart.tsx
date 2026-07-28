"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { FOREST_CODES, FOREST_COLOUR, NON_FOREST_COLOUR } from "@/lib/constants";
import type { LandCoverStatistics } from "@/types/api";

interface Props {
  statistics: LandCoverStatistics[];
}

function agg(stat: LandCoverStatistics) {
  const valid = stat.classes.filter((c) => c.code !== 0 && c.area_km2 > 0);
  return {
    forest:    valid.filter((c) =>  FOREST_CODES.has(c.code)).reduce((s, c) => s + c.area_km2, 0),
    nonForest: valid.filter((c) => !FOREST_CODES.has(c.code)).reduce((s, c) => s + c.area_km2, 0),
  };
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const [base, latest] = payload;
  const delta = (latest?.value ?? 0) - (base?.value ?? 0);
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 text-xs min-w-[170px]">
      <p className="font-semibold text-gray-800 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
            <span className="text-gray-500">{p.name}</span>
          </div>
          <span className="tabular-nums font-medium text-gray-800">
            {(p.value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
          </span>
        </div>
      ))}
      {base && latest && (
        <div className={`mt-2 pt-2 border-t border-gray-100 text-xs font-semibold ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-gray-400"}`}>
          Net change: {delta > 0 ? "+" : ""}{delta.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
        </div>
      )}
    </div>
  );
}

const COLOURS = [FOREST_COLOUR, NON_FOREST_COLOUR];

export function ComparisonBarChart({ statistics }: Props) {
  if (statistics.length < 2) return null;

  const sorted = [...statistics].sort((a, b) => a.year - b.year);
  const baseYear   = sorted[0];
  const latestYear = sorted[sorted.length - 1];

  const base   = agg(baseYear);
  const latest = agg(latestYear);

  const data = [
    { name: "Forest Area",     [baseYear.year]: base.forest,    [latestYear.year]: latest.forest,    colour: FOREST_COLOUR },
    { name: "Non-Forest Area", [baseYear.year]: base.nonForest, [latestYear.year]: latest.nonForest, colour: NON_FOREST_COLOUR },
  ];

  const baseKey   = String(baseYear.year);
  const latestKey = String(latestYear.year);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Forest cover: {baseYear.year} vs {latestYear.year}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Top bar {baseYear.year} · bottom bar {latestYear.year} · hover to see net change
        </p>
      </div>

      <ResponsiveContainer width="100%" height={data.length * 72 + 64}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 56, left: 4, bottom: 4 }}
          barCategoryGap="24%"
          barGap={3}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
          <YAxis
            dataKey="name"
            type="category"
            tick={{ fontSize: 12, fill: "#4b5563" }}
            axisLine={false}
            tickLine={false}
            width={134}
          />
          <XAxis
            type="number"
            tick={{ fontSize: 12, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
            unit=" km²"
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 12, color: "#6b7280", paddingTop: 10 }}
            formatter={(value) => <span style={{ color: "#6b7280" }}>{value}</span>}
          />
          <Bar dataKey={baseKey} name={String(baseYear.year)} radius={[0, 3, 3, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.colour} fillOpacity={0.4} stroke={entry.colour} strokeWidth={1} />
            ))}
          </Bar>
          <Bar dataKey={latestKey} name={String(latestYear.year)} radius={[0, 3, 3, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={COLOURS[i]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-gray-400">
        Source: ICIMOD Nepal Land Cover · Equal-area projection EPSG:32645
      </p>
    </div>
  );
}
