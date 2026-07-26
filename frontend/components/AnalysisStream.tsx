"use client";

import { STAGE_LABELS } from "@/lib/constants";
import type { StageEvent } from "@/types/api";

const STAGE_ORDER = [
  "orchestrator",
  "raster_analysis",
  "change_detection",
  "evidence",
  "cartography",
  "narrative",
  "report",
  "validation",
];

interface Props {
  stages: Record<string, StageEvent>;
  isDone: boolean;
}

export function AnalysisStream({ stages, isDone }: Props) {
  const activeStages = STAGE_ORDER.filter((s) => stages[s] || isDone);
  const list = activeStages.length ? activeStages : STAGE_ORDER.slice(0, 4);

  return (
    <div className="space-y-2">
      {list.map((stage) => {
        const event  = stages[stage];
        const status = event?.status ?? (isDone ? "queued" : "queued");
        const pct    = event?.pct ?? 0;
        const label  = STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");

        return (
          <div key={stage} className="flex items-center gap-2.5">
            <StatusDot status={status} />
            <span className="text-xs text-gray-700 flex-1 truncate">{label}</span>
            <span className="text-[10px] text-gray-400 w-6 text-right shrink-0">
              {status === "complete" ? "✓" : status === "failed" ? "✗" : status === "running" ? `${pct}%` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls: Record<string, string> = {
    queued:   "bg-gray-200",
    running:  "bg-blue-500 animate-pulse",
    complete: "bg-emerald-500",
    failed:   "bg-red-500",
    partial:  "bg-amber-400",
  };
  return (
    <span className={`w-2 h-2 rounded-full shrink-0 ${cls[status] ?? "bg-gray-200"}`} />
  );
}
