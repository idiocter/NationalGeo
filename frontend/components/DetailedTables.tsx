"use client";

import { useMemo } from "react";
import type { JobResult } from "@/types/api";

interface Props {
  result: JobResult;
}

const fmt = (n: number, d = 1) => n.toLocaleString(undefined, { maximumFractionDigits: d });

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function DownloadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium
                 text-emerald-600 hover:text-emerald-700"
    >
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor"
           strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2v8m0 0l-3-3m3 3l3-3" />
        <path d="M3 12h10" />
      </svg>
      CSV
    </button>
  );
}

export function DetailedTables({ result }: Props) {
  const stats = useMemo(
    () => [...(result.statistics ?? [])].sort((a, b) => a.year - b.year),
    [result],
  );
  const cm = result.change_matrix?.[0] ?? null;

  // Build a code → name map from the statistics (transitions only carry codes)
  const nameByCode = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of stats) for (const c of s.classes) if (!m.has(c.code)) m.set(c.code, c.name);
    return m;
  }, [stats]);

  // Pivot: one row per class, one column per year (area km²) + latest share
  const pivot = useMemo(() => {
    if (stats.length === 0) return null;
    const years = stats.map((s) => s.year);
    const codes = new Set<number>();
    for (const s of stats) for (const c of s.classes) if (c.code !== 0) codes.add(c.code);
    const latest = stats[stats.length - 1];
    const shareByCode = new Map(latest.classes.map((c) => [c.code, c.share_pct]));

    const rows = [...codes].map((code) => {
      const areas = stats.map(
        (s) => s.classes.find((c) => c.code === code)?.area_km2 ?? 0,
      );
      return {
        code,
        name: nameByCode.get(code) ?? `Class ${code}`,
        areas,
        share: shareByCode.get(code) ?? 0,
        latestArea: areas[areas.length - 1],
      };
    });
    rows.sort((a, b) => b.latestArea - a.latestArea);
    return { years, rows };
  }, [stats, nameByCode]);

  const transitions = useMemo(() => {
    if (!cm) return [];
    return [...cm.transitions]
      .filter((t) => t.from_code !== t.to_code && t.area_km2 > 0)
      .sort((a, b) => b.area_km2 - a.area_km2);
  }, [cm]);

  if (!pivot && transitions.length === 0) return null;

  const exportStats = () => {
    if (!pivot) return;
    const header = ["Code", "Class", ...pivot.years.map((y) => `${y} (km²)`), "Latest share %"];
    const body = pivot.rows.map((r) => [
      r.code, r.name, ...r.areas.map((a) => fmt(a, 2)), fmt(r.share, 2),
    ]);
    downloadCsv("land_cover_statistics.csv", [header, ...body]);
  };

  const exportTransitions = () => {
    const header = ["From code", "From", "To code", "To", "Area km²", "% of source"];
    const body = transitions.map((t) => [
      t.from_code, nameByCode.get(t.from_code) ?? `Class ${t.from_code}`,
      t.to_code, nameByCode.get(t.to_code) ?? `Class ${t.to_code}`,
      fmt(t.area_km2, 2), fmt(t.pct_of_source, 2),
    ]);
    downloadCsv("land_cover_transitions.csv", [header, ...body]);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-6">
      <h3 className="text-base font-semibold text-gray-800">Detailed Data Tables</h3>

      {/* Per-class statistics pivot */}
      {pivot && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-700">
              Land cover area by class &amp; year (km²)
            </h4>
            <DownloadButton onClick={exportStats} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-100 max-h-96 overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-gray-500">
                  <th className="text-left px-3 py-2 font-semibold">Class</th>
                  {pivot.years.map((y) => (
                    <th key={y} className="text-right px-3 py-2 font-semibold tabular-nums">{y}</th>
                  ))}
                  <th className="text-right px-3 py-2 font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {pivot.rows.map((r, i) => (
                  <tr key={r.code} className={i % 2 ? "bg-gray-50/60" : "bg-white"}>
                    <td className="px-3 py-1.5 text-gray-700">{r.name}</td>
                    {r.areas.map((a, j) => (
                      <td key={j} className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                        {a > 0 ? fmt(a) : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-700">
                      {r.share.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transition table */}
      {transitions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-700">
              Land cover transitions {cm ? `(${cm.from_year} → ${cm.to_year})` : ""}
            </h4>
            <DownloadButton onClick={exportTransitions} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-100 max-h-96 overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-gray-500">
                  <th className="text-left px-3 py-2 font-semibold">From</th>
                  <th className="text-left px-3 py-2 font-semibold">To</th>
                  <th className="text-right px-3 py-2 font-semibold">Area km²</th>
                  <th className="text-right px-3 py-2 font-semibold">% of source</th>
                </tr>
              </thead>
              <tbody>
                {transitions.map((t, i) => (
                  <tr key={i} className={i % 2 ? "bg-gray-50/60" : "bg-white"}>
                    <td className="px-3 py-1.5 text-gray-700">{nameByCode.get(t.from_code) ?? `Class ${t.from_code}`}</td>
                    <td className="px-3 py-1.5 text-gray-700">{nameByCode.get(t.to_code) ?? `Class ${t.to_code}`}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{fmt(t.area_km2)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${t.priority_flag ? "text-amber-600 font-semibold" : "text-gray-500"}`}>
                      {t.pct_of_source.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
