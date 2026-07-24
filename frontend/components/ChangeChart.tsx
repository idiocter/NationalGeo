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

export function ChangeChart({ change }: Props) {
  if (!change.trend_series.length) return null;

  // Build recharts data: [{year: 2000, Forest: 371, Agriculture: 120, ...}, ...]
  const data = change.trend_series.map((point) => {
    const row: Record<string, number | string> = { year: point.year };
    for (const cls of point.classes) {
      row[CLASS_NAMES[cls.code] ?? `Class${cls.code}`] = parseFloat(cls.area_km2.toFixed(2));
    }
    return row;
  });

  const classKeys = change.trend_series[0]?.classes.map(
    (c) => CLASS_NAMES[c.code] ?? `Class${c.code}`
  ) ?? [];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">
        Land cover trend — {change.from_year}–{change.to_year}
      </h3>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit=" km²" />
          <Tooltip
            formatter={(val, name) => [
              typeof val === "number" ? `${val.toLocaleString()} km²` : String(val ?? ""),
              String(name),
            ]}
          />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          {classKeys.map((key) => {
            const code = Object.entries(CLASS_NAMES).find(([, v]) => v === key)?.[0];
            const colour = CLASS_COLOURS[Number(code)] ?? "#8884d8";
            return (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="1"
                stroke={colour}
                fill={colour}
                fillOpacity={0.85}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-400">{change.confidence_note}</p>
    </div>
  );
}
