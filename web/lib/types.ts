export type StationStatus = "active" | "discontinued";

export interface DataRange {
  year_from: number;
  year_to: number;
  record_length: number;
}

export interface Station {
  station_number: string;
  name: string;
  province: string;
  status: StationStatus;
  latitude: number;
  longitude: number;
  drainage_area_gross_km2: number | null;
  drainage_area_effective_km2: number | null;
  regulated: boolean | null;
  rhbn: boolean;
  real_time: boolean;
  datum: string | null;
  data_ranges: {
    flow?: DataRange;
    level?: DataRange;
  };
}

export interface CatalogMeta {
  hydat_version: string;
  generated_at: string;
  station_count: number;
}

export interface DailyPoint {
  date: string;
  value: number | null;
  symbol: string | null;
}

export interface DailyResponse {
  station_id: string;
  variable: "discharge" | "level";
  unit: string;
  series: DailyPoint[];
  meta: { count: number; start: string; end: string };
}

export interface PeakPoint {
  year: number;
  value: number;
  date?: string;
  symbol: string | null;
}

export interface PeaksResponse {
  station_id: string;
  variable: "discharge" | "level";
  peak_code: "max" | "min";
  unit: string;
  peaks: PeakPoint[];
}

export interface FrequencyQuantile {
  return_period: number;
  aep: number;
  value: number;
  ci_lower: number | null;
  ci_upper: number | null;
}

export interface GoodnessOfFit {
  ks_stat: number;
  ks_pvalue: number;
  ad_stat: number;
  aic: number;
  bic: number;
  rmse: number;
}

export interface DistributionResult {
  key: string;
  label: string;
  estimation_method: string;
  parameters: Record<string, number>;
  quantiles: FrequencyQuantile[];
  curve: { return_period: number; value: number }[];
  goodness_of_fit: GoodnessOfFit;
  fit_error: string | null;
}

export interface PlottingPoint {
  year: number;
  value: number;
  exceedance_prob: number;
  return_period: number;
}

export interface FfaWarning {
  level: "info" | "caution" | "warning" | "error";
  code: string;
  message: string;
}

export interface FrequencyResponse {
  n_years: number;
  years_used: number[];
  excluded: { year: number; reason: string }[];
  warnings: FfaWarning[];
  plotting_positions: PlottingPoint[];
  distributions: DistributionResult[];
  best_fit: string | null;
  best_fit_metric: string;
  too_few_years?: boolean;
}

export interface FrequencyRequest {
  distributions: string[];
  estimation_method: "lmoments" | "mom";
  plotting_position: "cunnane" | "weibull" | "gringorten";
  return_periods: number[];
  exclude_estimated: boolean;
  confidence_level: number;
  ci_method: "bootstrap" | "none";
  bootstrap_samples: number;
  /** Optional pre-filtered peak list; if supplied the API skips its own OGC fetch. */
  peaks?: PeakPoint[];
}
