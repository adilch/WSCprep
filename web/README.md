# WSC Hydrometric Analysis App — Frontend

This directory contains the Next.js 16 frontend. For full documentation, setup instructions, and deployment guide see the [root README](../README.md).

## Quick start (frontend only)

```bash
# From this directory (web/)
npm install

# Create .env.local
echo "FFA_SERVICE_URL=http://localhost:8000" > .env.local
echo "OGC_BASE_URL=https://api.weather.gc.ca" >> .env.local

npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The FFA service must also be running locally — see the root README for setup.
