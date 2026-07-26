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

import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import type { LandCoverStatistics } from "@/types/api";

interface Props {
  statistics: LandCoverStatistics[];
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 text-xs min-w-[190px]">
      <p className="font-semibold text-gray-800 mb-2">{label} — change from base year</p>
      {sorted
        .filter((p) => Math.abs(p.value) > 0.01)
        .map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-3 mb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
              <span className="text-gray-600 truncate max-w-[100px]">{p.name}</span>
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
  const baseYear = sorted[0];

  const baseByCode = Object.fromEntries(
    baseYear.classes.map((c) => [c.code, c.area_km2])
  );

  const allCodes = Array.from(
    new Set(sorted.flatMap((s) => s.classes.map((c) => c.code).filter((c) => c !== 0)))
  ).sort((a, b) => a - b);

  // Build delta data: each point = km² change from base year
  const data = sorted.map((stat) => {
    const row: Record<string, number | string> = { year: stat.year };
    const byCode = Object.fromEntries(stat.classes.map((c) => [c.code, c.area_km2]));
    for (const code of allCodes) {
      const base = baseByCode[code] ?? 0;
      row[CLASS_NAMES[code] ?? `Class${code}`] = (byCode[code] ?? 0) - base;
    }
    return row;
  });

  // Filter to classes with meaningful change (|max delta| > 1 km²)
  const significantCodes = allCodes.filter((code) => {
    const key = CLASS_NAMES[code] ?? `Class${code}`;
    const maxDelta = Math.max(...data.map((d) => Math.abs((d[key] as number) ?? 0)));
    return maxDelta > 1;
  });

  // Find most-changed class for annotation
  let biggestGain = { name: "", delta: 0 };
  let biggestLoss = { name: "", delta: 0 };
  for (const code of significantCodes) {
    const key   = CLASS_NAMES[code] ?? `Class${code}`;
    const last  = (data[data.length - 1]?.[key] as number) ?? 0;
    if (last > biggestGain.delta) biggestGain = { name: key, delta: last };
    if (last < biggestLoss.delta) biggestLoss = { name: key, delta: last };
  }

  const classKeys = significantCodes.map((code) => CLASS_NAMES[code] ?? `Class${code}`);
  const y0 = sorted[0].year;
  const y1 = sorted[sorted.length - 1].year;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Gain & loss from base year ({y0})
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Lines above zero = land gained · below zero = land lost · {y0}–{y1}
          {biggestGain.name && (
            <> · <span className="text-emerald-600">biggest gain: {biggestGain.name} +{biggestGain.delta.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</span></>
          )}
          {biggestLoss.name && (
            <> · <span className="text-red-500">biggest loss: {biggestLoss.name} {biggestLoss.delta.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</span></>
          )}
        </p>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => v >= 1000 || v <= -1000
              ? `${(v / 1000).toFixed(0)}k`
              : String(v)}
            unit=" km²"
            width={62}
          />
          {/* Zero reference line — prominent */}
          <ReferenceLine
            y={0}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            label={{ value: "no change", position: "insideTopRight", fontSize: 9, fill: "#94a3b8" }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 11, color: "#6b7280" }}
          />
          {classKeys.map((key) => {
            const code    = significantCodes[classKeys.indexOf(key)];
            const colour  = CLASS_COLOURS[code] ?? "#8884d8";
            const lastVal = (data[data.length - 1]?.[key] as number) ?? 0;
            const isMain  = key === biggestGain.name || key === biggestLoss.name;
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colour}
                strokeWidth={isMain ? 2.5 : 1.5}
                strokeOpacity={isMain ? 1 : lastVal === 0 ? 0.3 : 0.75}
                dot={{ r: isMain ? 4 : 2.5, fill: colour, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-gray-400">
        Source: ICIMOD Nepal Land Cover · Projection: EPSG:32645 · All values relative to {y0} baseline
      </p>
    </div>
  );
}
