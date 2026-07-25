"use client";

import { useEffect, useRef, useState } from "react";
import type { ImageSource, Map as MapLibreMap } from "maplibre-gl";
import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import { api } from "@/lib/api";
import type { LandCoverStatistics, Municipality } from "@/types/api";

interface Props {
  municipality: Municipality;
  year: number;
  availableYears: number[];
  onYearChange: (year: number) => void;
  stats?: LandCoverStatistics | null;
}

const SOURCE_ID = "landcover-img";
const LAYER_ID  = "landcover-layer";

function geomBbox(geom: GeoJSON.MultiPolygon | GeoJSON.Polygon | undefined) {
  if (!geom) return { west: 80, south: 26, east: 88, north: 30 };
  const lons: number[] = [];
  const lats: number[] = [];
  const collect = (ring: number[][]) => ring.forEach(([lng, lat]) => { lons.push(lng); lats.push(lat); });
  if (geom.type === "MultiPolygon") geom.coordinates.forEach((poly) => collect(poly[0]));
  else collect(geom.coordinates[0]);
  return {
    west:  Math.min(...lons),
    east:  Math.max(...lons),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

export function LandCoverMap({ municipality, year, availableYears, onYearChange, stats }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<MapLibreMap | null>(null);
  const loadedRef    = useRef(false);
  const yearRef      = useRef(year);

  const [loading, setLoading] = useState(true);
  const opacity = 1.0;

  // Keep yearRef current so the load-callback can use latest year even if
  // the prop changed while the async import was resolving.
  useEffect(() => { yearRef.current = year; });

  const bbox = geomBbox(municipality.geometry);
  // MapLibre image-source coordinates: [NW, NE, SE, SW]
  const imgCoords: [[number,number],[number,number],[number,number],[number,number]] = [
    [bbox.west,  bbox.north],
    [bbox.east,  bbox.north],
    [bbox.east,  bbox.south],
    [bbox.west,  bbox.south],
  ];

  // Initialise map once — mirrors NepalMap pattern exactly
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    import("maplibre-gl").then(({ Map, NavigationControl }) => {
      if (!containerRef.current) return;

      const map = new Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {},
          // Plain white canvas — no basemap tiles, municipality only
          layers: [{
            id: "background",
            type: "background",
            paint: { "background-color": "#ffffff" },
          }],
        },
        center: [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2],
        zoom: 9,
      });

      map.addControl(new NavigationControl(), "top-right");
      mapRef.current = map;

      map.on("load", () => {
        loadedRef.current = true;

        // Land-cover PNG first so boundary stroke renders on top
        const url = api.municipalities.landcoverPngUrl(municipality.id, yearRef.current);
        map.addSource(SOURCE_ID, { type: "image", url, coordinates: imgCoords });
        map.addLayer({
          id:     LAYER_ID,
          type:   "raster",
          source: SOURCE_ID,
          paint:  { "raster-opacity": opacity },
        });

        // Municipality boundary outline on top
        if (municipality.geometry) {
          map.addSource("boundary", {
            type: "geojson",
            data: { type: "Feature", geometry: municipality.geometry as GeoJSON.Geometry, properties: {} },
          });
          map.addLayer({ id: "boundary-line", type: "line", source: "boundary",
            paint: { "line-color": "#1e293b", "line-width": 2 } });
        }

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
      mapRef.current?.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Swap overlay when year changes
  useEffect(() => {
    if (!loadedRef.current || !mapRef.current) return;
    const src = mapRef.current.getSource(SOURCE_ID) as ImageSource | undefined;
    if (!src) return;
    setLoading(true);
    src.updateImage({
      url: api.municipalities.landcoverPngUrl(municipality.id, year),
      coordinates: imgCoords,
    });
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps


  return (
    // w-full h-full — fills whatever the parent gives us, exactly like NepalMap
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full" />

      {/* Toolbar overlay — top of map */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-2
                      bg-white/90 backdrop-blur-sm border-b border-gray-100 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Year</span>
        <div className="flex gap-1">
          {availableYears.map((yr) => (
            <button
              key={yr}
              onClick={() => onYearChange(yr)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                yr === year
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-gray-200 text-gray-600 hover:border-blue-300"
              }`}
            >
              {yr}
            </button>
          ))}
        </div>
        {loading && <span className="text-xs text-gray-400 animate-pulse ml-auto">Loading…</span>}
      </div>

      {/* Legend — bottom-right, built from actual data when available */}
      <div className="absolute bottom-8 right-2 z-10 bg-white/95 backdrop-blur-sm
                      rounded-lg shadow border border-gray-200 p-3 max-h-64 overflow-y-auto min-w-[160px]">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Land Cover{stats ? ` · ${year}` : ""}
        </p>
        <div className="space-y-1.5">
          {(stats
            ? [...stats.classes].sort((a, b) => b.area_km2 - a.area_km2)
            : Object.entries(CLASS_NAMES)
                .filter(([code]) => code !== "0")
                .map(([code, name]) => ({ code: Number(code), name, share_pct: null }))
          ).map((entry) => {
            const code  = "code" in entry ? entry.code : Number((entry as [string, string])[0]);
            const name  = CLASS_NAMES[code] ?? ("code" in entry ? entry.name : (entry as [string, string])[1]);
            const share = "share_pct" in entry ? (entry as { share_pct: number | null }).share_pct : null;
            const colour = CLASS_COLOURS[code] ?? "#cccccc";
            return (
              <div key={code} className="flex items-center gap-2">
                <span
                  className="inline-block w-3.5 h-3.5 rounded-sm shrink-0 border border-gray-300/60"
                  style={{ backgroundColor: colour }}
                />
                <span className="text-xs text-gray-700 leading-tight flex-1">{name}</span>
                {share !== null && (
                  <span className="text-xs text-gray-400 tabular-nums">{share.toFixed(1)}%</span>
                )}
              </div>
            );
          })}
        </div>
        {!stats && (
          <p className="text-xs text-gray-400 mt-2 italic">Run analysis to see coverage</p>
        )}
      </div>
    </div>
  );
}
