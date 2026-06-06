import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ffa import run_ffa
from .models import FrequencyRequest, FrequencyResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="WSC Flood Frequency Analysis Service", version="1.0.0")

allowed_origins = os.getenv("ALLOWED_ORIGINS", "").split(",")
if not any(allowed_origins):
    allowed_origins = ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/v1/flood-frequency", response_model=FrequencyResponse)
def flood_frequency(req: FrequencyRequest):
    logger.info("FFA request: station=%s, n_peaks=%d", req.station_id, len(req.peaks))
    return run_ffa(req)
