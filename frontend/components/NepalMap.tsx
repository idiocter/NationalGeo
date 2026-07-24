"use client";

import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Municipality } from "@/types/api";

interface Props {
  municipalities: Municipality[];
  selected: string | null;
  onSelect: (id: string) => void;
}

function buildGeoJSON(municipalities: Municipality[]) {
  return {
    type: "FeatureCollection" as const,
    features: municipalities
      .filter((m) => m.geometry)
      .map((m) => ({
        type: "Feature" as const,
        properties: { id: m.id, name: m.name },
        geometry: m.geometry!,
      })),
  };
}

export function NepalMap({ municipalities, selected, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  // Refs keep latest prop values accessible inside stable event handlers
  const municipalitiesRef = useRef(municipalities);
  const onSelectRef = useRef(onSelect);

  useEffect(() => { municipalitiesRef.current = municipalities; });
  useEffect(() => { onSelectRef.current = onSelect; });

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    import("maplibre-gl").then(({ Map, NavigationControl }) => {
      if (!containerRef.current) return;

      const map = new Map({
        container: containerRef.current,
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
        center: [84.124, 28.394],
        zoom: 6,
      });

      map.addControl(new NavigationControl(), "top-right");
      mapRef.current = map;

      map.on("load", () => {
        loadedRef.current = true;

        // Use the ref so we always get current data, even if municipalities
        // arrived before this load event fired.
        map.addSource("municipalities", {
          type: "geojson",
          data: buildGeoJSON(municipalitiesRef.current),
        });

        map.addLayer({
          id: "municipalities-fill",
          type: "fill",
          source: "municipalities",
          paint: {
            "fill-color": [
              "case",
              ["==", ["get", "id"], selected ?? ""],
              "#3b89c9",
              "#1a7a4a",
            ],
            "fill-opacity": 0.25,
          },
        });

        map.addLayer({
          id: "municipalities-outline",
          type: "line",
          source: "municipalities",
          paint: { "line-color": "#1a7a4a", "line-width": 0.8 },
        });

        map.on("click", "municipalities-fill", (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) onSelectRef.current(id);
        });

        map.on("mouseenter", "municipalities-fill", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "municipalities-fill", () => {
          map.getCanvas().style.cursor = "";
        });
      });
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Sync GeoJSON source whenever municipalities prop changes
  useEffect(() => {
    if (!loadedRef.current || !mapRef.current) return;
    const src = mapRef.current.getSource("municipalities") as GeoJSONSource | undefined;
    src?.setData(buildGeoJSON(municipalities));
  }, [municipalities]);

  return <div ref={containerRef} className="w-full h-full" />;
}
