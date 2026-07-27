"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { ANALYSIS_YEARS, DEFAULT_DATASET_VERSION } from "@/lib/constants";

interface CountryInfo {
  name: string;
  municipality_count: number;
  district_count: number;
  province_count: number;
  total_area_km2: number;
  population: number;
}

export default function CountryPage() {
  const router  = useRouter();
  const [info, setInfo]   = useState<CountryInfo | null>(null);
  const [year, setYear]   = useState<number>(ANALYSIS_YEARS[ANALYSIS_YEARS.length - 1]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.country.get()
      .then((data) => setInfo(data as CountryInfo))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const mapUrl = api.country.landcoverPngUrl(year, DEFAULT_DATASET_VERSION);

  return (
    <main className="h-screen flex flex-col bg-white">
      <header className="h-12 flex items-center gap-3 px-4 border-b border-gray-200 bg-white shrink-0 z-20">
        <button onClick={() => router.push("/")} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
          ← Map
        </button>
        <span className="text-gray-200 select-none">|</span>
        <span className="font-semibold text-gray-900 text-sm tracking-tight">Nepal</span>
        <span className="text-xs text-gray-400">Country Overview</span>
      </header>

      <div className="flex-1 overflow-hidden flex">
        <aside className="w-72 shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4 space-y-5">
            {loading && <p className="text-xs text-gray-400 animate-pulse">Loading…</p>}

            {info && (
              <section className="space-y-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Nepal Summary</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Provinces",      info.province_count],
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
          </div>
        </aside>

        <div className="flex-1 bg-gray-100 flex flex-col items-center justify-center gap-4 p-6">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
            Nepal Land Cover Map · {year}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mapUrl}
            alt={`Nepal land cover ${year}`}
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
