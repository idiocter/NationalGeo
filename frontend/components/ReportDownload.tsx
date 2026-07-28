"use client";

import type { JobResult } from "@/types/api";

interface Props {
  result: JobResult;
  pdfUrl?: string;
  xlsxUrl?: string;
}

const REPORT_FORMATS = [
  {
    key: "pdf" as const,
    label: "PDF Report",
    description: "Print-ready A4 with maps + statistics",
    icon: (
      <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor">
        <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V7l-4-4H4zm8 0v4h4M8 13h4M8 10h4M8 7h1"/>
      </svg>
    ),
  },
  {
    key: "xlsx" as const,
    label: "Excel Data",
    description: "6-sheet workbook — stats, transitions, CAGR",
    icon: (
      <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor">
        <rect x="3" y="3" width="14" height="14" rx="2"/>
        <path d="M7 7l2 3-2 3M11 7h3M11 10h3M11 13h3" stroke="white" strokeWidth="1.2" fill="none"/>
      </svg>
    ),
  },
] as const;

export function ReportDownload({ result, pdfUrl, xlsxUrl }: Props) {
  // Always prefer explicit full URLs passed as props over relative URLs stored in artefacts
  const reportUrls: Record<string, string | undefined> = {
    pdf:  pdfUrl,
    xlsx: xlsxUrl,
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Download
      </h3>

      {/* Report files (maps are downloadable individually in the Report Maps section) */}
      <div className="grid grid-cols-2 gap-2">
        {REPORT_FORMATS.map(({ key, label, description, icon }) => {
          const url = reportUrls[key] ?? result.artefacts?.[key]?.url;
          return (
            <a
              key={key}
              href={url}
              download
              className={`flex items-start gap-2 p-3 rounded-xl border text-left transition-colors ${
                url
                  ? "border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 cursor-pointer"
                  : "border-gray-200 bg-gray-50 opacity-40 cursor-not-allowed pointer-events-none"
              }`}
            >
              <span className={`mt-0.5 shrink-0 ${url ? "text-blue-600" : "text-gray-300"}`}>
                {icon}
              </span>
              <div>
                <div className="text-xs font-medium text-gray-800">{label}</div>
                <div className="text-[10px] text-gray-400">{description}</div>
              </div>
            </a>
          );
        })}
      </div>

      {result.validation?.verdict === "warn" && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl p-2">
          Quality warnings noted — check the evidence panel for details.
        </p>
      )}
    </div>
  );
}
