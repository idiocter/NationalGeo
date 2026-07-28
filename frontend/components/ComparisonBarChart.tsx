"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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

export function ComparisonBarChart({ statistics }: Props) {
  if (statistics.length < 2) return null;

  const sorted = [...statistics].sort((a, b) => a.year - b.year);
  const baseYear   = sorted[0];
  const latestYear = sorted[sorted.length - 1];

  const baseCodes   = new Set(baseYear.classes.filter((c) => c.code !== 0).map((c) => c.code));
  const latestCodes = new Set(latestYear.classes.filter((c) => c.code !== 0).map((c) => c.code));
  const allCodes    = Array.from(new Set([...baseCodes, ...latestCodes])).sort((a, b) => a - b);

  const baseByCode   = Object.fromEntries(baseYear.classes.map((c) => [c.code, c.area_km2]));
  const latestByCode = Object.fromEntries(latestYear.classes.map((c) => [c.code, c.area_km2]));

  const data = allCodes
    .filter((code) => {
      const b = baseByCode[code] ?? 0;
      const l = latestByCode[code] ?? 0;
      return Math.max(b, l) > 0.5; // filter trivial classes
    })
    .map((code) => ({
      name: CLASS_NAMES[code] ?? `Class ${code}`,
      code,
      [baseYear.year]:   baseByCode[code]   ?? 0,
      [latestYear.year]: latestByCode[code] ?? 0,
    }));

  const baseKey   = String(baseYear.year);
  const latestKey = String(latestYear.year);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Land cover comparison: {baseYear.year} vs {latestYear.year}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Top bar {baseYear.year} · bottom bar {latestYear.year} · hover to see net change
        </p>
      </div>

      <ResponsiveContainer width="100%" height={data.length * 60 + 56}>
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
          {/* Base year — muted (45% opacity) */}
          <Bar dataKey={baseKey} name={String(baseYear.year)} radius={[0, 3, 3, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.code}
                fill={hexToRgba(CLASS_COLOURS[entry.code] ?? "#8884d8", 0.45)}
                stroke={CLASS_COLOURS[entry.code] ?? "#8884d8"}
                strokeWidth={1}
              />
            ))}
          </Bar>

          {/* Latest year — full colour */}
          <Bar dataKey={latestKey} name={String(latestYear.year)} radius={[0, 3, 3, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.code}
                fill={CLASS_COLOURS[entry.code] ?? "#8884d8"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Custom legend — the year is encoded by shade: the base year is muted
          (~45% opacity) and the latest year is full colour, across every class colour.
          Rendered as plain JSX so the swatches are guaranteed to differ. */}
      <div className="flex items-center justify-center gap-5 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm border border-black/10"
                style={{ background: "#6b7280", opacity: 0.45 }} />
          {baseYear.year} <span className="text-gray-400">(muted)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm"
                style={{ background: "#6b7280" }} />
          {latestYear.year} <span className="text-gray-400">(full colour)</span>
        </span>
      </div>

      <p className="text-[10px] text-gray-400">
        Source: ICIMOD Nepal Land Cover · Equal-area projection EPSG:32645
      </p>
    </div>
  );
}
