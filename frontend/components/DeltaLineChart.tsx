"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
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
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 text-xs min-w-[190px]">
      <p className="font-semibold text-gray-800 mb-2">{label} — change from base year</p>
      {[...payload].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3 mb-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
            <span className="text-gray-600">{p.name}</span>
          </div>
          <span className={`tabular-nums font-semibold ${p.value > 0 ? "text-emerald-600" : p.value < 0 ? "text-red-500" : "text-gray-400"}`}>
            {p.value > 0 ? "+" : ""}{p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
          </span>
        </div>
      ))}
    </div>
  );
}

export function DeltaLineChart({ statistics }: Props) {
  if (statistics.length < 2) return null;

  const sorted = [...statistics].sort((a, b) => a.year - b.year);
  const base = agg(sorted[0]);

  const data = sorted.map((s) => {
    const { forest, nonForest } = agg(s);
    return {
      year: s.year,
      "Forest Area":     forest    - base.forest,
      "Non-Forest Area": nonForest - base.nonForest,
    };
  });

  const lastForestDelta    = (data[data.length - 1]["Forest Area"]     as number) ?? 0;
  const lastNonForestDelta = (data[data.length - 1]["Non-Forest Area"] as number) ?? 0;
  const y0 = sorted[0].year;
  const y1 = sorted[sorted.length - 1].year;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Forest gain & loss from {y0}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Above zero = gained · below zero = lost · {y0}–{y1}
          {lastForestDelta !== 0 && (
            <> · <span className={lastForestDelta > 0 ? "text-emerald-600" : "text-red-500"}>
              Forest {lastForestDelta > 0 ? "+" : ""}{lastForestDelta.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
            </span></>
          )}
        </p>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false} tickLine={false}
            tickFormatter={(v) => v >= 1000 || v <= -1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
            unit=" km²"
            width={62}
          />
          <ReferenceLine
            y={0}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            label={{ value: "no change", position: "insideTopRight", fontSize: 9, fill: "#94a3b8" }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: "#6b7280" }} />
          <Line
            type="monotone"
            dataKey="Forest Area"
            stroke={FOREST_COLOUR}
            strokeWidth={lastForestDelta !== 0 ? 2.5 : 1.5}
            dot={{ r: 4, fill: FOREST_COLOUR, strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
          <Line
            type="monotone"
            dataKey="Non-Forest Area"
            stroke={NON_FOREST_COLOUR}
            strokeWidth={lastNonForestDelta !== 0 ? 2.5 : 1.5}
            dot={{ r: 4, fill: NON_FOREST_COLOUR, strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-gray-400">
        Source: ICIMOD Nepal Land Cover · Projection: EPSG:32645 · All values relative to {y0} baseline
      </p>
    </div>
  );
}
