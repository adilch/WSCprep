```markdown
# Implementation Plan for Canadian Hydrometric Data & Flood Frequency Analysis Web App

## Step 1: Understand the Project Scope and Structure
**Key Points:**
- The app is built using Next.js, TypeScript, React for the frontend.
- FastAPI is used for the backend flood frequency analysis service.
- Data sources include HYDAT SQLite for static station metadata and ECCC GeoMet OGC API for runtime data.

## Step 2: Set Up Project Structure
**Structure Overview:**
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

## Step 3: Phase 0 — Foundations
**Tasks:**
1. **Repo Scaffold:**
   - Initialize the repository with `web`, `ffa-service`, and `scripts/build-catalog` directories.
2. **Tailwind Config:**
   - Configure Tailwind CSS in the `web` directory for styling.
3. **Environment Variables:**
   - Set up `.env.local` files for configuration variables like `OGC_BASE_URL`, `FFA_SERVICE_URL`.
4. **Health Endpoints:**
   - Implement health endpoints in both Next.js (BFF) and FastAPI (Python FFA service).

**Tools to Use:**
- `read_currently_open_file` to read the PRD document for reference.
- `ls` to list directory structures.

## Step 4: Phase 1 — Map & Discovery (F1)
**Tasks:**
1. **Leaflet Map Setup:**
   - Integrate Leaflet with clustering using `react-leaflet`.
   - Load stations from `stations.json` and render as clustered markers.
2. **Search Bar Implementation:**
   - Implement a search bar for station name or number, running client-side over the loaded catalog.
3. **Filter Panel:**
   - Create filters for province, status, data type, regulation, RHBN, and minimum record length.
4. **Station Detail Panel:**
   - Develop a detail panel to show selected station metadata with navigation buttons.

**Tools to Use:**
- `read_currently_open_file` to reference implementation details.
- `ls` to list relevant files in the `web` directory.

## Step 5: Phase 2 — Station Shell (F2) + Historic Data (F3)
**Tasks:**
1. **Sticky Station Header:**
   - Implement a sticky header for station overview pages.
2. **BFF Daily Proxy:**
   - Set up BFF routes to proxy and paginate daily data from ECCC GeoMet API.
3. **Historic Data Analysis:**
   - Develop visualizations (hydrograph, FDC, mean annual regime) using Plotly.
4. **CSV/PNG Export:**
   - Implement download functionality for CSV and PNG exports.

**Tools to Use:**
- `read_currently_open_file` to reference implementation details.
- `ls` to list relevant files in the `web` directory.

## Step 6: Phase 3 — Flood Frequency Analysis (F4 + Section 12)
**Tasks:**
1. **BFF Peaks Proxy:**
   - Set up BFF routes to proxy and filter annual peak data from ECCC GeoMet API.
2. **Python FFA Service:**
   - Implement the FFA service using FastAPI, including distribution fitting, plotting positions, return-period quantiles, bootstrap CIs, GOF, and best-fit selection.
3. **Visualization & Outputs:**
   - Develop visualizations (annual peak series chart, probability plot, design-flood table, goodness-of-fit table) using Plotly.
4. **Data Quality Warnings:**
   - Implement warnings for data quality issues like short record length, regulation status, and gaps in data.

**Tools to Use:**
- `read_currently_open_file` to reference implementation details.
- `ls` to list relevant files in the `ffa-service` directory.

## Step 7: Phase 4 — Polish & Hardening
**Tasks:**
1. **Loading/Empty/Error States:**
   - Implement loading, empty, and error states for all async views.
2. **Accessibility Pass:**
   - Ensure accessibility with keyboard-navigable controls, focus states, alt/aria labels.
3. **Attribution/Licence + `/about`:**
   - Display ECCC data licence link + attribution in the footer and on exported artifacts where practical.
4. **URL State Sync:**
   - Implement URL state synchronization for shareable analyses.

**Tools to Use:**
- `read_currently_open_file` to reference implementation details.
- `ls` to list relevant files in both `web` and `ffa-service` directories.

## Step 8: Phase 5 (Future/Out of Scope)
**Tasks:**
1. **Real-time Current Conditions Badge/Series:**
   - Integrate real-time current conditions data as a badge or series.
2. **French Localization:**
   - Translate the app to French, ensuring i18n readiness.
3. **Grubbs–Beck Low-outlier Test:**
   - Implement low-outlier detection for flood frequency analysis.
4. **Analytical CIs:**
   - Add analytical confidence intervals for better accuracy.
5. **Minima/Level FFA:**
   - Extend flood frequency analysis to support level and minima data.

**Tools to Use:**
- `read_currently_open_file` to reference implementation details.
- `ls` to list relevant files in both `web` and `ffa-service` directories.

## Step 9: Testing
**Tasks:**
1. **FFA Unit Tests:**
   - Write unit tests for the Python FFA service, validating parameter estimates, return-period quantiles, plotting positions, and GOF ranking within tolerance.
2. **BFF Tests:**
   - Test pagination, normalization, and error handling in BFF routes.
3. **Frontend Tests:**
   - Mock data for frontend component rendering tests.
4. **Smoke/E2E Tests:**
   - Perform smoke and end-to-end testing to verify the entire app flow.

**Tools to Use:**
- `read_currently_open_file` to reference implementation details.
- `ls` to list relevant files in both `web` and `ffa-service` directories.

## Step 10: Documentation & Deployment
**Tasks:**
1. **Documentation:**
   - Document the app setup, deployment, and usage instructions.
2. **Deployment:**
   - Deploy the Next.js frontend on Vercel and the Python FFA service as a container or serverless function.

**Tools to Use:**
- `read_currently_open_file` to reference implementation details.
- `ls` to list relevant files in both `web` and `ffa-service` directories.
```