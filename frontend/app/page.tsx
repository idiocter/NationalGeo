"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { NepalMap } from "@/components/NepalMap";
import { api } from "@/lib/api";
import type { DashboardStats, Municipality } from "@/types/api";

const MAX_RESULTS = 8;

function filterMunicipalities(municipalities: Municipality[], query: string): Municipality[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const startsWith = municipalities.filter((m) => m.name.toLowerCase().startsWith(q));
  const contains = municipalities.filter(
    (m) => !m.name.toLowerCase().startsWith(q) && m.name.toLowerCase().includes(q)
  );
  return [...startsWith, ...contains].slice(0, MAX_RESULTS);
}

export default function HomePage() {
  const router = useRouter();
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = filterMunicipalities(municipalities, query);

  useEffect(() => {
    api.municipalities
      .list()
      .then(setMunicipalities)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    api.dashboard.get().then(setDashboard).catch(() => {});
  }, []);

  // Close dropdown when clicking outside the search widget
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function handleSelect(id: string) {
    setSelected(id);
    router.push(`/municipality/${id}`);
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
      handleSelect(results[activeIndex].id);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  function pickResult(m: Municipality) {
    setQuery(m.name);
    setOpen(false);
    handleSelect(m.id);
  }

  return (
    <main className="h-screen flex flex-col">
      <header className="h-12 flex items-center px-4 border-b border-gray-200 bg-white z-10 shrink-0">
        <span className="font-semibold text-gray-900 text-sm">NGLIP</span>
        <span className="ml-2 text-xs text-gray-400">Nepal GeoAI Land Intelligence Platform</span>
        {loading && (
          <span className="ml-auto text-xs text-gray-400 animate-pulse">Loading boundaries…</span>
        )}
        {error && (
          <span className="ml-auto text-xs text-red-500">API unavailable — {error}</span>
        )}
      </header>

      <div className="flex-1 relative">
        <NepalMap municipalities={municipalities} selected={selected} onSelect={handleSelect} />

        {/* Search overlay */}
        <div
          ref={searchRef}
          className="absolute top-3 left-3 z-10 w-72"
        >
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
              fill="none" stroke="currentColor" strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <circle cx={11} cy={11} r={8} />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Search municipality…"
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => query.trim() && setOpen(true)}
              className="w-full pl-9 pr-8 py-2 text-sm bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-md placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {query && (
              <button
                onClick={() => { setQuery(""); setOpen(false); inputRef.current?.focus(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {open && results.length > 0 && (
            <ul className="mt-1 bg-white border border-gray-100 rounded-lg shadow-lg overflow-hidden">
              {results.map((m, i) => (
                <li key={m.id}>
                  <button
                    onClick={() => pickResult(m)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors ${
                      i === activeIndex ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <span className="text-sm font-medium text-gray-900 truncate">{m.name}</span>
                    <span className="text-xs text-gray-400 truncate">
                      {m.district} · {m.province}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {open && query.trim() && results.length === 0 && !loading && (
            <div className="mt-1 bg-white border border-gray-100 rounded-lg shadow-lg px-3 py-3 text-xs text-gray-400">
              No municipalities match &ldquo;{query}&rdquo;
            </div>
          )}
        </div>

        {/* Dashboard stats overlay — bottom left */}
        <div className="absolute bottom-4 left-4 flex flex-col gap-2 z-10">
          <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow px-3 py-2 text-xs text-gray-600">
            Search or click any municipality to analyse land cover 2000–2020
          </div>
          {dashboard && (
            <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow border border-gray-100 px-3 py-2 text-xs">
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-600">{dashboard.analyzed_count}</div>
                  <div className="text-gray-500">Analysed</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-700">{dashboard.total_municipalities}</div>
                  <div className="text-gray-500">Total</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">{dashboard.coverage_pct}%</div>
                  <div className="text-gray-500">Coverage</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
