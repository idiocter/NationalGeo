"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { ANALYSIS_YEARS, DEFAULT_DATASET_VERSION } from "@/lib/constants";
import type { DistrictInfo, Municipality } from "@/types/api";

export default function DistrictPage() {
  const { name } = useParams<{ name: string }>();
  const router    = useRouter();
  const decoded   = decodeURIComponent(name);

  const [info, setInfo]            = useState<DistrictInfo | null>(null);
  const [municipalities, setMunis] = useState<Municipality[]>([]);
  const [loading, setLoading]      = useState(true);
  const [year, setYear]            = useState<number>(ANALYSIS_YEARS[ANALYSIS_YEARS.length - 1]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.districts.get(decoded),
      api.districts.municipalities(decoded),
    ]).then(([dist, munis]) => {
      setInfo(dist);
      setMunis(munis);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, [decoded]);

  const mapUrl = api.districts.landcoverPngUrl(decoded, year, DEFAULT_DATASET_VERSION);

  return (
    <main className="h-screen flex flex-col bg-white">
      <header className="h-12 flex items-center gap-3 px-4 border-b border-gray-200 bg-white shrink-0 z-20">
        <button onClick={() => router.push("/")} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
          ← Map
        </button>
        <span className="text-gray-200 select-none">|</span>
        <span className="font-semibold text-gray-900 text-sm tracking-tight truncate">
          {decoded}
        </span>
        {info && (
          <span className="text-xs text-gray-400">
            District · {info.province}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar */}
        <aside className="w-72 shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4 space-y-5">
            {loading && <p className="text-xs text-gray-400 animate-pulse">Loading…</p>}

            {info && (
              <section className="space-y-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Summary</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Municipalities", info.municipality_count],
                    ["Province",       info.province],
                    ["Area km²",       info.total_area_km2?.toLocaleString(undefined, {maximumFractionDigits:0}) ?? "—"],
                    ["Population",     info.population?.toLocaleString() ?? "—"],
                  ].map(([label, value]) => (
                    <div key={label as string} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                      <p className="text-sm font-bold text-gray-900 mt-0.5 truncate">{value}</p>
                    </div>
                  ))}
                </div>
                {info.province && (
                  <button
                    onClick={() => router.push(`/province/${encodeURIComponent(info.province)}`)}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    ↑ View {info.province} province
                  </button>
                )}
              </section>
            )}

            {/* Year selector */}
            <section>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Year</p>
              <div className="flex gap-1 flex-wrap">
                {ANALYSIS_YEARS.map((yr) => (
                  <button
                    key={yr}
                    onClick={() => setYear(yr)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                      yr === year
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600"
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
            </section>

            {/* Municipalities list */}
            {municipalities.length > 0 && (
              <section className="border-t border-gray-100 pt-4">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Municipalities ({municipalities.length})
                </p>
                <ul className="space-y-0.5">
                  {municipalities.map((m) => (
                    <li key={m.id}>
                      <button
                        onClick={() => router.push(`/municipality/${m.id}`)}
                        className="w-full text-left text-xs text-gray-600 hover:text-blue-600 px-2 py-1.5 rounded-lg hover:bg-blue-50 transition-colors flex items-center justify-between"
                      >
                        <span className="truncate">{m.name}</span>
                        <span className="text-gray-300 text-[10px] shrink-0 ml-1">
                          {m.type?.replace(/_/g, " ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </aside>

        {/* Map preview */}
        <div className="flex-1 bg-gray-100 flex flex-col items-center justify-center gap-4 p-6">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
            District Land Cover Map · {year}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mapUrl}
            alt={`${decoded} land cover ${year}`}
            className="max-w-full max-h-[70vh] rounded-xl shadow-lg border border-gray-200 object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <p className="text-[10px] text-gray-400">
            ICIMOD 30m land cover · EPSG:32645
          </p>
        </div>
      </div>
    </main>
  );
}
