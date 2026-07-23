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
import type { JobResult, Municipality } from "@/types/api";

export default function MunicipalityPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { stages, isDone } = useJobStream(jobId);

  // Load municipality metadata
  useEffect(() => {
    api.municipalities.get(id).then(setMunicipality).catch(console.error);
  }, [id]);

  // Submit analysis job on mount
  useEffect(() => {
    api.analysis
      .submit({
        municipality_id: id,
        years: ANALYSIS_YEARS,
        requested_outputs: ["stats", "change", "maps", "report"],
        dataset_version: DEFAULT_DATASET_VERSION,
        boundary_version: DEFAULT_BOUNDARY_VERSION,
      })
      .then((res) => {
        setJobId(res.job_id);
        if (res.status === "complete" && res.result) {
          setResult(res.result);
        }
      })
      .catch((e: Error) => setSubmitError(e.message));
  }, [id]);

  // Poll for result once stream signals completion
  useEffect(() => {
    if (isDone && jobId && !result) {
      api.analysis.getJob(jobId).then((job) => {
        if (job.status === "complete" || job.status === "partial") {
          setResult(job as JobResult);
        }
      });
    }
  }, [isDone, jobId, result]);

  const latestStats = result?.statistics?.[result.statistics.length - 1];
  const latestChange = result?.change_matrix?.[0];

  return (
    <main className="h-screen flex flex-col">
      {/* Header */}
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
            {municipality.province} · {municipality.type.replace("_", " ")}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar */}
        <aside className="w-80 shrink-0 border-r border-gray-100 overflow-y-auto p-4 space-y-6">
          {submitError && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-3">
              {submitError}
            </div>
          )}

          {/* Progress stream */}
          {jobId && !result && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Analysis progress
              </h3>
              <AnalysisStream stages={stages} isDone={isDone} />
            </section>
          )}

          {/* Statistics */}
          {latestStats && (
            <section>
              <StatisticsPanel stats={latestStats} />
            </section>
          )}

          {/* Evidence */}
          {result?.evidence && result.evidence.length > 0 && (
            <section>
              <EvidencePanel evidence={result.evidence} />
            </section>
          )}

          {/* Report download */}
          {result && result.artefacts && (
            <section>
              <ReportDownload result={result} />
            </section>
          )}
        </aside>

        {/* Main content — chart area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {latestChange && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <ChangeChart change={latestChange} />
            </div>
          )}

          {!result && !submitError && (
            <div className="flex items-center justify-center h-full text-gray-300 text-sm">
              Analysis running…
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
