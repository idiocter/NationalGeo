// ICIMOD Nepal 11-class Land Cover system (codes 1–11; 0 = nodata)
export const CLASS_COLOURS: Record<number, string> = {
  0: "#cccccc",
  1: "#4a90d9",
  2: "#f5d44e",
  3: "#a8c97f",
  4: "#1a7a4a",
  5: "#90d44b",
  6: "#c4b28a",
  7: "#e8f4f8",
  8: "#d63b2f",
  9: "#5da06f",
  10: "#8b7355",
  11: "#b0b0b0",
};

export const CLASS_NAMES: Record<number, string> = {
  0: "NoData",
  1: "Water Body",
  2: "Cultivated Land",
  3: "Shrubland",
  4: "Forest",
  5: "Grassland",
  6: "Barren Land",
  7: "Snow/Ice/Glacier",
  8: "Settlement",
  9: "Open Woodland",
  10: "Rocky/Bare Ground",
  11: "Others",
};

export const STAGE_LABELS: Record<string, string> = {
  orchestrator: "Initialising",
  raster_analysis: "Analysing land cover",
  change_detection: "Detecting changes",
  evidence: "Finding evidence",
  cartography: "Rendering maps",
  narrative: "Writing report",
  validation: "Validating results",
  report: "Assembling report",
};

export const DEFAULT_DATASET_VERSION = "landcover-v3.1";
export const DEFAULT_BOUNDARY_VERSION = "mof-2021";

// 5-year ICIMOD Nepal land-cover series
export const ANALYSIS_YEARS: number[] = [2000, 2005, 2010, 2015, 2020];
