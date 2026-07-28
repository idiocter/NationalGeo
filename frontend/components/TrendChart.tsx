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

// A class is "major" if it ever exceeds this share of total valid area in any year
const MAJOR_THRESHOLD_PCT = 5;
const OTHERS_KEY = "Others";
const OTHERS_COLOUR = "#b0b0b0";

interface Props {
  statistics: LandCoverStatistics[];
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-md p-3 text-xs min-w-[170px]">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {[...payload]
        .filter((p) => (p.value ?? 0) > 0.01)
        .sort((a, b) => b.value - a.value)
        .map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-3 mb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
              <span className="text-gray-600 truncate max-w-[100px]">{p.name}</span>
            </div>
            <span className="tabular-nums text-gray-800 font-medium whitespace-nowrap">
              {p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
            </span>
          </div>
        ))}
    </div>
  );
}

export function TrendChart({ statistics }: Props) {
  if (statistics.length < 2) return null;

  const sorted = [...statistics].sort((a, b) => a.year - b.year);

  // Collect all non-nodata codes present in any year
  const allCodes = Array.from(
    new Set(sorted.flatMap((s) => s.classes.map((c) => c.code).filter((c) => c !== 0)))
  ).sort((a, b) => a - b);

  // Determine major codes: ever ≥ MAJOR_THRESHOLD_PCT share of total in any year
  const majorCodes = new Set<number>();
  for (const stat of sorted) {
    const total = stat.classes.filter((c) => c.code !== 0).reduce((s, c) => s + c.area_km2, 0);
    if (total <= 0) continue;
    for (const cls of stat.classes) {
      if (cls.code === 0) continue;
      if ((cls.area_km2 / total) * 100 >= MAJOR_THRESHOLD_PCT) majorCodes.add(cls.code);
    }
  }
  const minorCodes = allCodes.filter((c) => !majorCodes.has(c));

  // Build chart rows
  const data = sorted.map((stat) => {
    const byCode = Object.fromEntries(stat.classes.map((c) => [c.code, c.area_km2]));
    const row: Record<string, number | string> = { year: stat.year };
    for (const code of majorCodes) {
      row[CLASS_NAMES[code] ?? `Class${code}`] = byCode[code] ?? 0;
    }
    const othersArea = minorCodes.reduce((s, c) => s + (byCode[c] ?? 0), 0);
    if (minorCodes.length > 0) row[OTHERS_KEY] = othersArea;
    return row;
  });

  // Biggest absolute change across major lines only
  let biggestChange = { name: "", delta: 0 };
  for (const code of majorCodes) {
    const key   = CLASS_NAMES[code] ?? `Class${code}`;
    const first = (data[0]?.[key] as number) ?? 0;
    const last  = (data[data.length - 1]?.[key] as number) ?? 0;
    const delta = last - first;
    if (Math.abs(delta) > Math.abs(biggestChange.delta)) biggestChange = { name: key, delta };
  }

  // Sort major codes by total area descending (so legend order feels natural)
  const majorCodesSorted = [...majorCodes].sort((a, b) => {
    const sumA = sorted.reduce((s, st) => s + (st.classes.find((c) => c.code === a)?.area_km2 ?? 0), 0);
    const sumB = sorted.reduce((s, st) => s + (st.classes.find((c) => c.code === b)?.area_km2 ?? 0), 0);
    return sumB - sumA;
  });

  const y0 = sorted[0].year;
  const y1 = sorted[sorted.length - 1].year;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          Land cover area trend · {y0}–{y1}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          <span className="font-medium text-gray-600">
            {majorCodes.size} major class{majorCodes.size !== 1 ? "es" : ""}
          </span>{" "}
          (≥{MAJOR_THRESHOLD_PCT}% share — individual lines)
          {minorCodes.length > 0 && (
            <> · <span className="font-medium text-gray-500">{minorCodes.length} minor</span> grouped as dashed "Others"</>
          )}
          {biggestChange.name && (
            <> · biggest change:{" "}
              <span className={biggestChange.delta > 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                {biggestChange.name} {biggestChange.delta > 0 ? "+" : ""}
                {biggestChange.delta.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
              </span>
            </>
          )}
        </p>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false} tickLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
            unit=" km²"
            width={62}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 11, color: "#6b7280", paddingTop: 8 }}
          />

          {/* Major class lines — solid, thicker, vivid */}
          {majorCodesSorted.map((code) => {
            const key    = CLASS_NAMES[code] ?? `Class${code}`;
            const colour = CLASS_COLOURS[code] ?? "#8884d8";
            const isTop  = biggestChange.name === key;
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colour}
                strokeWidth={isTop ? 3 : 2}
                dot={{ r: isTop ? 4.5 : 3, fill: colour, strokeWidth: 0 }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
            );
          })}

          {/* Others — dashed grey, thin, stays at the bottom visually */}
          {minorCodes.length > 0 && (
            <Line
              type="monotone"
              dataKey={OTHERS_KEY}
              stroke={OTHERS_COLOUR}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={{ r: 2.5, fill: OTHERS_COLOUR, strokeWidth: 0 }}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Minor classes detail table */}
      {minorCodes.length > 0 && (
        <details className="mt-2">
          <summary className="text-[10px] text-blue-500 cursor-pointer select-none hover:text-blue-700">
            Minor classes breakdown ({minorCodes.length} classes — click to expand)
          </summary>
          <div className="mt-1.5 overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-[10px] text-gray-600 border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-2 py-1 font-medium text-gray-500">Class</th>
                  {sorted.map((s) => (
                    <th key={s.year} className="text-right px-2 py-1 font-medium text-gray-500 tabular-nums">
                      {s.year}
                    </th>
                  ))}
                  <th className="text-right px-2 py-1 font-medium text-gray-500">Δ km²</th>
                </tr>
              </thead>
              <tbody>
                {minorCodes.map((code, i) => {
                  const yearVals = sorted.map((s) => {
                    const found = s.classes.find((c) => c.code === code);
                    return found?.area_km2 ?? 0;
                  });
                  const delta = yearVals[yearVals.length - 1] - yearVals[0];
                  return (
                    <tr key={code} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                      <td className="px-2 py-0.5 flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-sm shrink-0"
                          style={{ backgroundColor: CLASS_COLOURS[code] ?? "#ccc" }}
                        />
                        {CLASS_NAMES[code] ?? `Class ${code}`}
                      </td>
                      {yearVals.map((v, j) => (
                        <td key={j} className="text-right px-2 py-0.5 tabular-nums">
                          {v > 0 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                        </td>
                      ))}
                      <td className={`text-right px-2 py-0.5 tabular-nums font-medium
                                     ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-gray-400"}`}>
                        {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="text-[10px] text-gray-400">
        Source: ICIMOD Nepal Land Cover · Projection: EPSG:32645 · 5-year composite imagery
      </p>
    </div>
  );
}
