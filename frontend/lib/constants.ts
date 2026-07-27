// ICIMOD Nepal 11-class Land Cover system (codes 1–11; 0 = nodata)
// Verified against national VAT pixel counts: code 2 = Snow (3.1% = Nepal glacier ~3.4%),
// code 7 = Cultivated (23.4% = Nepal ag land ~21%). Codes 2/7 and 3/6 were previously swapped.
export const CLASS_COLOURS: Record<number, string> = {
  0:  "#cccccc",
  1:  "#4a90d9",  // Water Body
  2:  "#b0d6eb",  // Snow/Ice/Glacier
  3:  "#c4b28a",  // Barren Land
  4:  "#1a7a4a",  // Forest
  5:  "#90d44b",  // Grassland
  6:  "#a8c97f",  // Shrubland
  7:  "#f5d44e",  // Cultivated Land
  8:  "#d63b2f",  // Settlement
  9:  "#5da06f",  // Open Woodland
  10: "#8b7355",  // Rocky/Bare Ground
  11: "#b0b0b0",  // Others
};

export const CLASS_NAMES: Record<number, string> = {
  0:  "NoData",
  1:  "Water Body",
  2:  "Snow/Ice/Glacier",
  3:  "Barren Land",
  4:  "Forest",
  5:  "Grassland",
  6:  "Shrubland",
  7:  "Cultivated Land",
  8:  "Settlement",
  9:  "Open Woodland",
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

// Forest-area binary classification:
// Forest + Grassland + Shrubland + Cultivated Land + Open Woodland
export const FOREST_CODES = new Set([4, 5, 6, 7, 9]);
export const FOREST_COLOUR     = "#2d6a4f";  // deep green
export const NON_FOREST_COLOUR = "#c8b79c";  // warm tan
