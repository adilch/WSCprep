# WSC Hydrometric Analysis App

<div align="center">

**An interactive web platform for exploring and analysing Water Survey of Canada stream-flow data**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-ws--cprep.vercel.app-blue?style=for-the-badge&logo=vercel)](https://ws-cprep.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![Python](https://img.shields.io/badge/Python-3.12-blue?style=for-the-badge&logo=python)](https://python.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

</div>

---

## What It Does

Water Survey of Canada (WSC) operates ~2,000 active hydrometric stations across Canada. This app gives you instant, browser-based access to all of them — no software to install, no local database to maintain. It pulls live data from Environment and Climate Change Canada's national HYDAT database via their OGC API, runs analyses on the fly, and delivers publication-ready results.

**Try it now → [ws-cprep.vercel.app](https://ws-cprep.vercel.app)**

---

## Features

### Station Discovery
- **Interactive map** of all ~2,000 WSC stations (OpenStreetMap + satellite basemap toggle)
- **Colour-code markers** by mean annual discharge, record length, or drainage area
- **Search & filter** by station name, ID, province, or active/historical status
- **Favourites** — bookmark stations for quick access

### Hydrograph
- Full daily discharge or water-level record for any station
- Pan/zoom timeline, date-range selector
- Annual peak event markers overlaid on the chart
- Download raw data as CSV

### Baseflow Separation
- Decompose total discharge into **baseflow** (groundwater) and **quickflow** (storm runoff)
- Two industry-standard digital filters:
  - **Lyne & Hollick (1979)** — 3-pass recursive filter (α = 0.925)
  - **Eckhardt (2005)** — two-parameter filter (a = 0.98, BFImax = 0.80)
- Live **Baseflow Index (BFI)** readout; adjust parameters and see the chart update instantly
- All computation runs client-side — no extra API call

### Flow Duration Curve (FDC)
- Ranks every daily value from highest to lowest and plots exceedance probability on a log scale
- Q10, Q50, Q90 markers; log-scale discharge axis
- Essential for environmental flow assessments and water allocation studies

### Annual Regime
- Mean monthly discharge averaged across the full station record
- Q10–Q90 uncertainty band reveals seasonal variability
- Useful for identifying snowmelt peaks, summer low-flows, and irrigation demand periods

### Statistical Summary
- Descriptive statistics: mean, median, standard deviation, CV, min, max
- Record length and data completeness
- Annual peak statistics

### Trend Analysis
- **Mann-Kendall test** — non-parametric, robust for skewed hydrological records
- **Sen's slope** — magnitude of trend in m³/s per year (or m/yr for water level)
- p-value and significance assessment at α = 0.05
- Annual peaks trend tested separately from daily flow trend

### Flood Frequency Analysis (FFA)
Fits multiple probability distributions to the **Annual Maximum Series (AMS)**:

| Distribution | Notes |
|---|---|
| GEV | Generalised Extreme Value — most widely used for floods |
| Gumbel | Special case of GEV; common in older Canadian practice |
| LP3 | Log-Pearson Type III — Canadian/US engineering standard |
| LN2 | 2-parameter Lognormal |
| Pearson III | Generalised gamma family |

- Parameter estimation: **L-moments** (default) or **Maximum Likelihood (MLE)**
- Model selection: **AIC / BIC** + K-S goodness-of-fit test
- **90% bootstrap confidence intervals** on all quantile estimates
- Design flood table for T = 2, 5, 10, 20, 25, 50, 100, 200, 500 years
- Choice of Weibull, Hazen, or Cunnane plotting positions
- Option to exclude provisional/estimated years from the fit

### Peaks Over Threshold (POT)
- Uses **every independent peak** above a user-selected threshold — 3–5× more data than AMS
- Threshold: percentile slider (50–99%) or manual m³/s entry
- Independence gap filter: 3, 7, 14, or 30 days minimum separation
- **Generalised Pareto Distribution (GPD)** fitted by L-moments (closed-form, no iteration)
- Poisson process assumption links exceedance rate to return periods
- Automatic warning if fewer than 15 peaks are selected

### Printable PDF Report
- Each station has a `/report` page assembling all key analyses
- Sections: station metadata · hydrograph · FDC · annual regime · peaks · frequency curve · design flood table · annual statistics · trend summary
- One-click **Print / Save PDF** via the browser's native print dialog
- Print-optimised layout: nav/buttons hidden, charts rendered static, page breaks between sections

### Methodology Transparency
Every analysis tab includes an expandable **"About this analysis"** panel explaining:
- The method in plain English
- Key assumptions
- Peer-reviewed references

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (client)                     │
│                                                         │
│   Next.js 16 · React · TypeScript · Tailwind · Plotly  │
│   Leaflet · Mann-Kendall · Baseflow · POT/GPD           │
│                    (all client-side)                    │
└────────────────┬────────────────────┬───────────────────┘
                 │ /api/*             │ /api/stations/*/frequency
                 ▼                    ▼
┌───────────────────────┐   ┌────────────────────────────┐
│   Next.js API routes  │   │   Python FFA service       │
│   (Vercel serverless) │   │   FastAPI · lmoments3      │
│                       │   │   scipy · numpy            │
│  Proxies ECCC OGC API │   │   (Docker on Render)       │
└───────────┬───────────┘   └────────────────────────────┘
            │
            ▼
┌───────────────────────┐
│   ECCC OGC API        │
│   api.weather.gc.ca   │
│   (live HYDAT data)   │
└───────────────────────┘
```

**No local database required.** All station and daily data comes from ECCC's public OGC API. Only ~3.3 MB of station metadata is bundled with the app (`public/data/`).

---

## Running Locally

### Prerequisites
- [Node.js 20+](https://nodejs.org)
- [Python 3.12+](https://python.org)

### 1 — Clone the repo

```bash
git clone https://github.com/adilch/WSCprep.git
cd WSCprep
```

### 2 — Start the Python FFA service

```bash
cd ffa-service
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The FFA service will be running at `http://localhost:8000`.
You can verify it at `http://localhost:8000/health`.

### 3 — Start the Next.js frontend

Open a second terminal:

```bash
cd web
npm install
```

Create a `.env.local` file in the `web/` directory:

```env
FFA_SERVICE_URL=http://localhost:8000
OGC_BASE_URL=https://api.weather.gc.ca
```

Then start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deploying Your Own Instance

### Frontend → Vercel

1. Fork this repository
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your fork
3. Set **Root Directory** to `web`
4. Add environment variable:
   ```
   FFA_SERVICE_URL=<your-render-service-url>
   ```
5. Deploy — Vercel handles the rest

### FFA Backend → Render

1. Go to [render.com](https://render.com) → **New Web Service**
2. Connect your forked repository
3. Set **Root Directory** to `ffa-service`
4. Set **Runtime** to **Docker**
5. Add environment variable:
   ```
   ALLOWED_ORIGINS=https://<your-vercel-domain>.vercel.app
   ```
6. Deploy

> **Free tier note:** Render's free tier spins down after 15 minutes of inactivity. The first flood frequency request after a quiet period may take ~30 seconds to wake the service.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS |
| Charts | Plotly.js |
| Maps | Leaflet + React-Leaflet |
| FFA engine | Python · FastAPI · lmoments3 · SciPy |
| Client-side analysis | TypeScript (Mann-Kendall, Baseflow, POT/GPD) |
| Data source | ECCC OGC API (live HYDAT) |
| Frontend hosting | Vercel |
| Backend hosting | Render (Docker) |

---

## Data Attribution

Station data and daily discharge/water-level records are sourced from the **National Hydrometric Program**, operated by **Environment and Climate Change Canada (ECCC)** through the Water Survey of Canada.

- HYDAT database: [open.canada.ca](https://open.canada.ca/data/en/dataset/0b506bde-a219-4f7d-8de9-d48cc49ba231)
- OGC API: [api.weather.gc.ca](https://api.weather.gc.ca)

Data is provided under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).

---

## License

This project is released under the [MIT License](LICENSE).
