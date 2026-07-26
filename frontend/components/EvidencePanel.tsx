"use client";

import { useState } from "react";
import type { EvidenceStatement } from "@/types/api";

const STRENGTH_STYLES: Record<string, string> = {
  strong:              "bg-emerald-50 text-emerald-700 border-emerald-200",
  moderate:            "bg-blue-50 text-blue-700 border-blue-200",
  weak:                "bg-amber-50 text-amber-700 border-amber-200",
  "insufficient data": "bg-gray-50 text-gray-400 border-gray-200",
};

const STRENGTH_LABEL: Record<string, string> = {
  strong:              "Strong evidence",
  moderate:            "Moderate evidence",
  weak:                "Weak evidence",
  "insufficient data": "Insufficient data",
};

function isPlaceholder(stmt: EvidenceStatement) {
  const from = stmt.transition_from?.trim().toLowerCase();
  const to   = stmt.transition_to?.trim().toLowerCase();
  return from === "[all transitions]" || to === "[spatial]" ||
         from === "all transitions"   || to === "spatial";
}

interface Props {
  evidence: EvidenceStatement[];
}

export function EvidencePanel({ evidence }: Props) {
  const [open, setOpen] = useState<number | null>(null);

  if (!evidence.length) return null;

  const real    = evidence.filter((s) => !isPlaceholder(s) && s.strength !== "insufficient data");
  const missing = evidence.filter((s) => isPlaceholder(s) || s.strength === "insufficient data");

  if (!real.length && !missing.length) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Supporting evidence
      </h3>

      {real.length === 0 && (
        <p className="text-xs text-gray-400 bg-gray-50 rounded-xl p-3 border border-gray-100">
          No supporting evidence could be derived from available datasets.
        </p>
      )}

      {real.map((stmt, i) => (
        <div key={i} className="border border-gray-100 rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
            onClick={() => setOpen(open === i ? null : i)}
          >
            <div className="min-w-0">
              <span className="text-xs font-medium text-gray-800 block truncate">
                {stmt.transition_from} → {stmt.transition_to}
              </span>
              <span className="text-[10px] text-gray-400 line-clamp-1 mt-0.5">
                {stmt.claim}
              </span>
            </div>
            <span
              className={`text-[10px] border rounded px-1.5 py-0.5 shrink-0 ${STRENGTH_STYLES[stmt.strength] ?? STRENGTH_STYLES["insufficient data"]}`}
            >
              {STRENGTH_LABEL[stmt.strength] ?? stmt.strength}
            </span>
          </button>

          {open === i && (
            <div className="px-3 pb-3 pt-1 space-y-2 bg-gray-50 text-xs text-gray-600 border-t border-gray-100">
              <p className="text-gray-700">{stmt.claim}</p>
              {stmt.metric && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white rounded-lg p-2 border border-gray-100">
                    <div className="text-[10px] text-gray-400 mb-0.5">Observed</div>
                    <div className="font-medium text-gray-800">{stmt.metric}</div>
                  </div>
                  <div className="bg-white rounded-lg p-2 border border-gray-100">
                    <div className="text-[10px] text-gray-400 mb-0.5">Baseline</div>
                    <div className="font-medium text-gray-800">{stmt.baseline ?? "—"}</div>
                  </div>
                </div>
              )}
              {stmt.sources.length > 0 && (
                <p className="text-[10px] text-gray-400">
                  Data: {stmt.sources.join(" · ")}
                </p>
              )}
            </div>
          )}
        </div>
      ))}

      {missing.length > 0 && (
        <div className="text-[10px] text-gray-400 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
          <span className="font-semibold text-gray-500">Missing datasets</span> — {missing.length} transition{missing.length !== 1 ? "s" : ""} could not be evaluated due to insufficient supporting data.
        </div>
      )}
    </div>
  );
}
