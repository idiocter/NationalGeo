export type JobStatus = "queued" | "running" | "complete" | "failed" | "partial";
export type OutputType = "stats" | "change" | "maps" | "report";
export type EvidenceStrength = "strong" | "moderate" | "weak" | "insufficient data";
export type CheckStatus = "pass" | "warn" | "block";

export interface Municipality {
  id: string;
  name: string;
  name_np?: string;
  province: string;
  district: string;
  type: "metropolitan" | "sub_metropolitan" | "municipality" | "rural_municipality";
  total_area_km2?: number;
  population?: number;
  geometry?: GeoJSON.MultiPolygon;
  bbox?: GeoJSON.Polygon;
}

export interface JobEnvelope {
  municipality_id: string;
  years: number[];
  requested_outputs: OutputType[];
  dataset_version: string;
  boundary_version: string;
}

export interface SubmitResponse {
  job_id: string;
  status: JobStatus;
  cache_hit?: boolean;
  result?: JobResult;
}

export interface LandCoverClass {
  code: number;
  name: string;
  pixels: number;
  area_km2: number;
  share_pct: number;
}

export interface LandCoverStatistics {
  year: number;
  municipality_id: string;
  crs_used: string;
  pixel_area_m2: number;
  total_pixels: number;
  classes: LandCoverClass[];
  unclassified_pct: number;
  cloud_or_nodata_pct: number;
  data_quality_flags: string[];
  provenance_id?: string;
}

export interface Transition {
  from_code: number;
  from_class: string;
  to_code: number;
  to_class: string;
  pixels: number;
  area_km2: number;
  pct_of_source: number;
  priority_flag: boolean;
}

export interface NetChange {
  code: number;
  class_name: string;
  delta_km2: number;
  delta_pct: number;
}

export interface TrendPoint {
  year: number;
  classes: LandCoverClass[];
}

export interface CagrEntry {
  code: number;
  class_name: string;
  cagr_pct: number;
}

export interface ChangeMatrix {
  municipality_id: string;
  from_year: number;
  to_year: number;
  transitions: Transition[];
  net_change: NetChange[];
  trend_series: TrendPoint[];
  cagr?: CagrEntry[];
  confidence_note: string;
  provenance_id?: string;
}

export interface EvidenceStatement {
  transition_from: string;
  transition_to: string;
  claim: string;
  metric?: string;
  baseline?: string;
  effect_size?: number;
  ci_95_low?: number;
  ci_95_high?: number;
  strength: EvidenceStrength;
  sources: string[];
  reason?: string;
}

export interface CheckResult {
  id: string;
  status: CheckStatus;
  detail: string;
  annotation?: string;
}

export interface JobResult {
  job_id: string;
  status: JobStatus;
  statistics?: LandCoverStatistics[];
  change_matrix?: ChangeMatrix[];
  evidence?: EvidenceStatement[];
  artefacts?: {
    pdf?: { url: string };
    docx?: { url: string };
    xlsx?: { url: string };
    map_bundle?: { url: string };
    comparison_map?: { url: string };
    change_map?: { url: string };
    forest_change_4class?: { url: string };
    trend_chart?: { url: string };
    sankey?: { url: string };
  };
  validation?: {
    verdict: "pass" | "warn" | "block";
    checks: CheckResult[];
  };
}

export interface StageEvent {
  job_id: string;
  stage: string;
  status: "queued" | "running" | "complete" | "failed" | "partial";
  pct: number;
  eta_s?: number;
}

export interface ProvinceStats {
  province: string;
  analyzed: number;
  total: number;
}

export interface ProvinceInfo {
  province: string;
  municipality_count: number;
  district_count: number;
  total_area_km2: number;
  population: number;
  geometry?: GeoJSON.MultiPolygon | GeoJSON.Polygon;
}

export interface DistrictInfo {
  district: string;
  province: string;
  municipality_count: number;
  total_area_km2: number;
  population: number;
  geometry?: GeoJSON.MultiPolygon | GeoJSON.Polygon;
}

/** A custom land-cover class group (merged from one or more ICIMOD codes). */
export interface CustomClassGroup {
  id: string;
  name: string;
  codes: number[];
  color: string;
}

export interface RecentJob {
  job_id: string;
  municipality_name: string;
  status: string;
  created_at: string | null;
  completed_at: string | null;
}

export interface DashboardStats {
  total_municipalities: number;
  analyzed_count: number;
  coverage_pct: number;
  provinces: ProvinceStats[];
  recent_jobs: RecentJob[];
  job_counts: Record<string, number>;
}
