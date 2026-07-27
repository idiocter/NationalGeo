"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { AnalysisStream } from "@/components/AnalysisStream";
import { AlluvialChart } from "@/components/AlluvialChart";
import { ClassificationUploader } from "@/components/ClassificationUploader";
import { ComparisonBarChart } from "@/components/ComparisonBarChart";
import { DeltaLineChart } from "@/components/DeltaLineChart";
import { EvidencePanel } from "@/components/EvidencePanel";
import { LandCoverMap } from "@/components/LandCoverMap";
import { NetChangeTable } from "@/components/NetChangeTable";
import { ReportDownload } from "@/components/ReportDownload";
import { StatisticsPanel } from "@/components/StatisticsPanel";
import { TrendChart } from "@/components/TrendChart";
import { api } from "@/lib/api";
import { useJobStream } from "@/lib/sse";
import {
  ANALYSIS_YEARS,
  CLASS_NAMES,
  DEFAULT_BOUNDARY_VERSION,
  DEFAULT_DATASET_VERSION,
} from "@/lib/constants";
import type { ChangeMatrix, CustomClassGroup, JobResult, LandCoverStatistics, Municipality } from "@/types/api";

const VERDICT_STYLE: Record<string, string> = {
  pass:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn:  "bg-amber-50 text-amber-700 border-amber-200",
  block: "bg-red-50 text-red-700 border-red-200",
};

export default function MunicipalityPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"map" | "charts">("map");
  const [cacheHitDone, setCacheHitDone] = useState(false);
  const [customGroups, setCustomGroups] = useState<CustomClassGroup[] | null>(null);

  const { stages, isDone: streamDone } = useJobStream(jobId);
  const isDone = streamDone || cacheHitDone;

  useEffect(() => {
    api.municipalities.get(id).then(setMunicipality).catch(console.error);
  }, [id]);

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
          setResult(res.result as JobResult);
          setCacheHitDone(true);
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

  const availableStats: LandCoverStatistics[] = result?.statistics ?? [];
  const availableYears = availableStats.map((s) => s.year).sort((a, b) => a - b);
  const displayYear = selectedYear ?? availableYears[availableYears.length - 1] ?? null;
  const displayStats = availableStats.find((s) => s.year === displayYear) ?? null;

  const changeMatrix: ChangeMatrix | null = result?.change_matrix?.[0] ?? null;
  const validation = result?.validation ?? null;

  return (
    <main className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="h-12 flex items-center gap-3 px-4 border-b border-gray-200 bg-white shrink-0 z-20">
        <button
          onClick={() => router.push("/")}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors leading-none"
        >
          ← Map
        </button>
        <span className="text-gray-200 select-none">|</span>
        <span className="font-semibold text-gray-900 text-sm tracking-tight truncate">
          {municipality?.name ?? id}
        </span>
        {municipality && (
          <span className="text-xs text-gray-400 truncate hidden sm:block">
            {municipality.province} · {municipality.type.replace(/_/g, " ")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {validation && (
            <span className={`text-xs border rounded-full px-2.5 py-0.5 ${VERDICT_STYLE[validation.verdict] ?? ""}`}>
              QA: {validation.verdict.toUpperCase()}
            </span>
          )}
          {jobId && isDone && (
            <a
              href={api.analysis.reportCsvUrl(jobId)}
              download
              className="text-xs bg-gray-900 text-white rounded-lg px-3 py-1.5 hover:bg-gray-700 transition-colors"
            >
              CSV
            </a>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar */}
        <aside className="w-80 shrink-0 bg-white border-r border-gray-200 overflow-y-auto flex flex-col">
          <div className="flex-1 p-4 space-y-5">
            {submitError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
                {submitError}
              </div>
            )}

            {jobId && (
              <section>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  {isDone ? "Stages completed" : "Analysis in progress"}
                </p>
                <AnalysisStream stages={stages} isDone={isDone} />
              </section>
            )}

            {availableYears.length > 1 && (
              <section>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Year snapshot
                </p>
                <div className="flex gap-1 flex-wrap">
                  {availableYears.map((yr) => (
                    <button
                      key={yr}
                      onClick={() => setSelectedYear(yr)}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                        yr === displayYear
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600"
                      }`}
                    >
                      {yr}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {displayStats && (
              <section className="border-t border-gray-100 pt-4">
                <StatisticsPanel stats={displayStats} />
              </section>
            )}

            {changeMatrix && (
              <section className="border-t border-gray-100 pt-4">
                <NetChangeTable matrix={changeMatrix} />
              </section>
            )}

            {validation?.verdict === "warn" && (
              <section className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
                  Data quality notes
                </p>
                <ul className="space-y-1">
                  {validation.checks
                    .filter((c) => c.status === "warn")
                    .map((c) => (
                      <li key={c.id} className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-2.5">
                        {c.detail}
                      </li>
                    ))}
                </ul>
              </section>
            )}

            {result?.evidence && result.evidence.length > 0 && (
              <section className="border-t border-gray-100 pt-4">
                <EvidencePanel evidence={result.evidence} />
              </section>
            )}

            <section className="border-t border-gray-100 pt-4">
              <ClassificationUploader groups={customGroups} onChange={setCustomGroups} />
            </section>

            {result && jobId && isDone && (
              <section className="border-t border-gray-100 pt-4">
                <ReportDownload
                  result={{
                    ...result,
                    artefacts: {
                      pdf:  result.artefacts?.pdf  ?? { url: api.analysis.reportPdfUrl(jobId) },
                      xlsx: result.artefacts?.xlsx ?? { url: api.analysis.reportXlsxUrl(jobId) },
                      comparison_map: result.artefacts?.comparison_map ?? { url: api.analysis.comparisonMapUrl(jobId) },
                      change_map:     result.artefacts?.change_map     ?? { url: api.analysis.changeMapUrl(jobId) },
                    },
                  }}
                  comparisonMapUrl={api.analysis.comparisonMapUrl(jobId)}
                  changeMapUrl={api.analysis.changeMapUrl(jobId)}
                />
                <a
                  href={api.analysis.downloadZipUrl(jobId)}
                  download
                  className="mt-2 flex items-center justify-center gap-1.5 w-full text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 rounded-lg px-3 py-2 transition-colors"
                >
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                    <path d="M8 12L3 7h3V2h4v5h3L8 12z"/>
                    <rect x="2" y="13" width="12" height="1.5" rx="0.75"/>
                  </svg>
                  Download all outputs (.zip)
                </a>
              </section>
            )}
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex-1 overflow-hidden flex flex-col bg-gray-50">
          {/* Tab bar */}
          <div className="flex border-b border-gray-200 bg-white shrink-0 px-4">
            {(["map", "charts"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`text-xs px-4 py-3 border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-blue-600 text-blue-600 font-semibold"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                {tab === "map" ? "Land Cover Map" : "Charts & Tables"}
              </button>
            ))}
          </div>

          {/* Map tab */}
          {activeTab === "map" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              {municipality ? (
                <LandCoverMap
                  municipality={municipality}
                  year={displayYear ?? ANALYSIS_YEARS[ANALYSIS_YEARS.length - 1]}
                  availableYears={ANALYSIS_YEARS}
                  onYearChange={setSelectedYear}
                  allStats={availableStats}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-300 text-sm">
                  Loading municipality…
                </div>
              )}
            </div>
          )}

          {/* Charts tab */}
          {activeTab === "charts" && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* KPI summary row */}
              {displayStats && (() => {
                const top = [...displayStats.classes]
                  .filter((c) => c.code !== 0)
                  .sort((a, b) => b.area_km2 - a.area_km2)[0];
                const totalKm2 = displayStats.classes
                  .filter((c) => c.code !== 0)
                  .reduce((s, c) => s + c.area_km2, 0);
                const biggestNetChange = changeMatrix
                  ? [...changeMatrix.net_change]
                      .filter((n) => Math.abs(n.delta_km2) > 0.01)
                      .sort((a, b) => Math.abs(b.delta_km2) - Math.abs(a.delta_km2))[0]
                  : null;
                return (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Total area</p>
                      <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">
                        {totalKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        <span className="text-sm font-normal text-gray-400 ml-1">km²</span>
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1">{displayYear}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Dominant type</p>
                      <p className="text-sm font-bold text-gray-900 leading-tight">
                        {top ? (CLASS_NAMES[top.code] ?? top.name) : "—"}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {top ? `${top.share_pct.toFixed(1)}% of total` : ""}
                      </p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Biggest change</p>
                      {biggestNetChange ? (
                        <>
                          <p className={`text-sm font-bold leading-tight ${biggestNetChange.delta_km2 > 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {biggestNetChange.delta_km2 > 0 ? "+" : ""}
                            {biggestNetChange.delta_km2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
                          </p>
                          <p className="text-[10px] text-gray-400 mt-1">
                            {CLASS_NAMES[biggestNetChange.code] ?? biggestNetChange.class_name}
                            {" · "}{changeMatrix!.from_year}–{changeMatrix!.to_year}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-gray-300 mt-1">—</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Row 1: Comparison bar + delta line */}
              {availableStats.length >= 2 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                    <ComparisonBarChart statistics={availableStats} />
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                    <DeltaLineChart statistics={availableStats} />
                  </div>
                </div>
              )}

              {/* Row 2: Year-by-year trend line + stacked area */}
              {availableStats.length >= 2 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <TrendChart statistics={availableStats} />
                </div>
              )}

              {changeMatrix && changeMatrix.transitions.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <AlluvialChart change={changeMatrix} customGroups={customGroups} />
                </div>
              )}

              {!result && !submitError && (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-xs text-gray-400">Analysis running…</span>
                </div>
              )}

              {result && availableStats.length === 0 && (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                  No statistics available.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
