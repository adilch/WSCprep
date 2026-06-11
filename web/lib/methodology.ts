/**
 * Methodology descriptions for every analysis tab.
 *
 * Each entry contains:
 *  - title       : short heading shown inside the accordion
 *  - paragraphs  : 2–4 plain-English paragraphs describing the method
 *  - references  : optional citation list (text + optional URL)
 */

export interface MethodologyRef {
  text: string;
  url?: string;
}

export interface MethodologyEntry {
  title:      string;
  paragraphs: string[];
  references?: MethodologyRef[];
}

// Keys match the tab identifier strings used in HistoricDataView and FrequencyView.
export type MethodologyKey =
  | "hydrograph"
  | "fdc"
  | "regime"
  | "annual"
  | "lowflow"
  | "stats"
  | "peaks"
  | "freq"
  | "table"
  | "gof"
  | "trend"
  | "pot"
  | "transfer";

export const METHODOLOGY: Record<MethodologyKey, MethodologyEntry> = {

  // ── Historic Data ──────────────────────────────────────────────────────────

  hydrograph: {
    title: "Daily Hydrograph",
    paragraphs: [
      "The hydrograph plots daily mean discharge (or water level) recorded at the gauging station. Water Survey of Canada (WSC) operates a network of automated stations that measure river stage continuously; discharge is then calculated by applying a rating curve — an empirically derived relationship between stage and flow — to convert stage records to discharge in m³/s.",
      "Data symbols flag quality or estimation status: E (Estimated) indicates discharge was inferred from incomplete stage data or rating-curve extrapolation; B (Ice-affected) means the rating curve may not apply due to ice backwater; D (Dry) indicates no measurable flow. Estimated values can introduce uncertainty, particularly at high flows where rating curves are extrapolated beyond the range of direct measurements.",
      "When baseflow separation is enabled, a recursive digital filter is applied to the daily discharge series. The Lyne-Hollick (1979) filter uses a single recession parameter α (default 0.925) run in three forward-backward-forward passes to remove phase lag, following Nathan & McMahon (1990). The Eckhardt (2005) two-parameter filter additionally requires a maximum baseflow index (BFImax), which reflects the long-term fraction of flow attributed to groundwater. The Baseflow Index (BFI = Σ baseflow / Σ total discharge) is displayed as a summary statistic.",
    ],
    references: [
      { text: "Environment and Climate Change Canada — HYDAT Database (Environment Canada, updated annually)", url: "https://collaboration.cmc.ec.gc.ca/cmc/hydrometrics/www/" },
      { text: "Lyne, V. & Hollick, M. (1979). Stochastic time-variable rainfall–runoff modelling. Proc. Hydrol. Water Resour. Symp., Perth, Australia, 89–92." },
      { text: "Nathan, R.J. & McMahon, T.A. (1990). Evaluation of automated techniques for base flow and recession analyses. Water Resour. Res., 26(7), 1465–1473.", url: "https://doi.org/10.1029/WR026i007p01465" },
      { text: "Eckhardt, K. (2005). How to construct recursive digital bandpass filters for baseflow separation. Hydrol. Process., 19(2), 507–515.", url: "https://doi.org/10.1002/hyp.5675" },
    ],
  },

  fdc: {
    title: "Flow Duration Curve (FDC)",
    paragraphs: [
      "The Flow Duration Curve (FDC) is a cumulative frequency distribution that shows the percentage of time a given discharge is equalled or exceeded. It is constructed by sorting all non-zero daily discharge values in descending order and plotting each value against its exceedance probability (rank / total count × 100 %).",
      "The FDC is plotted on a logarithmic discharge axis because the range of natural flows often spans several orders of magnitude. Key reference points include Q50 (median flow, exceeded 50 % of the time), Q95 (low flow, exceeded 95 % of the time, widely used for environmental flow assessment), and Q5 (high flow, exceeded only 5 % of the time).",
      "The shape of the FDC reveals the hydrological character of a catchment. A steep curve indicates a flashy, rainfall-dominated regime where flows vary widely; a flat curve suggests strong groundwater contribution or regulation that buffers extremes. The FDC does not preserve temporal information — it only describes the statistical distribution of flows, not when they occur.",
    ],
    references: [
      { text: "Vogel, R.M. & Fennessey, N.M. (1994). Flow-duration curves. I: New interpretation and confidence intervals. J. Water Resour. Plan. Manag., 120(4), 485–504.", url: "https://doi.org/10.1061/(ASCE)0733-9496(1994)120:4(485)" },
      { text: "Smakhtin, V.U. (2001). Low flow hydrology: a review. J. Hydrol., 240(3–4), 147–186.", url: "https://doi.org/10.1016/S0022-1694(00)00340-1" },
    ],
  },

  regime: {
    title: "Annual Hydrological Regime",
    paragraphs: [
      "The annual regime plot characterises the seasonal pattern of flow by grouping all daily observations by their calendar day-of-year (1–366). For each day, statistics (mean, median, and selected percentile bands) are computed across all years of record. This removes individual storm events and reveals the underlying seasonal hydrological cycle driven by climate and basin storage.",
      "Percentile bands capture variability around the central tendency. The Q10–Q90 band encloses the middle 80 % of daily values at each point in the year; the Q25–Q75 band shows the interquartile range; the min–max band displays absolute extremes. The width of these bands reflects inter-annual variability — narrow bands indicate a consistent, predictable regime while wide bands suggest high year-to-year variability.",
      "Canadian rivers typically show a pronounced spring freshet driven by snowmelt, a summer low-flow period, and often a secondary autumn peak from rainfall. The regime plot helps identify critical periods for water resource planning: irrigation demand, fish habitat suitability windows, hydropower planning, and environmental flow assessments.",
    ],
    references: [
      { text: "Beven, K.J. (2012). Rainfall-Runoff Modelling: The Primer (2nd ed.). Wiley-Blackwell, Oxford." },
      { text: "Detterman, R.L. et al. (1988). Hydrological regimes in Canada and their relationship to climate. Environment Canada, Inland Waters Directorate." },
    ],
  },

  annual: {
    title: "Annual Statistics",
    paragraphs: [
      "The annual statistics table summarises key hydrological indicators computed separately for each calendar year in the selected period. The annual mean discharge reflects average conditions during the year; the annual maximum is the highest recorded daily mean value (note: this differs from the instantaneous peak used in flood frequency analysis); the annual minimum captures the most severe low-flow conditions.",
      "Annual volume is estimated as: V (Mm³) = mean daily discharge × number of valid daily records in that year × 86 400 s/day ÷ 10⁶. Years with significant data gaps will underestimate the true volume; a year should ideally have at least 300 valid days for a reliable volume estimate. The day count column allows users to identify incomplete years.",
      "Tracking annual statistics over time provides a first look at long-term changes in the hydrological regime — for example, declining annual minima may indicate increasing drought frequency, while rising annual means may reflect increased precipitation or reduced evapotranspiration.",
    ],
    references: [
      { text: "Environment and Climate Change Canada — HYDAT Database (annual updates).", url: "https://collaboration.cmc.ec.gc.ca/cmc/hydrometrics/www/" },
    ],
  },

  lowflow: {
    title: "Low-Flow Frequency Analysis (nQy)",
    paragraphs: [
      "Low-flow statistics describe the minimum average discharge sustained over a consecutive n-day window, expected to occur no more than once every y years. The nQy notation (e.g. 7Q10) is standard: '7' is the averaging window in days, '10' is the return period in years. The 7Q10 statistic — the lowest 7-day average flow with a 10-year recurrence interval — is the most widely used benchmark in Canadian water quality regulation and environmental flow assessments.",
      "The analysis extracts the annual n-day minimum by computing a rolling n-day average of daily discharge for each calendar year, then selecting the single lowest value. Years with fewer than 200 valid daily observations are excluded to avoid bias from heavily incomplete records. The resulting series of annual minima is then fitted to the Log-Normal distribution using the method of moments.",
      "From the fitted distribution, quantiles at standard return periods (2-yr, 5-yr, 10-yr) are extracted. The 2-year low flow (nQ2, approximately the median annual minimum) reflects normal dry-season conditions; the 10-year low flow (nQ10) represents a severe but not extreme drought. These values are used as design thresholds for water intake licences, wastewater dilution calculations, and minimum ecological flow requirements.",
    ],
    references: [
      { text: "Smakhtin, V.U. (2001). Low flow hydrology: a review. J. Hydrol., 240(3–4), 147–186.", url: "https://doi.org/10.1016/S0022-1694(00)00340-1" },
      { text: "Ontario Ministry of Environment and Climate Change (2015). Technical Guidance for Drinking Water Source Protection." },
      { text: "Canadian Water Quality Guidelines (CCME, updated). Low-flow frequency thresholds for dilution and aquatic habitat.", url: "https://ccme.ca/en/resources/canadian-environmental-quality-guidelines" },
    ],
  },

  stats: {
    title: "Descriptive Statistics",
    paragraphs: [
      "The descriptive statistics table summarises the distributional properties of all non-null daily values in the selected period. The mean and median together indicate the central tendency and whether the distribution is right-skewed (as is typical for discharge: mean > median). The percentiles Q5, Q10, Q90, and Q95 correspond to the values exceeded by 95 %, 90 %, 10 %, and 5 % of daily observations respectively.",
      "These statistics are computed over daily mean discharge values, not instantaneous flows. Instantaneous peaks during storms may be considerably higher than the recorded daily maximum. Missing data (gaps in the record) are excluded from all calculations — the 'Days' count shows how many daily values contributed to the statistics.",
      "Q95 and Q90 are commonly used as low-flow indicators in environmental flow assessments; Q5 and Q10 describe high-flow conditions relevant to flood risk. The difference between mean and median reveals skewness: highly skewed distributions (common in arid or flashy regimes) make the median a more representative measure of typical conditions than the mean.",
    ],
    references: [
      { text: "Helsel, D.R. & Hirsch, R.M. (2002). Statistical Methods in Water Resources. USGS Techniques of Water-Resources Investigations, Book 4, Chapter A3.", url: "https://pubs.usgs.gov/twri/twri4a3/" },
    ],
  },

  // ── Flood Frequency Analysis ───────────────────────────────────────────────

  peaks: {
    title: "Annual Maximum Series (AMS)",
    paragraphs: [
      "The Annual Maximum Series (AMS) is the most widely used approach to flood frequency analysis in Canada and internationally. It consists of exactly one peak — the highest instantaneous discharge in each year — recorded from continuous stage hydrographs by WSC field staff. Using the single highest peak per year guarantees independence between observations, which is a key statistical assumption for frequency analysis.",
      "AMS-based flood frequency analysis rests on two fundamental assumptions: (1) independence — each annual peak is the result of independent storms, and (2) stationarity — the statistical properties of peaks do not change over time due to land-use change, climate change, or regulation. The Trend Analysis tab tests the stationarity assumption using the Mann-Kendall test.",
      "Peaks labelled with the symbol E (Estimated) were computed by extrapolating the rating curve beyond the range where direct discharge measurements exist. These values carry greater uncertainty and can optionally be excluded from the analysis. The year-range selector and individual year checkboxes allow you to customise the data set used — for example, to remove years affected by major regulation changes.",
    ],
    references: [
      { text: "England, J.F. et al. (2019). Bulletin 17C — Guidelines for Determining Flood Flow Frequency. USGS Techniques and Methods 4-B5.", url: "https://doi.org/10.3133/tm4B5" },
      { text: "Environment and Climate Change Canada — HYDAT Database.", url: "https://collaboration.cmc.ec.gc.ca/cmc/hydrometrics/www/" },
    ],
  },

  freq: {
    title: "Flood Frequency Plot — Fitted Probability Distributions",
    paragraphs: [
      "The frequency plot shows the observed annual peaks at their plotting positions alongside the fitted theoretical distributions. Plotting positions translate each ranked observation into an empirical exceedance probability: the Cunnane (1978) formula is used by default — P = (i − 0.4) / (n + 0.2), where i is the rank in ascending order and n is the number of peaks. The corresponding return period is 1 / P.",
      "Five distributions are available: GEV (Generalised Extreme Value, the limit distribution for block maxima), GLO (Generalised Logistic, recommended by the UK Flood Estimation Handbook), Gumbel (EV1, a special case of GEV with shape = 0), LP3 (Log-Pearson Type III, the standard in the USA per Bulletin 17C), and PE3 (Pearson Type III). All are fitted by L-moments by default — linear combinations of order statistics that are more robust than conventional moments for small samples and heavy-tailed distributions.",
      "The best-fit distribution (★) is selected by the Akaike Information Criterion (AIC), which balances fit quality with model parsimony. Shaded confidence bands around the best-fit line are derived by parametric bootstrap (2000 samples), reflecting uncertainty in parameter estimation. Wide bands at long return periods indicate high uncertainty — common when only a short record is available.",
    ],
    references: [
      { text: "Hosking, J.R.M. & Wallis, J.R. (1997). Regional Frequency Analysis: An Approach Based on L-Moments. Cambridge University Press.", url: "https://doi.org/10.1017/CBO9780511529443" },
      { text: "Cunnane, C. (1978). Unbiased plotting positions — a review. J. Hydrol., 37(3–4), 205–222.", url: "https://doi.org/10.1016/0022-1694(78)90017-3" },
      { text: "Rao, A.R. & Hamed, K.H. (2000). Flood Frequency Analysis. CRC Press, Boca Raton." },
    ],
  },

  table: {
    title: "Design Flood Quantile Estimates",
    paragraphs: [
      "Design floods are the discharges associated with specific return periods (also called recurrence intervals). The T-year design flood is the discharge that is expected to be equalled or exceeded, on average, once every T years. Equivalently, it has an Annual Exceedance Probability (AEP) of 1/T — for example, the 100-year flood has AEP = 1 % per year.",
      "Quantiles are obtained by inverting the fitted probability distribution at each AEP. The 90 % confidence intervals shown in brackets are derived by parametric bootstrap resampling: 2 000 synthetic peak series are generated from the fitted distribution, the distribution is re-fitted to each, and the 5th and 95th percentiles of the resulting quantile estimates form the bounds. Narrow intervals indicate a well-constrained fit; wide intervals (common at long return periods or with short records) warn that design values carry substantial uncertainty.",
      "In practice, engineering design often specifies a target return period — 1:100 for urban stormwater, 1:200 for major infrastructure, 1:10 000 for dam safety. Regulated stations may produce design floods that do not reflect natural flood potential; results should be used with the regulation context in mind.",
    ],
    references: [
      { text: "Hosking, J.R.M. & Wallis, J.R. (1997). Regional Frequency Analysis. Cambridge University Press." },
      { text: "Chow, V.T., Maidment, D.R. & Mays, L.W. (1988). Applied Hydrology. McGraw-Hill, New York." },
      { text: "Natural Resources Canada — Flood Damage Reduction Program guidelines." },
    ],
  },

  gof: {
    title: "Goodness-of-Fit Tests",
    paragraphs: [
      "Goodness-of-fit (GoF) tests assess how well each candidate distribution reproduces the observed sample. No single test is definitive; multiple criteria together give a more robust picture.",
      "The Kolmogorov-Smirnov (KS) test measures the maximum absolute difference between the empirical and theoretical CDFs across all observed values. The Anderson-Darling (AD) test is a weighted variant that places greater emphasis on the tails of the distribution — this is particularly important for flood estimation, where the fit at high quantiles matters most. A low p-value (< 0.05) for either test suggests the distribution is a statistically poor fit.",
      "AIC (Akaike Information Criterion) and BIC (Bayesian Information Criterion) are information-theoretic measures that penalise model complexity: AIC = 2k − 2 ln(L) where k is the number of parameters and L is the maximised likelihood. The distribution with the lowest AIC is automatically selected as the best fit (★). AIC is preferred over formal hypothesis tests for model selection because it explicitly rewards parsimony. RMSE (Root Mean Square Error) quantifies the average prediction error between the fitted quantiles and the observed plotting positions.",
    ],
    references: [
      { text: "Anderson, T.W. & Darling, D.A. (1952). Asymptotic theory of certain goodness-of-fit criteria based on stochastic processes. Ann. Math. Stat., 23(2), 193–212.", url: "https://doi.org/10.1214/aoms/1177729437" },
      { text: "Akaike, H. (1974). A new look at the statistical model identification. IEEE Trans. Automat. Control, 19(6), 716–723.", url: "https://doi.org/10.1109/TAC.1974.1100705" },
      { text: "Schwarz, G. (1978). Estimating the dimension of a model. Ann. Stat., 6(2), 461–464.", url: "https://doi.org/10.1214/aos/1176344136" },
    ],
  },

  trend: {
    title: "Trend Analysis — Mann-Kendall Test & Sen's Slope",
    paragraphs: [
      "The Mann-Kendall (MK) test is a non-parametric rank-based method for detecting monotonic trends in a time series. It tests whether the ranks of the observations tend to increase (positive Kendall τ) or decrease (negative τ) over time. Being non-parametric, it requires no assumption about the distribution of the data, only independence between observations. Significance is assessed at α = 0.05 (two-tailed): |z| > 1.96 indicates a statistically significant trend.",
      "Sen's slope is a robust, non-parametric estimator of trend magnitude: it is the median of all pairwise slopes (y_j − y_i)/(t_j − t_i) across all pairs i < j. Unlike ordinary least squares regression, Sen's slope is resistant to outliers — a single extreme flood year does not distort the estimated rate of change. The trend line shown on the chart uses Sen's slope through the median of the data.",
      "The Sequential Mann-Kendall (Sneyers) test applies MK progressively forward (u(t)) and backward (u′(t)) through the time series. The intersection of these two curves near the ±1.96 significance lines estimates the year when a change in trend direction began — useful for attributing trends to specific events such as land-use change or the construction of upstream dams. A statistically significant trend in annual peaks is an important warning flag: flood frequency analysis assumes stationarity (unchanging statistics over time), and non-stationarity can lead to unreliable design flood estimates.",
    ],
    references: [
      { text: "Mann, H.B. (1945). Nonparametric tests against trend. Econometrica, 13(3), 245–259.", url: "https://doi.org/10.2307/1907187" },
      { text: "Kendall, M.G. (1975). Rank Correlation Methods (4th ed.). Charles Griffin, London." },
      { text: "Sen, P.K. (1968). Estimates of the regression coefficient based on Kendall's tau. J. Am. Stat. Assoc., 63(324), 1379–1389.", url: "https://doi.org/10.1080/01621459.1968.10480934" },
      { text: "Sneyers, R. (1990). On the Statistical Analysis of Series of Observations. WMO Technical Note No. 143, Geneva." },
    ],
  },

  pot: {
    title: "Peaks-Over-Threshold (POT) Analysis — Generalised Pareto Distribution",
    paragraphs: [
      "The Peaks-Over-Threshold (POT) method, also called Partial Duration Series analysis, uses every discharge event that exceeds a user-defined threshold — not just the single largest event per year. This yields more information per year of record than the Annual Maximum Series (AMS) approach, which is particularly valuable for stations with short records. The trade-off is that threshold selection involves a subjective decision, and events must be screened for independence.",
      "Independence between successive events is enforced by two criteria applied in sequence. First, events are identified as continuous runs of days with discharge above the threshold; within each run, only the day-maximum is retained as a candidate peak. Second, a minimum separation gap filter discards any candidate that occurs within the specified number of days of the previous accepted peak. Typical values are 3–14 days depending on catchment response time.",
      "The Generalised Pareto Distribution (GPD) is the theoretically appropriate distribution for threshold exceedances under extreme value theory. Parameters (shape ξ and scale σ) are estimated by the method of L-moments — closed-form expressions that are computationally efficient and more robust than maximum likelihood for small samples. Assuming events arrive as a Poisson process at mean rate λ events/year, the T-year design flood is: x_T = u + (σ/ξ)·((λT)^ξ − 1) for ξ ≠ 0, or u + σ·ln(λT) for ξ = 0 (exponential special case), where u is the threshold. A minimum of 15 peaks is required for a reliable fit.",
    ],
    references: [
      { text: "Davison, A.C. & Smith, R.L. (1990). Models for exceedances over high thresholds. J. Roy. Stat. Soc. B, 52(3), 393–442.", url: "https://doi.org/10.1111/j.2517-6161.1990.tb01796.x" },
      { text: "Hosking, J.R.M. & Wallis, J.R. (1987). Parameter and quantile estimation for the generalized Pareto distribution. Technometrics, 29(3), 339–349.", url: "https://doi.org/10.2307/1269343" },
      { text: "Coles, S. (2001). An Introduction to Statistical Modeling of Extreme Values. Springer, London.", url: "https://doi.org/10.1007/978-1-4471-3675-0" },
      { text: "Madsen, H., Rasmussen, P.F. & Rosbjerg, D. (1997). Comparison of annual maximum series and partial duration series methods for modeling extreme hydrologic events. Water Resour. Res., 33(4), 747–757.", url: "https://doi.org/10.1029/96WR03848" },
    ],
  },

  transfer: {
    title: "Area-Ratio Transfer to Ungauged Sites",
    paragraphs: [
      "Most project sites are not at a gauged location. The area-ratio (drainage-area scaling) method transfers flood quantiles from a gauged donor station to an ungauged site on the assumption that flood magnitude scales with contributing drainage area: Q_site = Q_donor × (A_site / A_donor)^n. The exponent n reflects how flood-producing mechanisms attenuate with basin size — values for Canadian basins typically fall between 0.6 and 0.9, with 0.75 a common default where no regional study exists. Where a provincial or regional flood-frequency study publishes a calibrated exponent, that value should be preferred.",
      "The method is most defensible when the donor and the ungauged site are on the same stream or in hydrologically similar adjacent basins, with comparable physiography, land cover, and climate. Reliability degrades quickly as the area ratio departs from unity; a commonly cited validity range is roughly 0.2 to 5 times the donor's drainage area. Outside that range — or where the donor is regulated, or the basins differ in lake storage or urbanisation — a regional regression or rainfall-runoff modelling approach is more appropriate.",
      "Confidence intervals shown alongside the scaled quantiles are the donor station's bootstrap intervals multiplied by the same scale factor. They therefore capture only the statistical uncertainty of the donor fit — not the (often larger) uncertainty introduced by the transfer assumption itself. Scaled estimates should be treated as preliminary planning values and verified with an independent method before final design.",
    ],
    references: [
      { text: "Watt, W.E. (ed.) (1989). Hydrology of Floods in Canada: A Guide to Planning and Design. National Research Council of Canada, Ottawa." },
      { text: "Gingras, D. & Adamowski, K. (1993). Homogeneous region delineation based on annual flood generation mechanisms. Hydrol. Sci. J., 38(2), 103–121.", url: "https://doi.org/10.1080/02626669309492649" },
      { text: "Emerson, D.G., Vecchia, A.V. & Dahl, A.L. (2005). Evaluation of drainage-area ratio method used to estimate streamflow for the Red River of the North Basin. USGS Scientific Investigations Report 2005-5017.", url: "https://doi.org/10.3133/sir20055017" },
    ],
  },
};
