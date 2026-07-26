"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { AnalysisStream } from "@/components/AnalysisStream";
import { ChangeChart } from "@/components/ChangeChart";
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
import type { ChangeMatrix, JobResult, LandCoverStatistics, Municipality } from "@/types/api";

export default function MunicipalityPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"map" | "charts">("map");
  // Tracks cache-hit responses where submit() already returns status=complete
  // without going through the Celery/SSE path.
  const [cacheHitDone, setCacheHitDone] = useState(false);

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
        {jobId && (isDone || result !== null) && (
          <a
            href={api.analysis.reportCsvUrl(jobId)}
            download
            className="ml-2 text-xs bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700 transition-colors"
          >
            Download CSV
          </a>
        )}
      </header>

      <div className="flex-1 overflow-hidden flex">
        <aside className="w-80 shrink-0 border-r border-gray-100 overflow-y-auto p-4 space-y-5">
          {submitError && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-3">
              {submitError}
            </div>
          )}

          {jobId && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {isDone ? "Stages completed" : "Analysis progress"}
              </h3>
              <AnalysisStream stages={stages} isDone={isDone} />
            </section>
          )}

          {availableYears.length > 1 && (
            <section>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                Year snapshot
              </label>
              <div className="flex gap-1 flex-wrap">
                {availableYears.map((yr) => (
                  <button
                    key={yr}
                    onClick={() => setSelectedYear(yr)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      yr === displayYear
                        ? "bg-blue-600 text-white border-blue-600"
                        : "border-gray-200 text-gray-600 hover:border-blue-300"
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
            </section>
          )}

          {displayStats && (
            <section>
              <StatisticsPanel stats={displayStats} />
            </section>
          )}

          {changeMatrix && (
            <section>
              <NetChangeTable matrix={changeMatrix} />
            </section>
          )}

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

          {result?.evidence && result.evidence.length > 0 && (
            <section>
              <EvidencePanel evidence={result.evidence} />
            </section>
          )}

          {result && jobId && isDone && (
            <section>
              <ReportDownload result={{
                ...result,
                artefacts: {
                  pdf:  result.artefacts?.pdf  ?? { url: api.analysis.reportPdfUrl(jobId) },
                  xlsx: result.artefacts?.xlsx ?? { url: api.analysis.reportXlsxUrl(jobId) },
                },
              }} />
            </section>
          )}
        </aside>

        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Tab bar */}
          <div className="flex border-b border-gray-100 bg-white shrink-0 px-4">
            {(["map", "charts"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`text-xs px-4 py-2.5 border-b-2 transition-colors capitalize ${
                  activeTab === tab
                    ? "border-blue-600 text-blue-600 font-semibold"
                    : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                {tab === "map" ? "Land Cover Map" : "Charts & Tables"}
              </button>
            ))}
          </div>

          {/* Map tab — flex-1 min-h-0 so h-full resolves inside a flex column */}
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
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* KPI summary row */}
              {displayStats && (
                <div className="grid grid-cols-3 gap-3">
                  {(() => {
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
                      <>
                        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Total area</p>
                          <p className="text-xl font-bold text-gray-900 tabular-nums">
                            {totalKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            <span className="text-sm font-normal text-gray-400 ml-1">km²</span>
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{displayYear}</p>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Dominant type</p>
                          <p className="text-sm font-bold text-gray-900 leading-tight">{top ? (CLASS_NAMES[top.code] ?? top.name) : "—"}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{top ? `${top.share_pct.toFixed(1)}% of total` : ""}</p>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Biggest change</p>
                          {biggestNetChange ? (
                            <>
                              <p className={`text-sm font-bold leading-tight ${biggestNetChange.delta_km2 > 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {biggestNetChange.delta_km2 > 0 ? "+" : ""}
                                {biggestNetChange.delta_km2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
                              </p>
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                {CLASS_NAMES[biggestNetChange.code] ?? biggestNetChange.class_name} · {changeMatrix!.from_year}–{changeMatrix!.to_year}
                              </p>
                            </>
                          ) : (
                            <p className="text-sm text-gray-300">—</p>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {availableStats.length >= 2 && (
                <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                  <TrendChart statistics={availableStats} />
                </div>
              )}

              {changeMatrix && changeMatrix.trend_series.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                  <ChangeChart change={changeMatrix} />
                </div>
              )}

              {!result && !submitError && (
                <div className="flex items-center justify-center h-40 text-gray-300 text-sm">
                  Analysis running…
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
