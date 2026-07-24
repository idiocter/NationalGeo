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

export function TrendChart({ statistics }: Props) {
  if (statistics.length < 2) return null;

  const sorted = [...statistics].sort((a, b) => a.year - b.year);

  // Collect all class codes across all years
  const allCodes = Array.from(
    new Set(sorted.flatMap((s) => s.classes.map((c) => c.code)))
  ).sort((a, b) => a - b);

  // Build recharts data: [{year: 2000, "Forest": 72396, ...}, ...]
  const data = sorted.map((stat) => {
    const row: Record<string, number | string> = { year: stat.year };
    const byCode = Object.fromEntries(stat.classes.map((c) => [c.code, c.area_km2]));
    for (const code of allCodes) {
      row[CLASS_NAMES[code] ?? `Class${code}`] = byCode[code] ?? 0;
    }
    return row;
  });

  const classKeys = allCodes.map((code) => CLASS_NAMES[code] ?? `Class${code}`);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">
        Land cover trend — {sorted[0].year}–{sorted[sorted.length - 1].year}
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit=" km²" width={72} />
          <Tooltip
            formatter={(val, name) => [
              typeof val === "number"
                ? `${val.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`
                : String(val ?? ""),
              String(name),
            ]}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          {classKeys.map((key) => {
            const code = allCodes[classKeys.indexOf(key)];
            const colour = CLASS_COLOURS[code] ?? "#8884d8";
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colour}
                strokeWidth={2}
                dot={{ r: 3, fill: colour }}
                activeDot={{ r: 5 }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-400">
        ICIMOD 11-class system · Projection: EPSG:32645 · 5-year composite
      </p>
    </div>
  );
}
