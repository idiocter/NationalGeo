"use client";

import { useEffect, useRef } from "react";
import type { Municipality } from "@/types/api";

interface Props {
  municipalities: Municipality[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function NepalMap({ municipalities, selected, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let map: unknown;

    import("maplibre-gl").then(({ Map, NavigationControl }) => {
      map = new Map({
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
        center: [84.124, 28.394],
        zoom: 6,
      });

      (map as { addControl: (c: unknown, position?: string) => void }).addControl(new NavigationControl(), "top-right");
      mapRef.current = map;

      (map as { on: (ev: string, cb: () => void) => void }).on("load", () => {
        const m = map as {
          addSource: (id: string, src: object) => void;
          addLayer: (layer: object) => void;
          on: (ev: string, layer: string, cb: (e: { features?: { properties?: { id?: string } }[] }) => void) => void;
          getCanvas: () => { style: { cursor: string } };
        };

        const geojson = {
          type: "FeatureCollection" as const,
          features: municipalities
            .filter((m) => m.geometry)
            .map((mun) => ({
              type: "Feature" as const,
              properties: { id: mun.id, name: mun.name },
              geometry: mun.geometry!,
            })),
        };

        m.addSource("municipalities", { type: "geojson", data: geojson });

        m.addLayer({
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

        m.addLayer({
          id: "municipalities-outline",
          type: "line",
          source: "municipalities",
          paint: { "line-color": "#1a7a4a", "line-width": 0.8 },
        });

        m.on("click", "municipalities-fill", (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) onSelect(id);
        });

        m.on("mouseenter", "municipalities-fill", () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", "municipalities-fill", () => {
          m.getCanvas().style.cursor = "";
        });
      });
    });

    return () => {
      if (map) (map as { remove: () => void }).remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
