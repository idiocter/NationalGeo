"use client";

import type { JobResult } from "@/types/api";

interface Props {
  result: JobResult;
}

const FORMATS = [
  { key: "pdf", label: "PDF Report", icon: "📄", description: "Print-ready A4, maps included" },
  { key: "docx", label: "Word Document", icon: "📝", description: "Editable tables and narrative" },
  { key: "xlsx", label: "Excel Data", icon: "📊", description: "Raw numbers for analysis" },
  { key: "map_bundle", label: "Map Bundle", icon: "🗺️", description: "PNG + SVG + time-lapse" },
] as const;

export function ReportDownload({ result }: Props) {
  if (!result.artefacts) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">Download report</h3>
      <div className="grid grid-cols-2 gap-2">
        {FORMATS.map(({ key, label, icon, description }) => {
          const artefact = result.artefacts?.[key];
          return (
            <a
              key={key}
              href={artefact?.url}
              download
              className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-colors ${
                artefact
                  ? "border-gray-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer"
                  : "border-gray-100 opacity-40 cursor-not-allowed pointer-events-none"
              }`}
            >
              <span className="text-lg leading-none">{icon}</span>
              <div>
                <div className="text-xs font-medium text-gray-800">{label}</div>
                <div className="text-xs text-gray-400">{description}</div>
              </div>
            </a>
          );
        })}
      </div>
      {result.validation?.verdict === "warn" && (
        <p className="text-xs text-yellow-600 bg-yellow-50 border border-yellow-100 rounded p-2">
          ⚠ Some quality warnings were noted. See the evidence panel for details.
        </p>
      )}
    </div>
  );
}
