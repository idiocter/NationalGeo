"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { NepalMap } from "@/components/NepalMap";
import { api } from "@/lib/api";
import type { Municipality } from "@/types/api";

export default function HomePage() {
  const router = useRouter();
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.municipalities
      .list()
      .then(setMunicipalities)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(id: string) {
    setSelected(id);
    router.push(`/municipality/${id}`);
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
        <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg shadow px-3 py-2 text-xs text-gray-600">
          Click any municipality to analyse land cover 2000–2022
        </div>
      </div>
    </main>
  );
}
