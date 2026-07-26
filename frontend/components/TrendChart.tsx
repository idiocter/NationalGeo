"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import type { LandCoverStatistics } from "@/types/api";

interface Props {
  statistics: LandCoverStatistics[];
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 text-xs min-w-[160px]">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload
        .filter((p) => p.value > 0.01)
        .sort((a, b) => b.value - a.value)
        .map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-3 mb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
              <span className="text-gray-600 truncate max-w-[90px]">{p.name}</span>
            </div>
            <span className="tabular-nums text-gray-800 font-medium">
              {p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
              {total > 0 && (
                <span className="text-gray-400 font-normal">
                  {" "}({((p.value / total) * 100).toFixed(0)}%)
                </span>
              )}
            </span>
          </div>
        ))}
    </div>
  );
}

export function TrendChart({ statistics }: Props) {
  if (statistics.length < 2) return null;

  const sorted = [...statistics].sort((a, b) => a.year - b.year);

  const allCodes = Array.from(
    new Set(sorted.flatMap((s) => s.classes.map((c) => c.code).filter((c) => c !== 0)))
  ).sort((a, b) => a - b);

  const data = sorted.map((stat) => {
    const row: Record<string, number | string> = { year: stat.year };
    const byCode = Object.fromEntries(stat.classes.map((c) => [c.code, c.area_km2]));
    for (const code of allCodes) {
      row[CLASS_NAMES[code] ?? `Class${code}`] = byCode[code] ?? 0;
    }
    return row;
  });

  // Find the class with largest absolute change for annotation
  let biggestChange = { name: "", delta: 0 };
  for (const code of allCodes) {
    const key   = CLASS_NAMES[code] ?? `Class${code}`;
    const first = (data[0]?.[key] as number) ?? 0;
    const last  = (data[data.length - 1]?.[key] as number) ?? 0;
    const delta = last - first;
    if (Math.abs(delta) > Math.abs(biggestChange.delta)) {
      biggestChange = { name: key, delta };
    }
  }

  const classKeys = allCodes.map((code) => CLASS_NAMES[code] ?? `Class${code}`);
  const y0 = sorted[0].year;
  const y1 = sorted[sorted.length - 1].year;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Area covered by each land type, year by year
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          {y0}–{y1} · hover a point to see exact values and share of total
          {biggestChange.name && (
            <> · biggest change: <span className={biggestChange.delta > 0 ? "text-emerald-600" : "text-red-500"}>
              {biggestChange.name} {biggestChange.delta > 0 ? "+" : ""}
              {biggestChange.delta.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
            </span></>
          )}
        </p>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false} tickLine={false}
            tickFormatter={(v) => `${(v / 1000).toFixed(v >= 1000 ? 0 : 1)}k`}
            unit=" km²"
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 11, color: "#6b7280" }}
          />
          {classKeys.map((key) => {
            const code   = allCodes[classKeys.indexOf(key)];
            const colour = CLASS_COLOURS[code] ?? "#8884d8";
            const isMain = biggestChange.name === key;
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colour}
                strokeWidth={isMain ? 2.5 : 1.5}
                strokeOpacity={isMain ? 1 : 0.7}
                dot={{ r: isMain ? 4 : 2.5, fill: colour, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-gray-400">
        Source: ICIMOD Nepal Land Cover · Projection: EPSG:32645 · 5-year composite imagery
      </p>
    </div>
  );
}
