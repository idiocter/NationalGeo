"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { ANALYSIS_YEARS, DEFAULT_DATASET_VERSION } from "@/lib/constants";
import type { DistrictInfo, Municipality, ProvinceInfo } from "@/types/api";

export default function ProvincePage() {
  const { name } = useParams<{ name: string }>();
  const router    = useRouter();
  const decoded   = decodeURIComponent(name);

  const [info, setInfo]             = useState<ProvinceInfo | null>(null);
  const [districts, setDistricts]   = useState<DistrictInfo[]>([]);
  const [municipalities, setMunis]  = useState<Municipality[]>([]);
  const [loading, setLoading]       = useState(true);
  const [year, setYear]             = useState<number>(ANALYSIS_YEARS[ANALYSIS_YEARS.length - 1]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.provinces.get(decoded),
      api.provinces.districts(decoded),
      api.provinces.municipalities(decoded),
    ]).then(([prov, dists, munis]) => {
      setInfo(prov);
      setDistricts(dists);
      setMunis(munis);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, [decoded]);

  const mapUrl = api.provinces.landcoverPngUrl(decoded, year, DEFAULT_DATASET_VERSION);

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
        <span className="text-xs text-gray-400">Province</span>
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
                    ["Districts",      info.district_count],
                    ["Municipalities", info.municipality_count],
                    ["Area km²",       info.total_area_km2?.toLocaleString(undefined, {maximumFractionDigits:0}) ?? "—"],
                    ["Population",     info.population?.toLocaleString() ?? "—"],
                  ].map(([label, value]) => (
                    <div key={label as string} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                      <p className="text-sm font-bold text-gray-900 mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
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

            {/* Districts list */}
            {districts.length > 0 && (
              <section className="border-t border-gray-100 pt-4">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Districts</p>
                <ul className="space-y-1">
                  {districts.map((d) => (
                    <li key={d.district}>
                      <button
                        onClick={() => router.push(`/district/${encodeURIComponent(d.district)}`)}
                        className="w-full text-left text-xs text-gray-700 hover:text-blue-600 px-2 py-1.5 rounded-lg hover:bg-blue-50 transition-colors flex items-center justify-between"
                      >
                        <span>{d.district}</span>
                        <span className="text-gray-400 text-[10px]">{d.municipality_count} munis</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Municipalities quick list */}
            {municipalities.length > 0 && (
              <section className="border-t border-gray-100 pt-4">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Municipalities ({municipalities.length})
                </p>
                <ul className="space-y-0.5 max-h-48 overflow-y-auto">
                  {municipalities.map((m) => (
                    <li key={m.id}>
                      <button
                        onClick={() => router.push(`/municipality/${m.id}`)}
                        className="w-full text-left text-xs text-gray-600 hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-50 transition-colors truncate"
                      >
                        {m.name}
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
            Province Land Cover Map · {year}
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
