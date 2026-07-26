"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import type { ChangeMatrix } from "@/types/api";

interface Props {
  change: ChangeMatrix;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 text-xs min-w-[160px]">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {[...payload]
        .sort((a, b) => b.value - a.value)
        .filter((p) => p.value > 0.01)
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

export function ChangeChart({ change }: Props) {
  if (!change.trend_series.length) return null;

  const data = change.trend_series.map((point) => {
    const row: Record<string, number | string> = { year: point.year };
    for (const cls of point.classes) {
      if (cls.code === 0) continue;
      row[CLASS_NAMES[cls.code] ?? `Class${cls.code}`] = parseFloat(cls.area_km2.toFixed(2));
    }
    return row;
  });

  const classKeys = (change.trend_series[0]?.classes ?? [])
    .filter((c) => c.code !== 0)
    .map((c) => CLASS_NAMES[c.code] ?? `Class${c.code}`);

  // Dominant class = largest area in most recent point
  const lastPoint = change.trend_series[change.trend_series.length - 1];
  const dominant  = lastPoint?.classes
    .filter((c) => c.code !== 0)
    .sort((a, b) => b.area_km2 - a.area_km2)[0];
  const dominantName = dominant ? (CLASS_NAMES[dominant.code] ?? `Class${dominant.code}`) : null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Land cover composition over time
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          {change.from_year}–{change.to_year} · stacked area shows how each type fills the total land area
          {dominantName && <> · dominant type: <span className="text-gray-600">{dominantName}</span></>}
        </p>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
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
            iconType="square"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: "#6b7280" }}
          />
          {classKeys.map((key) => {
            const code   = Object.entries(CLASS_NAMES).find(([, v]) => v === key)?.[0];
            const colour = CLASS_COLOURS[Number(code)] ?? "#8884d8";
            return (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="1"
                stroke={colour}
                fill={colour}
                fillOpacity={0.82}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>

      {change.confidence_note && (
        <p className="text-[10px] text-gray-400">{change.confidence_note}</p>
      )}
    </div>
  );
}
