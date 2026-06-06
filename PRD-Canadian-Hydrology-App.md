# Product Requirements Document — Canadian Hydrometric Data & Flood Frequency Analysis Web App

**Version:** 1.0
**Status:** Ready for development
**Audience:** Implementing engineer / coding LLM (Qwen Coder)
**Author:** (Product owner — water resources engineer)

---

## 0. How to read this document

This PRD is written to be implemented end-to-end. It specifies the product, the architecture, the data layer, every screen, the statistical methodology for flood frequency analysis, the API contracts, and acceptance criteria.

A few conventions:

- **MUST / SHOULD / MAY** follow RFC-2119 meaning.
- Field and property names taken from external APIs are marked **(verify against live schema)**. The implementer **MUST** confirm exact property names by calling the relevant `…/queryables` and `…/items?limit=1` endpoints before hardcoding them, because the upstream provider can rename fields.
- All hydrologic quantities use **SI units**: discharge in **m³/s**, water level/stage in **m**, drainage area in **km²**.
- Build the app in **phases** (Section 18). Each phase has acceptance criteria.

---

## 1. Summary

A web application for Canadian hydrologists and water resources engineers. Users search for and browse **Water Survey of Canada (WSC)** hydrometric gauges on an interactive map, select a station, and open one of two analysis views:

1. **Historic Data Analysis** — daily mean discharge/level over the full period of record: interactive hydrograph, flow-duration curve, mean annual regime, and summary statistics.
2. **Flood Frequency Analysis (FFA)** — fit standard extreme-value distributions to the station's **annual maximum instantaneous peak** series and report design flood magnitudes (return-period discharges) with a probability plot, goodness-of-fit, and confidence intervals.

The UI is clean, content-first, and uncluttered (visual inspiration: the `tidyhydat` documentation site — minimal, documentation-style, generous whitespace). Built with **Tailwind CSS**.

---

## 2. Target users & primary use cases

**Users:** Hydrologists, water resources / civil engineers, watershed scientists, students. Comfortable with hydrology terminology (return period, AEP, flow-duration curve, regulated vs natural flow).

**Use cases**

1. "Find the gauge nearest my project / on this river and see what data exists." → Map search + station metadata.
2. "Show me the flow record and flow regime for this station." → Historic Data Analysis.
3. "Estimate the 100-year flood (Q100) at this gauge and tell me how trustworthy it is." → Flood Frequency Analysis.
4. "Export the data / chart to drop into a report." → CSV + PNG export.

---

## 3. Goals & non-goals

### Goals (v1)

- Map-based discovery of all WSC stations with search and filtering.
- Rich, trustworthy station metadata (status, regulation, drainage area, datum, record length).
- A clean Historic Data Analysis view (hydrograph, FDC, regime, stats).
- A rigorous, defensible Flood Frequency Analysis view (multiple distributions, plotting positions, return-period quantiles, confidence intervals, goodness-of-fit).
- CSV + PNG export.
- Shareable/bookmarkable station URLs.

### Non-goals (v1) — candidates for later

- Real-time / provisional "current conditions" data (historical, quality-controlled data only in v1).
- User accounts, saved stations, or authentication.
- Bilingual (FR/EN) UI — **English only** in v1 (architect strings so i18n can be added later).
- Regional / regression-based flood frequency (RFFA), pooled/regional analysis.
- Low-flow frequency analysis, drought indices, water-quality or sediment data.
- Trend/non-stationarity modelling beyond a simple optional Mann-Kendall test on the historic page.
- Mobile-native apps (the web app SHOULD be responsive, but desktop is the primary target).

---

## 4. Tech stack (locked)

| Layer | Choice |
|---|---|
| Frontend framework | **Next.js (App Router) + TypeScript + React** |
| Styling | **Tailwind CSS** |
| Map | **Leaflet** (`react-leaflet`) + **`leaflet.markercluster`** for clustering |
| Basemap tiles | OpenStreetMap (free) — attribution required. (MAY add a topographic option later.) |
| Charts | **Plotly** (`react-plotly.js`) — gives log axes, probability/return-period axes, zoom/pan, and PNG export out of the box |
| Statistics service | **Small Python service (FastAPI)** — pure-compute FFA engine using `numpy`, `scipy`, `lmoments3` |
| Frontend ↔ backend | Frontend talks **only** to Next.js API routes (a BFF/proxy layer). Next.js proxies the upstream data API and calls the Python FFA service. |
| Package mgmt | `pnpm` (or `npm`) for web; `uv` or `pip` + `requirements.txt` for the Python service |
| Deployment | Frontend on Vercel (or any Node host); Python service as a container / serverless function. Both MUST be configurable via environment variables — no hardcoded URLs. |

**Rationale for the BFF pattern:** the browser never calls the upstream API or the Python service directly. This centralizes caching, avoids CORS issues, hides upstream field-naming churn behind a stable internal contract, and keeps the Python service stateless and trivial to deploy.

---

## 5. System architecture

```
┌──────────────────────────┐
│  Browser (Next.js + React)│
│  Leaflet map • Plotly charts • Tailwind UI
└────────────┬─────────────┘
             │  (internal JSON API only)
             ▼
┌──────────────────────────┐
│  Next.js API routes (BFF) │
│  • serve static station catalog
│  • proxy + cache ECCC OGC time-series
│  • orchestrate FFA (fetch peaks → call Python → return result)
└──────┬───────────────┬────┘
       │               │
       ▼               ▼
┌───────────────┐  ┌─────────────────────┐
│ ECCC GeoMet   │  │ Python FFA service   │
│ OGC API       │  │ (FastAPI, stateless) │
│ (GeoJSON)     │  │ distribution fitting │
└───────────────┘  └─────────────────────┘

Build-time (offline, refreshed quarterly):
┌──────────────────────────┐
│ Catalog builder script    │  HYDAT SQLite → enriched stations.json
└──────────────────────────┘
```

Three deployable pieces + one offline build step:

1. **`web/`** — Next.js app (UI + BFF API routes).
2. **`ffa-service/`** — FastAPI statistics service.
3. **`scripts/build-catalog/`** — offline script that produces the static station catalog.
4. Static artifact: **`stations.json`** (the station catalog), shipped with `web/`.

---

## 6. Data layer

### 6.1 Sources

WSC hydrometric data is published by Environment and Climate Change Canada (ECCC) / Meteorological Service of Canada (MSC). Two sources are used:

**A. ECCC GeoMet-OGC-API — live time-series (runtime).**
Base URL: `https://api.weather.gc.ca`. Standard: **OGC API – Features**. Output: **GeoJSON** `FeatureCollection`. Supports filtering by property, `bbox`, `datetime`, and pagination (`limit`, `offset`). Relevant collections:

| Collection | Use in this app |
|---|---|
| `hydrometric-stations` | Station metadata + coordinates (supplementary; primary catalog is the static file — see 6.2) |
| `hydrometric-daily-mean` | **Historic Data Analysis** — full period-of-record daily mean discharge & level |
| `hydrometric-annual-peaks` | **Flood Frequency Analysis** — annual **maximum/minimum instantaneous** discharge & level |
| `hydrometric-monthly-mean` | Optional: monthly mean discharge/level (regime view) |
| `hydrometric-annual-statistics` | Optional: annual max/min of *daily* values |
| `hydrometric-realtime` | **Not used in v1** (future "current conditions") |

**B. HYDAT SQLite — station metadata (build-time only).**
The authoritative WSC database is distributed as a SQLite file (`Hydat.sqlite3`), updated roughly quarterly, available from the MSC Datamart hydrometrics directory (`http://collaboration.cmc.ec.gc.ca/cmc/hydrometrics/www/`). The `tidyhydat` R package documents this database and its `download_hydat()` retrieves it. We use it **once, offline**, to build the enriched station catalog (6.2), because the live `hydrometric-stations` collection does not reliably expose drainage area, regulation status, datum, or per-data-type record ranges — all of which we need on the FFA page.

> **Licensing / attribution (MUST):** Display the ECCC data attribution and link to the ECCC Open Data end-user licence in the app footer and on export. Display OpenStreetMap attribution on the map. Do not imply endorsement by ECCC.

### 6.2 Static station catalog (`stations.json`)

A build-time script (`scripts/build-catalog/`) reads the HYDAT SQLite and emits a single `stations.json` consumed by the frontend for the map, search, filters, and the station metadata header. This makes the map render instantly (no API round-trip) and supplies metadata the live API lacks.

**HYDAT tables to read (verify column names against the HYDAT data dictionary):**

- `STATIONS` → `STATION_NUMBER`, `STATION_NAME`, `PROV_TERR_STATE_LOC`, `HYD_STATUS` (A=Active, D=Discontinued), `LATITUDE`, `LONGITUDE`, `DRAINAGE_AREA_GROSS`, `DRAINAGE_AREA_EFFECT`, `RHBN` (Reference Hydrometric Basin Network flag), `REAL_TIME`, `DATUM_ID`.
- `STN_REGULATION` → `STATION_NUMBER`, `REGULATED` (boolean), `YEAR_FROM`, `YEAR_TO`.
- `STN_DATA_RANGE` → `STATION_NUMBER`, `DATA_TYPE`, `YEAR_FROM`, `YEAR_TO`, `RECORD_LENGTH` (per data type: Q=Flow, H=Level, etc.).
- `DATUM_LIST` → resolve `DATUM_ID` to a datum name.
- `HYD_STATUS_CODES`, `DATA_TYPES` → human-readable code lookups.

**Output schema (`stations.json` is an array of):**

```jsonc
{
  "station_number": "05BB001",
  "name": "BOW RIVER AT BANFF",
  "province": "AB",
  "status": "active",                 // "active" | "discontinued"
  "latitude": 51.1722,
  "longitude": -115.5717,
  "drainage_area_gross_km2": 2210.0,  // nullable
  "drainage_area_effective_km2": null,// nullable
  "regulated": false,                 // nullable boolean
  "rhbn": true,                       // reference basin network
  "real_time": true,                  // has real-time feed (informational)
  "datum": "GEODETIC",                // nullable
  "data_ranges": {                    // per data type, nullable entries
    "flow":  { "year_from": 1909, "year_to": 2023, "record_length": 114 },
    "level": { "year_from": 1909, "year_to": 2023, "record_length": 114 }
  }
}
```

The builder SHOULD also emit `catalog_meta.json` with `{ "hydat_version": "...", "generated_at": "ISO-8601", "station_count": N }` so the UI can display the data vintage.

### 6.3 OGC API query patterns (runtime, via BFF)

All queries hit `https://api.weather.gc.ca/collections/{collection}/items` with `f=json`. The implementer MUST verify property names via `…/queryables`. Best-known property names (**verify against live schema**):

**Daily mean** (`hydrometric-daily-mean`): `STATION_NUMBER`, `DATE` (ISO date), `LEVEL` (m), `DISCHARGE` (m³/s), `LEVEL_SYMBOL_EN`, `DISCHARGE_SYMBOL_EN`.

Example (one station, date-bounded):
```
GET /collections/hydrometric-daily-mean/items
  ?STATION_NUMBER=05BB001
  &datetime=1900-01-01/2024-12-31
  &limit=10000
  &f=json
```

**Annual instantaneous peaks** (`hydrometric-annual-peaks`): `STATION_NUMBER`, `DATA_TYPE_EN` ("Discharge"/"Water Level"), `PEAK_CODE_EN` ("Maximum"/"Minimum"), `PEAK` (value), `DATE`/`TIME`, `SYMBOL_EN`, `UNITS`.

Example (annual maximum discharge peaks):
```
GET /collections/hydrometric-annual-peaks/items
  ?STATION_NUMBER=05BB001
  &limit=1000
  &f=json
# then filter client/server-side: DATA_TYPE_EN == "Discharge" AND PEAK_CODE_EN == "Maximum"
```

**Pagination (MUST):** the API caps `limit` per request. The BFF MUST page through using `limit` + `offset` (or follow `links[rel=next]`) and concatenate until all features are retrieved. Long daily records can exceed tens of thousands of rows.

> **Hydrology correctness (CRITICAL):** Flood frequency analysis MUST use the **pre-computed annual maximum *instantaneous* peaks** from `hydrometric-annual-peaks` (`DATA_TYPE_EN=Discharge`, `PEAK_CODE_EN=Maximum`). Do **NOT** recompute the annual maxima from `hydrometric-daily-mean`: instantaneous peaks are higher than daily means, and design floods require the instantaneous value.

### 6.4 Data quality symbols

WSC data carries quality symbols. Common HYDAT symbols (display verbatim; provide a legend/tooltip):

| Symbol | Meaning |
|---|---|
| `E` | Estimated |
| `A` | Partial day |
| `B` | Ice conditions |
| `D` | Dry |
| `R` | Revised |
| `S` | Sample(d) |
| (blank) | No qualifier |

**Requirements:**
- Daily/peak data points carrying a symbol MUST be visually distinguishable (e.g., marker outline / tooltip note).
- The FFA page MUST offer a toggle **"Exclude estimated (E) peaks"** (default: **excluded**), and report how many were excluded.

---

## 7. Information architecture & routes

| Route | Screen |
|---|---|
| `/` | **Map + search + filters** (landing) |
| `/stations/[stationId]` | **Station overview** (metadata header + links to the two analyses + small data-availability summary) |
| `/stations/[stationId]/daily` | **Historic Data Analysis** |
| `/stations/[stationId]/frequency` | **Flood Frequency Analysis** |
| `/about` | About / data sources / licence / methodology notes |

`[stationId]` is the WSC station number (e.g., `05BB001`) — this makes every analysis page **bookmarkable and shareable**. Analysis-page state that meaningfully changes results (selected distributions, plotting position, return periods, exclude-estimated, date range) SHOULD be reflected in URL query params so a link reproduces the view.

From the map, selecting a station opens its popup/side panel with two primary buttons: **"Historic Data Analysis"** and **"Flood Frequency Analysis"**, routing to the pages above. (Per the product concept: select a station → press a button → land on the chosen analysis page.)

---

## 8. Feature F1 — Map, search & filters (landing page)

### 8.1 Layout
- A prominent (near full-viewport) Leaflet map of Canada, default view fit to Canada's extent.
- A left/top **search bar** and a collapsible **filter panel**.
- A **station detail panel** (right side on desktop, bottom sheet on mobile) that appears when a station is selected.

### 8.2 Map behaviour
- Render all stations from `stations.json` as markers, **clustered** with `leaflet.markercluster` (there are ~2,700 active and ~5,100 discontinued stations, so clustering is required for performance and legibility).
- Marker styling encodes **status**: e.g., filled = active, hollow/grey = discontinued. Provide a small legend.
- Clicking a marker selects the station, opens a popup with name + number + province + status, and populates the detail panel.
- Reasonable performance target: initial map interactive in < 2 s on a typical broadband connection; smooth pan/zoom with clustering.

### 8.3 Search
- A single search input matching **station name OR station number** (case-insensitive, partial match). Debounced. Show a results dropdown (max ~10) with name, number, province; selecting an item flies the map to the station and selects it.
- Search runs client-side over the loaded catalog (no server round-trip).

### 8.4 Filters
- **Province/Territory** (multi-select).
- **Status** (Active / Discontinued).
- **Has data type** (Flow / Level).
- **Regulation** (Natural / Regulated / Unknown).
- **RHBN only** toggle (reference basin network).
- **Minimum record length (years)** slider (filters on max of available `record_length`).
- Filters update the visible markers and a live count ("Showing N of M stations").

### 8.5 Station detail panel
Shows: station number, name, province, **status badge**, **regulation badge**, drainage area (gross/effective, km²), datum, RHBN flag, and per-data-type record range + length (e.g., "Flow: 1909–2023, 114 yr"). Two buttons: **Historic Data Analysis** and **Flood Frequency Analysis**. A "Copy link" / "Open overview" affordance is nice-to-have.

### 8.6 Acceptance criteria
- All catalog stations render and cluster; selecting any marker shows correct metadata and working navigation buttons.
- Search finds stations by partial name and by number.
- Each filter and combination correctly narrows the visible set and updates the count.

---

## 9. Feature F2 — Station overview & shared station header

A **sticky station header** appears on `/stations/[stationId]`, `/daily`, and `/frequency`. It MUST show:

- Station number + name + province.
- **Status** badge (Active/Discontinued).
- **Regulation** badge — and when `regulated === true`, a visible caution that downstream statistics assume natural, stationary flow.
- Drainage area (gross; effective if present), km².
- Datum.
- RHBN flag.
- Record range & length per data type.
- Tabs/links: **Overview · Historic Data · Flood Frequency**.

The **Overview** body summarizes available data and links into the two analyses, plus a map thumbnail centered on the station.

---

## 10. Feature F3 — Historic Data Analysis (`/daily`)

Source: `hydrometric-daily-mean` (via BFF). Default variable: **Discharge (m³/s)**, with a toggle to **Water level (m)**.

### 10.1 Controls
- Variable toggle: Discharge / Level.
- Date range selector (default: full period of record). Quick presets: full record, last 30 years, last 10 years, custom.
- Log/linear toggle for the y-axis.

### 10.2 Visualizations (all Plotly, zoom/pan enabled, PNG export)

1. **Hydrograph** — time series of daily mean values over the selected range. Points/segments carrying a quality symbol are flagged. Gaps in the record are shown as gaps (do not interpolate across missing data).
2. **Flow-Duration Curve (FDC)** — daily flows sorted descending; x-axis = % time exceeded (0–100), y-axis = discharge (log scale default). Mark and label **Q5, Q10, Q50 (median), Q90, Q95** exceedance percentiles. (FDC for discharge only.)
3. **Mean annual regime** — mean (and optionally 25th–75th percentile band) of daily value by day-of-year across all complete years; communicates seasonal pattern (snowmelt freshet, etc.).
4. **Annual mean series** (optional) — one mean value per year as a bar/line; OPTIONAL **Mann-Kendall** trend test result (statistic, p-value, Sen's slope) displayed as a caption, clearly labelled exploratory.

### 10.3 Summary statistics panel
Table with: period of record (start–end), number of years (and number of complete years), count of days, **mean**, **median**, **min** (with date), **max** (with date), and exceedance percentiles (Q5/Q10/Q50/Q90/Q95). All in m³/s (or m).

### 10.4 Export
- **Download CSV** of the underlying daily series for the selected range (columns: `date, value, symbol`).
- **Download PNG** of any chart (Plotly native).

### 10.5 Empty/edge states
- Station has no daily data → friendly message and a link back to the map (and to FFA if peaks exist).
- Very long records → ensure pagination is fully consumed; show a subtle loading indicator while fetching.

### 10.6 Acceptance criteria
- Hydrograph, FDC, regime, and stats render correctly for a long-record station (e.g., a Bow River gauge) and for a short-record station.
- Variable toggle, date range, and log/linear all work and recompute the views.
- CSV matches what is plotted; PNG export works.

---

## 11. Feature F4 — Flood Frequency Analysis (`/frequency`)

This is the analytical centerpiece. Source: `hydrometric-annual-peaks`, `DATA_TYPE_EN=Discharge`, `PEAK_CODE_EN=Maximum` → the **annual maximum instantaneous discharge series (AMS)**. (A future toggle MAY support level or minima; v1 targets maximum discharge.)

### 11.1 Controls
- **Distributions** (multi-select; defaults all on): GEV, Generalized Logistic (GLO), Gumbel (EV1), Log-Pearson III (LP3), Pearson III (PE3).
- **Estimation method**: L-moments (default) | Method of moments. (Method of moments primarily relevant for LP3; see 12.)
- **Plotting position**: Cunnane (default) | Weibull | Gringorten.
- **Return periods (yr)**: default `[2, 5, 10, 20, 25, 50, 100, 200, 500]` (editable).
- **Exclude estimated (E) peaks**: default ON.
- **Confidence level**: 90% (default) | 95%.
- All controls recompute by calling the BFF FFA endpoint (Section 13).

### 11.2 Visualizations & outputs

1. **Annual peak series chart** — bar/scatter of peak instantaneous discharge vs year (the raw AMS). Estimated peaks flagged. Caption: number of years, range.
2. **Probability / frequency plot** (the key chart) — empirical points (AMS plotted at their plotting-position return periods) **plus** the fitted distribution curve(s). X-axis = **return period on a non-linear (Gumbel reduced-variate or probability) scale** with both Return Period (yr) and AEP labels; Y-axis = discharge (log option). Confidence band shown for the selected/best-fit distribution.
3. **Design flood table** — rows = return periods; columns = each fitted distribution's quantile (m³/s) with its lower/upper confidence bound. Also show AEP (= 1/T) per row. Highlight the **best-fit** distribution column.
4. **Goodness-of-fit table** — per distribution: parameters, KS statistic & p-value, Anderson–Darling statistic, AIC, BIC, RMSE (vs plotting positions). Indicate the ranking metric (AIC, lowest = best) and mark the best fit.
5. **Warnings panel** (prominent) — record length and reliability caveats (see 11.3).

### 11.3 Data-quality & reliability warnings (MUST)
- **Record length:** `< 10 yr` → strong red warning ("results unreliable"); `10–19 yr` → amber caution; `≥ 20 yr` acceptable; surface the exact count.
- **Regulation:** if station `regulated`, show a prominent caution that FFA assumes natural, stationary flow and that regulation may invalidate results.
- **Gaps / excluded peaks:** state how many years are in the AMS, how many estimated peaks were excluded, and any large gaps.
- **Extrapolation:** when a requested return period greatly exceeds the record length (e.g., Q500 from 25 years), flag that the estimate is a long extrapolation.
- **Low outliers** (OPTIONAL, phase 2): run a Grubbs–Beck low-outlier test and note flagged low outliers.

### 11.4 Export
- **Download CSV**: (a) the AMS (`year, peak_discharge_m3s, symbol, plotting_position_T`), and (b) the design-flood table (return period × distribution quantiles + CIs).
- **Download PNG**: frequency plot and peak-series chart.

### 11.5 Edge states
- Fewer than ~5 peaks → do not attempt fitting; show the series and a message that there are too few years for frequency analysis.
- No instantaneous peak data for the station → message + link to historic data page.

### 11.6 Acceptance criteria
- For a long-record natural station, all selected distributions fit, the frequency plot overlays empirical points and curves correctly, the design-flood table populates with CIs, and the best fit is identified by lowest AIC.
- Toggling distributions, plotting position, return periods, exclude-estimated, and confidence level recomputes consistently.
- Short-record and regulated stations show the correct warnings; <5-year stations are handled gracefully.

---

## 12. Flood Frequency Analysis — methodology specification

This section defines exactly what the Python FFA service computes. Use `numpy`, `scipy.stats`, and **`lmoments3`** (which provides L-moment fitting for `gev`, `glo`, `gum`, `pe3`, `gno`, etc.).

### 12.1 Input series
- AMS = the annual maximum **instantaneous discharge** values, one per year, with their year and symbol.
- If **exclude estimated** is on, drop peaks with symbol `E` before fitting (report the dropped years/count).
- Let `n` = number of years used. If `n < 5`, return a structured error/`too_few_years` flag and do not fit.

### 12.2 Distributions & parameterization

| Key | Distribution | Fit space | Notes |
|---|---|---|---|
| `gumbel` | Gumbel / EV1 (2-param) | Q | `lmoments3` `gum` / `scipy.stats.gumbel_r` |
| `gev` | Generalized Extreme Value (3-param) | Q | `lmoments3` `gev` / `scipy.stats.genextreme` |
| `glo` | Generalized Logistic (3-param) | Q | `lmoments3` `glo` |
| `pe3` | Pearson Type III (3-param) | Q | `lmoments3` `pe3` |
| `lp3` | Log-Pearson Type III (3-param) | **log10(Q)** | Fit PE3 to `log10(Q)`; back-transform quantiles with `10**x` |

### 12.3 Parameter estimation
- **L-moments (default):** compute sample L-moments of the series (of `log10(Q)` for LP3), then fit each distribution's parameters by L-moments via `lmoments3`.
- **Method of moments (alternative):** for **LP3**, compute the mean, standard deviation, and skew of `log10(Q)` and apply the Pearson III frequency factor (K_T) approach (classic Bulletin-17B-style). For other distributions, MOM MAY be supported but L-moments is preferred.
- Report which method produced each fit.

### 12.4 Return-period quantiles
For an annual maximum series, the **annual exceedance probability** AEP = 1/T and the non-exceedance probability `p = 1 − 1/T`. The design quantile is:

```
Q_T = ppf(1 − 1/T)            # for distributions fit in Q-space
Q_T = 10 ** ppf_log(1 − 1/T)  # for LP3 (fit in log10 space)
```

Compute for every requested return period.

### 12.5 Plotting positions (empirical points)
Sort the AMS in **descending** order; assign rank `m = 1` to the largest. The empirical exceedance probability and return period are:

```
p_m = (m − a) / (n + 1 − 2a)
T_m = 1 / p_m
```

with constant `a`:
- **Weibull:** `a = 0`
- **Cunnane (default):** `a = 0.4`
- **Gringorten:** `a = 0.44`

Return the array of `{year, value, exceedance_prob, return_period}` for plotting.

### 12.6 Confidence intervals
- **Default method: non-parametric bootstrap** (works uniformly across all distributions). Resample the AMS with replacement `B` times (default `B = 2000`); refit; recompute each return-period quantile; the CI bounds are the `(1−level)/2` and `1−(1−level)/2` percentiles of the bootstrap quantile distribution (e.g., 5th/95th for 90%).
- Use a fixed random seed by default for reproducibility (allow override).
- (Analytical CIs, e.g., delta-method / Kite's frequency-factor variance, MAY be added later per distribution.)

### 12.7 Goodness-of-fit & ranking
Per distribution, compute and return:
- **Kolmogorov–Smirnov** statistic and p-value (`scipy.stats.kstest` against the fitted CDF).
- **Anderson–Darling** statistic.
- **AIC** and **BIC** from the fitted log-likelihood and parameter count (`k = 2` for Gumbel, `3` for GEV/GLO/PE3/LP3).
- **RMSE** between observed values and the fitted quantiles evaluated at the empirical plotting-position probabilities.
- **Best fit** = lowest **AIC** (report the metric used). The UI highlights it but the user can view all.

### 12.8 Fitted curve for plotting
For a smooth frequency curve, return a dense set of `{return_period, value}` pairs (e.g., return periods log-spaced from ~1.01 to ~1000, plus the requested return periods) per distribution.

### 12.9 Numerical robustness
- Guard against non-positive flows before `log10` (LP3): if zeros/negatives exist, document the handling (e.g., exclude or warn) — typical instantaneous peak discharge values are positive.
- If a particular distribution fails to fit (optimizer error, invalid shape), return that distribution with a `fit_error` message rather than failing the entire request.

---

## 13. API contracts

### 13.1 Next.js BFF routes (internal — the frontend's only API)

| Method & path | Purpose |
|---|---|
| `GET /api/stations` | Return the station catalog (or a filtered subset). MAY just serve `stations.json`. |
| `GET /api/stations/:id` | Return one catalog entry. |
| `GET /api/stations/:id/daily?variable=discharge|level&start=YYYY-MM-DD&end=YYYY-MM-DD` | Proxy + paginate `hydrometric-daily-mean`; return a normalized series. |
| `GET /api/stations/:id/monthly` | (Optional) proxy `hydrometric-monthly-mean`. |
| `GET /api/stations/:id/peaks?variable=discharge&peak=max` | Proxy + filter `hydrometric-annual-peaks`; return the AMS. |
| `POST /api/stations/:id/frequency` | Orchestrate FFA: fetch peaks (or accept them), call the Python service, return analysis. |

**Normalized daily response:**
```jsonc
{
  "station_id": "05BB001",
  "variable": "discharge",            // "discharge" | "level"
  "unit": "m3/s",
  "series": [ { "date": "1909-01-01", "value": 12.3, "symbol": null }, ... ],
  "meta": { "count": 41850, "start": "1909-01-01", "end": "2023-12-31" }
}
```

**Normalized peaks (AMS) response:**
```jsonc
{
  "station_id": "05BB001",
  "variable": "discharge",
  "peak_code": "max",
  "unit": "m3/s",
  "peaks": [ { "year": 1909, "value": 220.0, "date": "1909-06-21", "symbol": null }, ... ]
}
```

### 13.2 Python FFA service (pure compute, stateless)

`POST /api/v1/flood-frequency`

**Request:**
```jsonc
{
  "station_id": "05BB001",                 // optional, for labels only
  "variable": "discharge",
  "peaks": [ { "year": 1909, "value": 220.0, "symbol": null }, ... ],
  "distributions": ["gev", "glo", "gumbel", "lp3", "pe3"],
  "estimation_method": "lmoments",         // "lmoments" | "mom"
  "plotting_position": "cunnane",          // "cunnane" | "weibull" | "gringorten"
  "return_periods": [2,5,10,20,25,50,100,200,500],
  "exclude_estimated": true,
  "confidence_level": 0.90,
  "ci_method": "bootstrap",                // "bootstrap" | "none"
  "bootstrap_samples": 2000,
  "random_seed": 42
}
```

**Response:**
```jsonc
{
  "n_years": 113,
  "years_used": [1909, 1910, "..."],
  "excluded": [ { "year": 1998, "reason": "estimated" } ],
  "warnings": [
    { "level": "info", "code": "record_length", "message": "113 years of record." }
  ],
  "plotting_positions": [
    { "year": 1932, "value": 480.0, "exceedance_prob": 0.0053, "return_period": 189.0 }
  ],
  "distributions": [
    {
      "key": "gev",
      "label": "Generalized Extreme Value (GEV)",
      "estimation_method": "lmoments",
      "parameters": { "loc": 0, "scale": 0, "shape": 0 },
      "quantiles": [
        { "return_period": 100, "aep": 0.01, "value": 612.0, "ci_lower": 540.0, "ci_upper": 705.0 }
      ],
      "curve": [ { "return_period": 1.01, "value": 0 }, "..." ],
      "goodness_of_fit": { "ks_stat": 0, "ks_pvalue": 0, "ad_stat": 0, "aic": 0, "bic": 0, "rmse": 0 },
      "fit_error": null
    }
  ],
  "best_fit": "gev",
  "best_fit_metric": "aic"
}
```

`GET /health` → `{ "status": "ok" }`.

**Validation:** reject malformed payloads with 422; if `n_years < 5` return `200` with `"too_few_years": true` and no fits (or a 422 with a clear message — pick one and document it).

---

## 14. Data models (types)

### 14.1 TypeScript (frontend)
```ts
type StationStatus = "active" | "discontinued";

interface Station {
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
    flow?:  { year_from: number; year_to: number; record_length: number };
    level?: { year_from: number; year_to: number; record_length: number };
  };
}

interface DailyPoint { date: string; value: number | null; symbol: string | null; }
interface PeakPoint  { year: number; value: number; date?: string; symbol: string | null; }

interface FrequencyQuantile {
  return_period: number; aep: number; value: number;
  ci_lower: number | null; ci_upper: number | null;
}
interface DistributionResult {
  key: string; label: string; estimation_method: string;
  parameters: Record<string, number>;
  quantiles: FrequencyQuantile[];
  curve: { return_period: number; value: number }[];
  goodness_of_fit: {
    ks_stat: number; ks_pvalue: number; ad_stat: number;
    aic: number; bic: number; rmse: number;
  };
  fit_error: string | null;
}
```

### 14.2 Python (Pydantic — request/response)
Mirror the JSON in 13.2 with Pydantic models (`PeakInput`, `FrequencyRequest`, `Quantile`, `DistributionResult`, `FrequencyResponse`). Validate ranges (`0 < confidence_level < 1`, positive return periods, non-empty peaks).

---

## 15. UI / UX design guidelines

**Overall feel:** clean, documentation-like, content-first (à la the `tidyhydat` docs site). Generous whitespace, restrained color, strong typography, no visual clutter.

- **Palette:** neutral grays for surfaces/text; a single water/blue accent for interactive elements and primary data series; reserve red/amber strictly for warnings. Ensure WCAG AA contrast.
- **Typography:** one clean sans-serif (e.g., Inter or system UI). Clear hierarchy; tabular numerals for data tables.
- **Layout:** max content width on text/analysis pages; sticky station header; responsive (desktop-first, but usable down to tablet/mobile — map becomes full-width with a bottom sheet for station details; tables scroll horizontally).
- **Components:** cards for chart blocks and stat panels; clearly labelled toggles/selects for controls; badges for status/regulation/RHBN; a consistent warning/callout component.
- **Charts:** consistent axis labels with units; legends; download (PNG) affordance; log/linear toggles where relevant. Empirical points and fitted curves visually distinct on the frequency plot.
- **States:** every async view MUST have explicit **loading**, **empty**, and **error** states (skeletons or spinners for loading; friendly empty/error messages with a path back to the map).
- **Accessibility:** keyboard-navigable controls, focus states, alt/aria labels, do not rely on color alone (pair color with text/shape for status and warnings).
- **i18n-ready:** keep user-facing strings in a single module/dictionary so French can be added later without refactoring.

### 15.1 Number, unit & date formatting
- Discharge: m³/s; level: m; area: km². Show units on axes, table headers, and stat labels.
- Round display sensibly (e.g., discharge to 3–4 significant figures); never round the underlying data used in computation.
- Dates: ISO `YYYY-MM-DD` for data/CSV; a readable form (e.g., "21 Jun 1932") in prose/tooltips.
- AEP shown as both `1/T` and percentage where helpful.

---

## 16. Performance & caching

- **Station catalog:** bundled static asset, loaded once; map renders without an API call. Cluster markers.
- **OGC proxy caching:** cache normalized daily/peaks responses in the BFF keyed by `station + variable + range` (e.g., Next.js fetch `revalidate`, an edge/in-memory cache, or simple disk cache). TTL on the order of a day is fine (historical data changes slowly).
- **Pagination:** always fully consume paginated OGC responses; show progress for large fetches.
- **FFA:** bootstrap with `B = 2000` MUST complete within a few seconds for typical record lengths; vectorize resampling. Cache identical FFA requests (same station + params) within the BFF if helpful.
- **Bundle:** lazy-load Plotly (it is heavy) on analysis pages only; do not load it on the map landing page.

---

## 17. Non-functional requirements

- **Reliability:** upstream OGC API or Python service failures MUST surface as graceful, specific error states, not blank pages or crashes. Time out and retry idempotent GETs sensibly.
- **Security:** no secrets in the client; the Python service and OGC base URL come from env vars; the FFA service SHOULD restrict CORS to the app origin (it is only called by the BFF anyway). Validate/whitelist `stationId` against the catalog before proxying.
- **Configuration:** `OGC_BASE_URL`, `FFA_SERVICE_URL`, and any cache TTLs MUST be environment variables.
- **Observability:** basic request logging on the BFF and FFA service; log upstream failures with enough context to debug.
- **Licensing/attribution:** ECCC data licence link + attribution and OSM attribution displayed (footer + `/about` + on exported artifacts where practical).
- **Browser support:** current evergreen browsers.

---

## 18. Suggested project structure

```
repo/
├─ web/                       # Next.js app (UI + BFF)
│  ├─ app/
│  │  ├─ page.tsx             # map + search (F1)
│  │  ├─ stations/[id]/page.tsx          # overview (F2)
│  │  ├─ stations/[id]/daily/page.tsx    # historic data (F3)
│  │  ├─ stations/[id]/frequency/page.tsx# FFA (F4)
│  │  ├─ about/page.tsx
│  │  └─ api/
│  │     ├─ stations/route.ts
│  │     ├─ stations/[id]/route.ts
│  │     ├─ stations/[id]/daily/route.ts
│  │     ├─ stations/[id]/peaks/route.ts
│  │     └─ stations/[id]/frequency/route.ts
│  ├─ components/             # Map, charts, StationHeader, controls, callouts
│  ├─ lib/                    # ogc client, formatting, types, i18n strings
│  └─ public/data/stations.json
├─ ffa-service/               # FastAPI statistics engine
│  ├─ app/main.py
│  ├─ app/ffa.py              # distributions, plotting positions, bootstrap, GOF
│  ├─ app/models.py           # Pydantic models
│  ├─ tests/
│  └─ requirements.txt
└─ scripts/build-catalog/     # offline HYDAT → stations.json
   ├─ build_catalog.py
   └─ README.md
```

---

## 19. Build phases & milestones

**Phase 0 — Foundations**
- Repo scaffold (web + ffa-service + scripts). Tailwind configured. Env-var config. Health endpoints.
- Catalog builder produces `stations.json` + `catalog_meta.json` from HYDAT.
- *Acceptance:* `stations.json` validates against the schema in 6.2; both apps start.

**Phase 1 — Map & discovery (F1)**
- Leaflet map with clustered markers from the catalog; search; filters; station detail panel with navigation buttons.
- *Acceptance:* §8.6.

**Phase 2 — Station shell (F2) + Historic Data (F3)**
- Shared sticky station header; BFF daily proxy with pagination + caching; hydrograph, FDC, regime, summary stats; CSV/PNG export.
- *Acceptance:* §10.6.

**Phase 3 — Flood Frequency Analysis (F4 + Section 12)**
- BFF peaks proxy; Python FFA service (distributions, plotting positions, return-period quantiles, bootstrap CIs, GOF, best-fit); peak-series chart, frequency plot, design-flood table, GOF table, warnings; CSV/PNG export.
- *Acceptance:* §11.6.

**Phase 4 — Polish & hardening**
- Loading/empty/error states everywhere; accessibility pass; attribution/licence + `/about`; URL-state sync for shareable analyses; performance tuning (lazy Plotly, cache tuning).

**Phase 5 (future / out of v1 scope)**
- Real-time current-conditions badge/series; French localization; Grubbs–Beck low-outlier test; analytical CIs; minima/level FFA; trend analysis enhancements; topographic basemap; regional FFA.

---

## 20. Testing

- **FFA unit tests (critical):** validate the engine against a hand-checked dataset and/or a published worked example: parameter estimates, return-period quantiles, plotting positions, and AIC ranking within tolerance. Test edge cases: `n<5`, all-estimated-excluded, a single distribution failing to fit, very short records, presence of zeros (LP3 guard).
- **BFF tests:** pagination correctly assembles multi-page OGC responses; normalization maps fields correctly (use recorded fixtures so tests don't depend on the live API); unknown station rejected.
- **Frontend:** key components render with mocked data; loading/empty/error states; export produces correct CSV.
- **Smoke/E2E (optional):** map → select station → open both analyses for a known long-record station (e.g., a Bow River gauge) and a short-record station.

---

## 21. Open questions / decisions to revisit

1. **`hydrometric-stations` vs static catalog overlap** — confirm which metadata fields the live collection actually exposes; if it covers drainage area + regulation, the static catalog could be simplified. (Assumed: it does not, hence the HYDAT-built catalog.)
2. **CORS on the FFA service** — confirmed not needed for browsers since the BFF calls it server-side; lock CORS down accordingly.
3. **Confidence interval method** — bootstrap chosen for uniformity; revisit if analytical CIs are required for a specific standard.
4. **Best-fit ranking metric** — AIC chosen; confirm whether the team prefers AD or a visual/operator choice as the headline.
5. **Water-year vs calendar-year peaks** — we consume ECCC's pre-computed annual instantaneous peaks as-is; confirm this matches the intended convention for design use.

---

## 22. Glossary

- **WSC** — Water Survey of Canada (operates the gauges).
- **HYDAT** — the WSC archival database (SQLite distribution).
- **Discharge (Q)** — volumetric flow rate, m³/s.
- **Stage / level** — water surface elevation/height, m.
- **AMS** — Annual Maximum Series (one peak per year).
- **Instantaneous peak** — the highest momentary flow in a year (higher than the daily mean).
- **Return period (T)** — average recurrence interval, years; **AEP** = annual exceedance probability = 1/T.
- **FDC** — Flow-Duration Curve (discharge vs % time exceeded).
- **Plotting position** — empirical exceedance probability assigned to ranked observations.
- **LP3 / GEV / GLO / Gumbel / PE3** — extreme-value distributions used in flood frequency analysis.
- **L-moments** — robust moment estimators commonly used to fit these distributions.
- **Regulated** — flow altered by dams/diversions; undermines the stationarity assumption of FFA.
- **RHBN** — Reference Hydrometric Basin Network (high-quality, near-natural basins).

---

## 23. Reference links

- ECCC GeoMet-OGC-API (root): `https://api.weather.gc.ca`
- Collections: `hydrometric-stations`, `hydrometric-daily-mean`, `hydrometric-monthly-mean`, `hydrometric-annual-statistics`, `hydrometric-annual-peaks`, `hydrometric-realtime` (append as `https://api.weather.gc.ca/collections/<name>`)
- MSC hydrometric data readme: `https://eccc-msc.github.io/open-data/msc-data/obs_hydrometric/readme_hydrometric_en/`
- MSC OGC-API use case (retrieving/displaying hydrometric data): `https://eccc-msc.github.io/open-data/usage/use-case_oafeat/use-case_oafeat-interactive_en/`
- Historical Hydrometric Data (Open Government metadata): `https://open.canada.ca/data/en/dataset/1ee9e14d-0814-5201-a3be-705809d8ee0e`
- HYDAT SQLite (MSC Datamart hydrometrics): `http://collaboration.cmc.ec.gc.ca/cmc/hydrometrics/www/`
- `tidyhydat` (R; documents the HYDAT schema and access patterns): `https://docs.ropensci.org/tidyhydat/`
- ECCC Open Data end-user licence: `https://eccc-msc.github.io/open-data/licence/readme_en/`

---

*End of PRD v1.0.*
