"use client";

import { useEffect, useRef, useState } from "react";
import type { ImageSource, Map as MapLibreMap } from "maplibre-gl";
import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";
import { api } from "@/lib/api";
import type { Municipality } from "@/types/api";

interface Props {
  municipality: Municipality;
  year: number;
  availableYears: number[];
  onYearChange: (year: number) => void;
}

const SOURCE_ID = "landcover-img";
const LAYER_ID  = "landcover-layer";

function geomBbox(geom: GeoJSON.MultiPolygon | GeoJSON.Polygon | undefined) {
  if (!geom) return { west: 80, south: 26, east: 88, north: 30 };
  const coords: [number, number][] = [];
  const collect = (rings: number[][][]) => rings[0].forEach((c) => coords.push(c as [number, number]));
  if (geom.type === "MultiPolygon") geom.coordinates.forEach(collect);
  else collect(geom.coordinates);
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return {
    west:  Math.min(...lons),
    east:  Math.max(...lons),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

export function LandCoverMap({ municipality, year, availableYears, onYearChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<MapLibreMap | null>(null);
  const initYearRef  = useRef(year);
  const [loading, setLoading]  = useState(true);
  const [opacity,  setOpacity] = useState(0.85);

  // Derive bbox once from geometry (stable, no server call needed)
  const bbox = geomBbox(municipality.geometry);

  // MapLibre image-source coordinates: [NW, NE, SE, SW]
  const imgCoords: [[number,number],[number,number],[number,number],[number,number]] = [
    [bbox.west,  bbox.north],
    [bbox.east,  bbox.north],
    [bbox.east,  bbox.south],
    [bbox.west,  bbox.south],
  ];

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    import("maplibre-gl").then(({ Map, NavigationControl }) => {
      const map = new Map({
        container: containerRef.current!,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2],
        zoom: 9,
      });

      map.addControl(new NavigationControl({}));

      map.on("load", () => {
        mapRef.current = map;

        // Boundary outline
        if (municipality.geometry) {
          map.addSource("boundary", {
            type: "geojson",
            data: { type: "Feature", geometry: municipality.geometry as GeoJSON.Geometry, properties: {} },
          });
          map.addLayer({ id: "boundary-fill", type: "fill",   source: "boundary", paint: { "fill-color": "#000", "fill-opacity": 0.03 } });
          map.addLayer({ id: "boundary-line", type: "line",   source: "boundary", paint: { "line-color": "#374151", "line-width": 1.5 } });
        }

        // Land-cover image overlay — URL passed directly so MapLibre fetches it
        const url = api.municipalities.landcoverPngUrl(municipality.id, initYearRef.current);
        map.addSource(SOURCE_ID, { type: "image", url, coordinates: imgCoords });
        map.addLayer({
          id:     LAYER_ID,
          type:   "raster",
          source: SOURCE_ID,
          paint:  { "raster-opacity": opacity, "raster-resampling": "nearest" },
        });

        map.on("sourcedata", (e) => {
          if (e.sourceId === SOURCE_ID && e.isSourceLoaded) setLoading(false);
        });

        map.fitBounds(
          [[bbox.west, bbox.south], [bbox.east, bbox.north]],
          { padding: 40, animate: false },
        );
      });
    });

    return () => { mapRef.current?.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap image URL when year changes (no re-init needed)
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(SOURCE_ID)) return;
    setLoading(true);
    const url = api.municipalities.landcoverPngUrl(municipality.id, year);
    (map.getSource(SOURCE_ID) as ImageSource).updateImage({ url, coordinates: imgCoords });
    // sourcedata fires again once new image is loaded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  // Live-update opacity without reloading
  useEffect(() => {
    if (!mapRef.current?.getLayer(LAYER_ID)) return;
    mapRef.current.setPaintProperty(LAYER_ID, "raster-opacity", opacity);
  }, [opacity]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-white shrink-0 flex-wrap">
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

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-gray-500">Opacity</span>
          <input
            type="range" min={0.2} max={1} step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
            className="w-20 h-1 accent-blue-600"
          />
        </div>

        {loading && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={containerRef} className="absolute inset-0" />

        {/* Legend */}
        <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg shadow border border-gray-100 p-2.5 z-10 max-h-60 overflow-y-auto">
          <p className="text-xs font-semibold text-gray-600 mb-1.5">Land Cover</p>
          <div className="space-y-1">
            {Object.entries(CLASS_NAMES)
              .filter(([code]) => code !== "0")
              .map(([code, name]) => (
                <div key={code} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: CLASS_COLOURS[Number(code)] }}
                  />
                  <span className="text-xs text-gray-700 leading-none">{name}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
