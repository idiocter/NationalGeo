export const CLASS_COLOURS: Record<number, string> = {
  0: "#cccccc",
  1: "#1a7a4a",
  2: "#f5d44e",
  3: "#3b89c9",
  4: "#90d44b",
  5: "#a8c97f",
  6: "#d63b2f",
  7: "#c4b28a",
  8: "#f0f0f0",
};

export const CLASS_NAMES: Record<number, string> = {
  0: "NoData",
  1: "Forest",
  2: "Agriculture",
  3: "Water",
  4: "Grassland",
  5: "Open woodland",
  6: "Built-up",
  7: "Barren",
  8: "Snow",
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
export const ANALYSIS_YEARS = [2000, 2022];
