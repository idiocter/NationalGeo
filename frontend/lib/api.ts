import type {
  DashboardStats,
  DistrictInfo,
  JobEnvelope,
  JobResult,
  Municipality,
  ProvinceInfo,
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
    list:   () => request<Municipality[]>("/municipalities"),
    get:    (id: string) => request<Municipality>(`/municipalities/${id}`),
    landcoverPngUrl: (id: string, year: number, datasetVersion = "landcover-v3.1") =>
      `${BASE_URL}/municipalities/${id}/landcover/${year}.png?dataset_version=${datasetVersion}`,
    changePngUrl: (id: string, fromYear: number, toYear: number, datasetVersion = "landcover-v3.1") =>
      `${BASE_URL}/municipalities/${id}/landcover/change/${fromYear}-${toYear}.png?dataset_version=${datasetVersion}`,
  },

  provinces: {
    list: () => request<ProvinceInfo[]>("/provinces"),
    get:  (name: string) => request<ProvinceInfo>(`/provinces/${encodeURIComponent(name)}`),
    districts: (name: string) => request<DistrictInfo[]>(`/provinces/${encodeURIComponent(name)}/districts`),
    municipalities: (name: string) => request<Municipality[]>(`/provinces/${encodeURIComponent(name)}/municipalities`),
    landcoverPngUrl: (name: string, year: number, datasetVersion = "landcover-v3.1") =>
      `${BASE_URL}/provinces/${encodeURIComponent(name)}/landcover/${year}.png?dataset_version=${datasetVersion}`,
  },

  districts: {
    list: () => request<DistrictInfo[]>("/districts"),
    get:  (name: string) => request<DistrictInfo>(`/districts/${encodeURIComponent(name)}`),
    municipalities: (name: string) => request<Municipality[]>(`/districts/${encodeURIComponent(name)}/municipalities`),
    landcoverPngUrl: (name: string, year: number, datasetVersion = "landcover-v3.1") =>
      `${BASE_URL}/districts/${encodeURIComponent(name)}/landcover/${year}.png?dataset_version=${datasetVersion}`,
  },

  country: {
    get: () => request<{ name: string; municipality_count: number; district_count: number; province_count: number; total_area_km2: number; population: number }>("/country"),
    landcoverPngUrl: (year: number, datasetVersion = "landcover-v3.1") =>
      `${BASE_URL}/country/landcover/${year}.png?dataset_version=${datasetVersion}`,
  },

  analysis: {
    submit: (envelope: JobEnvelope) =>
      request<SubmitResponse>("/analysis", { method: "POST", body: JSON.stringify(envelope) }),
    getJob: (jobId: string) => request<JobResult>(`/jobs/${jobId}`),
    reportCsvUrl:  (jobId: string) => `${BASE_URL}/jobs/${jobId}/report.csv`,
    reportPdfUrl:  (jobId: string) => `${BASE_URL}/jobs/${jobId}/report.pdf`,
    reportXlsxUrl: (jobId: string) => `${BASE_URL}/jobs/${jobId}/report.xlsx`,
    downloadZipUrl:(jobId: string) => `${BASE_URL}/jobs/${jobId}/download.zip`,
  },

  dashboard: {
    get: () => request<DashboardStats>("/dashboard"),
  },

  provenance: {
    getFigure:   (figureId: string) => request<object>(`/provenance/figure/${figureId}`),
    getManifest: (jobId: string)    => request<object>(`/provenance/jobs/${jobId}/manifest`),
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
