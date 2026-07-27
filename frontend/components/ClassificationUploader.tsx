"use client";

import { useRef, useState } from "react";
import type { CustomClassGroup } from "@/types/api";
import { CLASS_COLOURS, CLASS_NAMES } from "@/lib/constants";

interface Props {
  groups: CustomClassGroup[] | null;
  onChange: (groups: CustomClassGroup[] | null) => void;
}

const TEMPLATE: CustomClassGroup[] = [
  { id: "veg",   name: "Vegetation",    codes: [1, 2, 3], color: "#22c55e" },
  { id: "water", name: "Water Bodies",  codes: [6],       color: "#3b82f6" },
  { id: "built", name: "Built-up",      codes: [10],      color: "#ef4444" },
  { id: "other", name: "Other",         codes: [4, 5, 7, 8, 9, 11], color: "#94a3b8" },
];

export function ClassificationUploader({ groups, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed: unknown = JSON.parse(e.target?.result as string);
        if (!Array.isArray(parsed)) throw new Error("JSON root must be an array.");
        const validated = (parsed as unknown[]).map((item, i) => {
          const g = item as Record<string, unknown>;
          if (typeof g.id !== "string") throw new Error(`Item ${i}: "id" must be a string.`);
          if (typeof g.name !== "string") throw new Error(`Item ${i}: "name" must be a string.`);
          if (!Array.isArray(g.codes) || !(g.codes as unknown[]).every((c) => typeof c === "number"))
            throw new Error(`Item ${i}: "codes" must be an array of numbers.`);
          if (typeof g.color !== "string") throw new Error(`Item ${i}: "color" must be a string.`);
          return { id: g.id as string, name: g.name as string, codes: g.codes as number[], color: g.color as string };
        });
        onChange(validated);
      } catch (err: unknown) {
        setError((err as Error).message);
      }
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function downloadTemplate() {
    const blob = new Blob([JSON.stringify(TEMPLATE, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "classification_template.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Custom Classification</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-[10px] text-blue-500 hover:underline"
          >
            Download template
          </button>
          {groups && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[10px] text-red-400 hover:underline"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {!groups ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
        >
          <p className="text-xs text-gray-500">Drop a <code className="bg-gray-100 px-0.5 rounded">.json</code> classification file here, or click to browse</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Format: <code>[{"{"}id, name, codes: [1,2,...], color{"}"}, ...]</code></p>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          {groups.map((g) => (
            <div key={g.id} className="flex items-start gap-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
              <span className="mt-0.5 w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-800 leading-none">{g.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                  {g.codes.map((c) => CLASS_NAMES[c] ?? `code ${c}`).join(", ")}
                </p>
              </div>
              <span className="text-[10px] text-gray-300 flex-shrink-0 tabular-nums">{g.codes.join(", ")}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-[10px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
          {error}
        </p>
      )}
    </div>
  );
}
