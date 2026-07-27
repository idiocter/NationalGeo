"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { NepalMap } from "@/components/NepalMap";
import { api } from "@/lib/api";
import type { DashboardStats, DistrictInfo, Municipality, ProvinceInfo } from "@/types/api";

const MAX_RESULTS = 8;
type Scope = "municipality" | "district" | "province" | "country";

const SCOPE_LABELS: Record<Scope, string> = {
  country: "Country",
  province: "Province",
  district: "District",
  municipality: "Municipality",
};

function filterList<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const startsWith = items.filter((m) => m.name.toLowerCase().startsWith(q));
  const contains   = items.filter((m) => !m.name.toLowerCase().startsWith(q) && m.name.toLowerCase().includes(q));
  return [...startsWith, ...contains].slice(0, MAX_RESULTS);
}

function filterMunicipalities(items: Municipality[], query: string): Municipality[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const startsWith = items.filter((m) => m.name.toLowerCase().startsWith(q));
  const contains   = items.filter((m) => !m.name.toLowerCase().startsWith(q) && m.name.toLowerCase().includes(q));
  return [...startsWith, ...contains].slice(0, MAX_RESULTS);
}

export default function HomePage() {
  const router = useRouter();

  const [scope, setScope] = useState<Scope>("municipality");
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [provinces, setProvinces]           = useState<ProvinceInfo[]>([]);
  const [districts, setDistricts]           = useState<DistrictInfo[]>([]);

  const [selected, setSelected]       = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [dashboard, setDashboard]     = useState<DashboardStats | null>(null);

  const [query, setQuery]             = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen]               = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Compute search results based on current scope
  const munResults  = scope === "municipality" ? filterMunicipalities(municipalities, query) : [];
  const provResults = scope === "province"     ? filterList(provinces.map((p) => ({ ...p, name: p.province })), query) : [];
  const distResults = scope === "district"     ? filterList(districts.map((d) => ({ ...d, name: d.district })), query) : [];
  const results = [...munResults, ...provResults, ...distResults];

  useEffect(() => {
    api.municipalities.list()
      .then(setMunicipalities)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    api.dashboard.get().then(setDashboard).catch(() => {});
    api.provinces.list().then(setProvinces).catch(() => {});
    api.districts.list().then(setDistricts).catch(() => {});
  }, []);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function handleSelectMunicipality(id: string) {
    setSelected(id);
    router.push(`/municipality/${id}`);
  }

  function handleSelectProvince(name: string) {
    router.push(`/province/${encodeURIComponent(name)}`);
  }

  function handleSelectDistrict(name: string) {
    router.push(`/district/${encodeURIComponent(name)}`);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setActiveIndex(-1);
    setOpen(value.trim().length > 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      if (scope === "municipality") handleSelectMunicipality((munResults[activeIndex] as Municipality).id);
      else if (scope === "province")  handleSelectProvince((provResults[activeIndex] as ProvinceInfo & {name:string}).province);
      else if (scope === "district")  handleSelectDistrict((distResults[activeIndex] as DistrictInfo & {name:string}).district);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  function pickResult(item: Municipality | (ProvinceInfo & {name:string}) | (DistrictInfo & {name:string})) {
    setQuery(item.name);
    setOpen(false);
    if (scope === "municipality") { handleSelectMunicipality((item as Municipality).id); return; }
    if (scope === "province")    { handleSelectProvince((item as ProvinceInfo).province); return; }
    if (scope === "district")    { handleSelectDistrict((item as DistrictInfo).district); return; }
  }

  const placeholder =
    scope === "country"      ? "Click to view all Nepal…"
    : scope === "province"   ? "Search province…"
    : scope === "district"   ? "Search district…"
    : "Search municipality…";

  return (
    <main className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="h-12 flex items-center px-4 border-b border-gray-200 bg-white shrink-0 z-20">
        <span className="font-semibold text-gray-900 text-sm tracking-tight">NGLIP</span>
        <span className="ml-2 text-xs text-gray-400">Nepal GeoAI Land Intelligence Platform</span>
        {loading && <span className="ml-auto text-xs text-gray-400 animate-pulse">Loading boundaries…</span>}
        {error   && <span className="ml-auto text-xs text-red-500">API unavailable — {error}</span>}
      </header>

      <div className="flex-1 relative bg-gray-100">
        <NepalMap municipalities={municipalities} selected={selected} onSelect={handleSelectMunicipality} />

        {/* Search + scope selector overlay */}
        <div ref={searchRef} className="absolute top-3 left-3 z-10 w-80">
          {/* Scope tabs */}
          <div className="flex bg-white border border-gray-200 rounded-xl shadow-md mb-1.5 overflow-hidden">
            {(["country", "province", "district", "municipality"] as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setScope(s);
                  setQuery("");
                  setOpen(false);
                  if (s === "country") router.push("/country");
                }}
                className={`flex-1 text-[10px] py-1.5 transition-colors font-medium border-r last:border-r-0 border-gray-100 ${
                  scope === s
                    ? "bg-blue-600 text-white"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                {SCOPE_LABELS[s]}
              </button>
            ))}
          </div>

          {scope !== "country" && (
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
              >
                <circle cx={11} cy={11} r={8} />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                placeholder={placeholder}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => query.trim() && setOpen(true)}
                className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-gray-200 rounded-xl shadow-md placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {query && (
                <button
                  onClick={() => { setQuery(""); setOpen(false); inputRef.current?.focus(); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 leading-none"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {open && results.length > 0 && (
            <ul className="mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
              {results.map((m, i) => {
                if (scope === "municipality") {
                  const mun = m as Municipality;
                  return (
                    <li key={mun.id}>
                      <button
                        onClick={() => pickResult(mun)}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={`w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors ${
                          i === activeIndex ? "bg-blue-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <span className="text-sm font-medium text-gray-900 truncate">{mun.name}</span>
                        <span className="text-xs text-gray-400 truncate">{mun.district} · {mun.province}</span>
                      </button>
                    </li>
                  );
                }
                if (scope === "province") {
                  const prov = m as ProvinceInfo & {name:string};
                  return (
                    <li key={prov.province}>
                      <button
                        onClick={() => pickResult(prov)}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={`w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors ${
                          i === activeIndex ? "bg-blue-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <span className="text-sm font-medium text-gray-900 truncate">{prov.province}</span>
                        <span className="text-xs text-gray-400 truncate">
                          {prov.district_count} districts · {prov.municipality_count} municipalities
                          {prov.total_area_km2 ? ` · ${prov.total_area_km2.toLocaleString(undefined, {maximumFractionDigits:0})} km²` : ""}
                        </span>
                      </button>
                    </li>
                  );
                }
                if (scope === "district") {
                  const dist = m as DistrictInfo & {name:string};
                  return (
                    <li key={dist.district}>
                      <button
                        onClick={() => pickResult(dist)}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={`w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors ${
                          i === activeIndex ? "bg-blue-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <span className="text-sm font-medium text-gray-900 truncate">{dist.district}</span>
                        <span className="text-xs text-gray-400 truncate">
                          {dist.province} · {dist.municipality_count} municipalities
                          {dist.total_area_km2 ? ` · ${dist.total_area_km2.toLocaleString(undefined, {maximumFractionDigits:0})} km²` : ""}
                        </span>
                      </button>
                    </li>
                  );
                }
                return null;
              })}
            </ul>
          )}

          {open && query.trim() && results.length === 0 && !loading && (
            <div className="mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-3 text-xs text-gray-400">
              No {SCOPE_LABELS[scope].toLowerCase()}s match &ldquo;{query}&rdquo;
            </div>
          )}
        </div>

        {/* Dashboard stats + hint — bottom left */}
        <div className="absolute bottom-4 left-4 flex flex-col gap-2 z-10">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-3 py-2 text-xs text-gray-500">
            Search or click any municipality to analyse land cover 2000–2020
          </div>
          {dashboard && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3">
              <div className="flex gap-5">
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-600 tabular-nums leading-tight">
                    {dashboard.analyzed_count}
                  </div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">Analysed</div>
                </div>
                <div className="w-px bg-gray-100 self-stretch" />
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-700 tabular-nums leading-tight">
                    {dashboard.total_municipalities}
                  </div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">Total</div>
                </div>
                <div className="w-px bg-gray-100 self-stretch" />
                <div className="text-center">
                  <div className="text-lg font-bold text-emerald-600 tabular-nums leading-tight">
                    {dashboard.coverage_pct}%
                  </div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">Coverage</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
