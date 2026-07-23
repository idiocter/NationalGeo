"use client";

import { useState } from "react";
import type { EvidenceStatement } from "@/types/api";

const STRENGTH_STYLES: Record<string, string> = {
  strong: "bg-green-50 text-green-700 border-green-200",
  moderate: "bg-blue-50 text-blue-700 border-blue-200",
  weak: "bg-yellow-50 text-yellow-700 border-yellow-200",
  "insufficient data": "bg-gray-50 text-gray-500 border-gray-200",
};

interface Props {
  evidence: EvidenceStatement[];
}

export function EvidencePanel({ evidence }: Props) {
  const [open, setOpen] = useState<number | null>(null);

  if (!evidence.length) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">Evidence</h3>
      {evidence.map((stmt, i) => (
        <div key={i} className="border border-gray-100 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 transition-colors"
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span className="text-sm font-medium text-gray-800">
              {stmt.transition_from} → {stmt.transition_to}
            </span>
            <span
              className={`text-xs border rounded px-2 py-0.5 ${STRENGTH_STYLES[stmt.strength] ?? STRENGTH_STYLES["insufficient data"]}`}
            >
              {stmt.strength}
            </span>
          </button>

          {open === i && (
            <div className="px-3 pb-3 pt-1 space-y-1.5 bg-gray-50 text-xs text-gray-600">
              {stmt.strength === "insufficient data" ? (
                <p className="text-gray-400">{stmt.reason ?? "Insufficient supporting data for this transition."}</p>
              ) : (
                <>
                  <p>{stmt.claim}</p>
                  {stmt.metric && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-white rounded p-2 border border-gray-100">
                        <div className="text-gray-400 mb-0.5">Observed</div>
                        <div className="font-medium">{stmt.metric}</div>
                      </div>
                      <div className="bg-white rounded p-2 border border-gray-100">
                        <div className="text-gray-400 mb-0.5">Baseline</div>
                        <div className="font-medium">{stmt.baseline}</div>
                      </div>
                    </div>
                  )}
                  {stmt.sources.length > 0 && (
                    <p className="text-gray-400">
                      Sources: {stmt.sources.join(", ")}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
