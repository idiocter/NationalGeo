"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { AnalysisStream } from "@/components/AnalysisStream";
import { ChangeChart } from "@/components/ChangeChart";
import { EvidencePanel } from "@/components/EvidencePanel";
import { ReportDownload } from "@/components/ReportDownload";
import { StatisticsPanel } from "@/components/StatisticsPanel";
import { api } from "@/lib/api";
import { useJobStream } from "@/lib/sse";
import {
  ANALYSIS_YEARS,
  DEFAULT_BOUNDARY_VERSION,
  DEFAULT_DATASET_VERSION,
} from "@/lib/constants";
import type { JobResult, LandCoverStatistics, Municipality } from "@/types/api";

export default function MunicipalityPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const { stages, isDone } = useJobStream(jobId);

  useEffect(() => {
    api.municipalities.get(id).then(setMunicipality).catch(console.error);
  }, [id]);

  useEffect(() => {
    api.analysis
      .submit({
        municipality_id: id,
        years: ANALYSIS_YEARS,
        requested_outputs: ["stats", "change"],
        dataset_version: DEFAULT_DATASET_VERSION,
        boundary_version: DEFAULT_BOUNDARY_VERSION,
      })
      .then((res) => {
        setJobId(res.job_id);
        if (res.status === "complete" && res.result) {
          setResult(res.result as JobResult);
        }
      })
      .catch((e: Error) => setSubmitError(e.message));
  }, [id]);

  useEffect(() => {
    if (isDone && jobId && !result) {
      api.analysis.getJob(jobId).then((job) => {
        if (job.status === "complete" || job.status === "partial") {
          setResult(job as JobResult);
        }
      });
    }
  }, [isDone, jobId, result]);

  // Pick the stats to display — user-selected year or latest available
  const availableStats: LandCoverStatistics[] = result?.statistics ?? [];
  const availableYears = availableStats.map((s) => s.year).sort((a, b) => a - b);
  const displayYear = selectedYear ?? availableYears[availableYears.length - 1] ?? null;
  const displayStats = availableStats.find((s) => s.year === displayYear) ?? null;

  const changeMatrix = result?.change_matrix?.[0] ?? null;
  const validation = result?.validation ?? null;

  const verdictColour =
    validation?.verdict === "pass"
      ? "bg-green-50 text-green-700 border-green-200"
      : validation?.verdict === "warn"
        ? "bg-yellow-50 text-yellow-700 border-yellow-200"
        : validation?.verdict === "block"
          ? "bg-red-50 text-red-700 border-red-200"
          : "";

  return (
    <main className="h-screen flex flex-col">
      <header className="h-12 flex items-center gap-3 px-4 border-b border-gray-200 bg-white shrink-0">
        <button
          onClick={() => router.push("/")}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          ← Map
        </button>
        <span className="text-gray-200">|</span>
        <span className="font-semibold text-gray-900 text-sm">
          {municipality?.name ?? id}
        </span>
        {municipality && (
          <span className="text-xs text-gray-400">
            {municipality.province} · {municipality.type.replace(/_/g, " ")}
          </span>
        )}
        {validation && (
          <span className={`ml-auto text-xs border rounded px-2 py-0.5 ${verdictColour}`}>
            QA: {validation.verdict.toUpperCase()}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-hidden flex">
        <aside className="w-80 shrink-0 border-r border-gray-100 overflow-y-auto p-4 space-y-5">
          {submitError && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-3">
              {submitError}
            </div>
          )}

          {/* Progress stream — visible while running and after completion */}
          {jobId && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {isDone ? "Stages completed" : "Analysis progress"}
              </h3>
              <AnalysisStream stages={stages} isDone={isDone} />
            </section>
          )}

          {/* Year selector */}
          {availableYears.length > 1 && (
            <section>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                Year
              </label>
              <select
                value={displayYear ?? ""}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 bg-white"
              >
                {availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </section>
          )}

          {/* Statistics table */}
          {displayStats && (
            <section>
              <StatisticsPanel stats={displayStats} />
            </section>
          )}

          {/* Validation warnings */}
          {validation?.verdict === "warn" && (
            <section>
              <h3 className="text-xs font-semibold text-yellow-600 uppercase tracking-wide mb-2">
                Data quality notes
              </h3>
              <ul className="space-y-1">
                {validation.checks
                  .filter((c) => c.status === "warn")
                  .map((c) => (
                    <li key={c.id} className="text-xs text-yellow-700 bg-yellow-50 rounded p-2">
                      {c.detail}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {/* Evidence — Phase 3 */}
          {result?.evidence && result.evidence.length > 0 && (
            <section>
              <EvidencePanel evidence={result.evidence} />
            </section>
          )}

          {/* Report download — Phase 4 */}
          {result?.artefacts && (
            <section>
              <ReportDownload result={result} />
            </section>
          )}
        </aside>

        {/* Main: trend chart */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {changeMatrix && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <ChangeChart change={changeMatrix} />
            </div>
          )}

          {!result && !submitError && (
            <div className="flex items-center justify-center h-full text-gray-300 text-sm">
              Analysis running…
            </div>
          )}

          {result && !changeMatrix && (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              No change data available.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
