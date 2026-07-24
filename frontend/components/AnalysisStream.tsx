"use client";

import { STAGE_LABELS } from "@/lib/constants";
import type { StageEvent } from "@/types/api";

// Phase 2 stages — extended in Phase 3/4 when those agents are implemented
const STAGE_ORDER = [
  "orchestrator",
  "raster_analysis",
  "change_detection",
  "validation",
];

interface Props {
  stages: Record<string, StageEvent>;
  isDone: boolean;
}

export function AnalysisStream({ stages, isDone }: Props) {
  return (
    <div className="space-y-2">
      {STAGE_ORDER.map((stage) => {
        const event = stages[stage];
        if (!event && !isDone) return null;

        const status = event?.status ?? "queued";
        const pct = event?.pct ?? 0;
        const label = STAGE_LABELS[stage] ?? stage;

        return (
          <div key={stage} className="flex items-center gap-3">
            <StatusDot status={status} />
            <span className="text-sm font-medium w-44 truncate">{label}</span>
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColour(status)}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-8 text-right">
              {status === "complete" ? "✓" : status === "failed" ? "✗" : `${pct}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colours: Record<string, string> = {
    queued: "bg-gray-300",
    running: "bg-blue-400 animate-pulse",
    complete: "bg-green-500",
    failed: "bg-red-500",
    partial: "bg-yellow-400",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colours[status] ?? "bg-gray-300"}`}
    />
  );
}

function barColour(status: string): string {
  if (status === "complete") return "bg-green-500";
  if (status === "failed") return "bg-red-400";
  if (status === "running") return "bg-blue-400";
  return "bg-gray-200";
}
