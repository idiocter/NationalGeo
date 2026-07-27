"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ImageSource, Map as MapLibreMap } from "maplibre-gl";
import { FOREST_CODES, FOREST_COLOUR, NON_FOREST_COLOUR } from "@/lib/constants";
import { api } from "@/lib/api";
import type { LandCoverStatistics, Municipality } from "@/types/api";

interface Props {
  municipality: Municipality;
  year: number;
  availableYears: number[];
  onYearChange: (year: number) => void;
  allStats?: LandCoverStatistics[];
}

const SOURCE_ID = "landcover-img";
const LAYER_ID  = "landcover-layer";
const PLAY_INTERVAL_MS = 1600;

function geomBbox(geom: GeoJSON.MultiPolygon | GeoJSON.Polygon | undefined) {
  if (!geom) return { west: 80, south: 26, east: 88, north: 30 };
  const lons: number[] = [];
  const lats: number[] = [];
  const collect = (ring: number[][]) =>
    ring.forEach(([lng, lat]) => { lons.push(lng); lats.push(lat); });
  if (geom.type === "MultiPolygon") geom.coordinates.forEach((p) => collect(p[0]));
  else collect(geom.coordinates[0]);
  return {
    west:  Math.min(...lons),
    east:  Math.max(...lons),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

export function LandCoverMap({
  municipality, year, availableYears, onYearChange, allStats = [],
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<MapLibreMap | null>(null);
  const loadedRef     = useRef(false);
  const playTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Seek-bar index (0 … availableYears.length - 1)
  const initIdx = Math.max(0, availableYears.indexOf(year));
  const [yearIdx, setYearIdx]     = useState(initIdx);
  const [loading, setLoading]     = useState(true);
  const [playing, setPlaying]     = useState(false);

  const currentYear = availableYears[yearIdx] ?? year;
  const currentStats = allStats.find((s) => s.year === currentYear) ?? null;

  const bbox = geomBbox(municipality.geometry);
  const imgCoords: [[number,number],[number,number],[number,number],[number,number]] = [
    [bbox.west,  bbox.north],
    [bbox.east,  bbox.north],
    [bbox.east,  bbox.south],
    [bbox.west,  bbox.south],
  ];

  // Keep parent in sync whenever the internal year changes
  useEffect(() => {
    onYearChange(currentYear);
  }, [currentYear]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initialise MapLibre ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    import("maplibre-gl").then(({ Map, NavigationControl }) => {
      if (!containerRef.current) return;

      const map = new Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            "carto-positron": {
              type: "raster" as const,
              tiles: [
                "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
                "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
                "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
                "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
              ],
              tileSize: 256,
              attribution: "© CARTO © OpenStreetMap contributors",
            },
          },
          layers: [
            { id: "background", type: "background" as const, paint: { "background-color": "#f8f9fa" } },
            { id: "basemap",    type: "raster" as const, source: "carto-positron" },
          ],
        },
        center: [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2],
        zoom: 9,
        preserveDrawingBuffer: true, // required for canvas.toBlob() download
      });

      map.addControl(new NavigationControl(), "top-right");
      mapRef.current = map;

      map.on("load", () => {
        loadedRef.current = true;

        // Add boundary outline first so the land cover layer can insert before it
        if (municipality.geometry) {
          map.addSource("boundary", {
            type: "geojson",
            data: { type: "Feature", geometry: municipality.geometry as GeoJSON.Geometry, properties: {} },
          });
          map.addLayer({
            id: "boundary-line", type: "line", source: "boundary",
            paint: { "line-color": "#1e293b", "line-width": 2 },
          });
        }

        // Add initial land cover overlay below the boundary outline
        const url = api.municipalities.landcoverPngUrl(municipality.id, currentYear);
        map.addSource(SOURCE_ID, { type: "image", url, coordinates: imgCoords });
        map.addLayer(
          { id: LAYER_ID, type: "raster", source: SOURCE_ID, paint: { "raster-opacity": 1.0 } },
          municipality.geometry ? "boundary-line" : undefined,
        );

        map.fitBounds(
          [[bbox.west, bbox.south], [bbox.east, bbox.north]],
          { padding: 40, animate: false },
        );

        map.on("sourcedata", (e) => {
          if (e.sourceId === SOURCE_ID && e.isSourceLoaded) setLoading(false);
        });
      });
    });

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swap land-cover overlay when year changes ────────────────────────────
  // NOTE: MapLibre v3 sends a HEAD preflight before updateImage() — if the
  // endpoint doesn't support HEAD the swap silently aborts.  We avoid that
  // entirely by removing the old source/layer and re-adding with the new URL,
  // which goes straight to a GET request with no HEAD check.
  useEffect(() => {
    if (!loadedRef.current || !mapRef.current) return;
    const map = mapRef.current;
    setLoading(true);

    try {
      if (map.getLayer(LAYER_ID))  map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch { /* ignore if already removed */ }

    const url = api.municipalities.landcoverPngUrl(municipality.id, currentYear);
    map.addSource(SOURCE_ID, { type: "image", url, coordinates: imgCoords });
    map.addLayer({
      id: LAYER_ID, type: "raster", source: SOURCE_ID,
      paint: { "raster-opacity": 1.0 },
    }, "boundary-line"); // insert below boundary so outline stays on top
  }, [currentYear, forestView]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-play ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }
    playTimerRef.current = setInterval(() => {
      setYearIdx((prev) => (prev + 1) % availableYears.length);
    }, PLAY_INTERVAL_MS);
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [playing, availableYears.length]);

  const handleSlider = useCallback((idx: number) => {
    setYearIdx(idx);
    if (playing) setPlaying(false); // pause when user manually scrubs
  }, [playing]);

  const handleDownload = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `landcover_${municipality.id}_${currentYear}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [municipality.id, currentYear]);

  // Slider track fill percentage
  const pct = availableYears.length > 1
    ? (yearIdx / (availableYears.length - 1)) * 100
    : 0;

  const forestLegend = (() => {
    if (!currentStats) return null;
    const valid = currentStats.classes.filter((c) => c.code !== 0 && c.area_km2 > 0);
    const forestKm2    = valid.filter((c) =>  FOREST_CODES.has(c.code)).reduce((s, c) => s + c.area_km2, 0);
    const nonForestKm2 = valid.filter((c) => !FOREST_CODES.has(c.code)).reduce((s, c) => s + c.area_km2, 0);
    const total = forestKm2 + nonForestKm2 || 1;
    return [
      { label: "Forest Area",     colour: FOREST_COLOUR,     km2: forestKm2,    pct: (forestKm2    / total) * 100 },
      { label: "Non-Forest Area", colour: NON_FOREST_COLOUR, km2: nonForestKm2, pct: (nonForestKm2 / total) * 100 },
    ];
  })();

  return (
    <div className="w-full h-full relative flex flex-col">
      {/* Map fills remaining space */}
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="w-full h-full" />

        {/* Loading pulse overlay */}
        {loading && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20
                          bg-white rounded-full px-3 py-1 border border-gray-200
                          text-xs text-blue-600 shadow-sm flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Loading {currentYear}…
          </div>
        )}

        {/* North arrow — top-left */}
        <div className="absolute top-2 left-2 z-10 bg-white/90 rounded-xl
                        shadow-sm border border-gray-200 px-2 py-1.5
                        flex flex-col items-center gap-0.5 select-none pointer-events-none">
          <span className="text-[9px] font-bold text-gray-800 leading-none">N</span>
          <svg viewBox="0 0 14 20" className="w-3.5 h-5" aria-hidden="true">
            {/* North half — dark */}
            <polygon points="7,0 0,14 7,10" fill="#1e293b" />
            {/* South half — light */}
            <polygon points="7,20 14,14 7,10" fill="#94a3b8" />
            {/* South half left */}
            <polygon points="7,20 0,14 7,10" fill="#cbd5e1" />
          </svg>
          <span className="text-[9px] text-gray-400 leading-none">S</span>
        </div>

        {/* Legend — bottom-right above seek bar */}
        <div className="absolute bottom-2 right-2 z-10 bg-white
                        rounded-xl shadow-md border border-gray-200 p-2.5 min-w-[170px]">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Forest Cover · <span className="text-blue-600">{currentYear}</span>
          </p>
          {forestLegend ? (
            <div className="space-y-1.5">
              {forestLegend.map(({ label, colour, km2, pct }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: colour }} />
                  <span className="text-[10px] text-gray-700 leading-tight flex-1">{label}</span>
                  <div className="text-right">
                    <div className="text-[10px] font-medium text-gray-700 tabular-nums leading-none">
                      {km2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
                    </div>
                    <div className="text-[9px] text-gray-400 tabular-nums leading-none">
                      {pct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-gray-400 italic">Run analysis for live data</p>
          )}
        </div>
      </div>

      {/* ── Timeline seek bar ─────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-t border-gray-200 px-4 pt-2.5 pb-3 z-10">
        <div className="flex items-center gap-3">
          {/* Play / Pause button */}
          <button
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause" : "Play"}
            className="shrink-0 w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700
                       text-white flex items-center justify-center transition-colors shadow-sm"
          >
            {playing ? (
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <rect x="3" y="2" width="3.5" height="12" rx="1"/>
                <rect x="9.5" y="2" width="3.5" height="12" rx="1"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M4 2.5l9 5.5-9 5.5V2.5z"/>
              </svg>
            )}
          </button>

          {/* Slider + tick marks */}
          <div className="flex-1 flex flex-col gap-1">
            <div className="flex justify-between items-center mb-0.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">
                Land cover timeline
              </span>
              <span className="text-xs font-bold text-blue-600">{currentYear}</span>
            </div>
            <div className="relative">
              <input
                type="range"
                min={0}
                max={availableYears.length - 1}
                step={1}
                value={yearIdx}
                onChange={(e) => handleSlider(Number(e.target.value))}
                className="w-full h-1.5 rounded-full outline-none cursor-pointer appearance-none"
                style={{
                  background: `linear-gradient(to right, #2563eb ${pct}%, #e5e7eb ${pct}%)`,
                  accentColor: "#2563eb",
                }}
              />
              <div className="flex justify-between px-0 mt-1">
                {availableYears.map((yr, i) => (
                  <button
                    key={yr}
                    onClick={() => handleSlider(i)}
                    className={`text-[10px] tabular-nums transition-colors leading-none
                                ${i === yearIdx
                                  ? "text-blue-600 font-bold"
                                  : "text-gray-400 hover:text-gray-600"}`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Download current year map as PNG */}
          <button
            onClick={handleDownload}
            aria-label="Download map image"
            title={`Download ${currentYear} land cover map`}
            className="shrink-0 w-8 h-8 rounded-full bg-white hover:bg-gray-50
                       border border-gray-200 hover:border-blue-400
                       text-gray-500 hover:text-blue-600
                       flex items-center justify-center transition-colors shadow-sm"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v8m0 0l-3-3m3 3l3-3"/>
              <path d="M3 12h10"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Slider thumb style — injected once */}
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px; height: 16px;
          border-radius: 50%;
          background: #2563eb;
          border: 2px solid #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,.25);
          cursor: pointer;
          transition: transform .1s;
        }
        input[type="range"]::-webkit-slider-thumb:active {
          transform: scale(1.2);
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px; height: 16px;
          border-radius: 50%;
          background: #2563eb;
          border: 2px solid #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,.25);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
