import type {
  DashboardStats,
  JobEnvelope,
  JobResult,
  Municipality,
  SubmitResponse,
} from "@/types/api";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  municipalities: {
    list: () => request<Municipality[]>("/municipalities"),
    get: (id: string) => request<Municipality>(`/municipalities/${id}`),
    landcoverPngUrl: (id: string, year: number, datasetVersion = "landcover-v3.1") =>
      `${BASE_URL}/municipalities/${id}/landcover/${year}.png?dataset_version=${datasetVersion}`,
  },

  analysis: {
    submit: (envelope: JobEnvelope) =>
      request<SubmitResponse>("/analysis", {
        method: "POST",
        body: JSON.stringify(envelope),
      }),
    getJob: (jobId: string) => request<JobResult>(`/jobs/${jobId}`),
    reportCsvUrl:  (jobId: string) => `${BASE_URL}/jobs/${jobId}/report.csv`,
    reportPdfUrl:  (jobId: string) => `${BASE_URL}/jobs/${jobId}/report.pdf`,
    reportXlsxUrl: (jobId: string) => `${BASE_URL}/jobs/${jobId}/report.xlsx`,
  },

  dashboard: {
    get: () => request<DashboardStats>("/dashboard"),
  },

  provenance: {
    getFigure: (figureId: string) =>
      request<object>(`/provenance/figure/${figureId}`),
    getManifest: (jobId: string) =>
      request<object>(`/provenance/jobs/${jobId}/manifest`),
  },

  auth: {
    login: (username: string, password: string) =>
      request<{ access_token: string; token_type: string }>("/auth/token", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    whoami: () => request<{ authenticated: boolean; username?: string }>("/auth/me"),
  },
};
