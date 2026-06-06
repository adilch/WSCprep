"""
Build stations.json + catalog_meta.json from HYDAT SQLite.

Usage:
    python build_catalog.py --hydat path/to/Hydat.sqlite3 --out path/to/web/public/data/

Requires: sqlite3 (stdlib), json (stdlib)
No external dependencies.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def build_catalog(hydat_path: str, out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    con = sqlite3.connect(hydat_path)
    con.row_factory = sqlite3.Row

    # --- HYDAT version ---
    try:
        row = con.execute("SELECT * FROM VERSION LIMIT 1").fetchone()
        hydat_version = row["Date"] if row and "Date" in row.keys() else "unknown"
    except Exception:
        hydat_version = "unknown"

    # --- Stations ---
    stations_rows = con.execute("""
        SELECT
            STATION_NUMBER, STATION_NAME, PROV_TERR_STATE_LOC,
            HYD_STATUS, LATITUDE, LONGITUDE,
            DRAINAGE_AREA_GROSS, DRAINAGE_AREA_EFFECT,
            RHBN, REAL_TIME, DATUM_ID
        FROM STATIONS
    """).fetchall()

    # --- Regulation ---
    reg_rows = con.execute("""
        SELECT STATION_NUMBER, REGULATED
        FROM STN_REGULATION
        WHERE YEAR_TO IS NULL OR YEAR_TO >= 2000
    """).fetchall()
    regulated_map: dict[str, bool] = {}
    for r in reg_rows:
        stn = r["STATION_NUMBER"]
        # If any active period is regulated, mark as regulated
        if r["REGULATED"] in (1, "1", "Y", "y", True):
            regulated_map[stn] = True
        elif stn not in regulated_map:
            regulated_map[stn] = False

    # --- Data ranges ---
    range_rows = con.execute("""
        SELECT STATION_NUMBER, DATA_TYPE, Year_from, Year_to, RECORD_LENGTH
        FROM STN_DATA_RANGE
    """).fetchall()
    range_map: dict[str, dict] = {}
    for r in range_rows:
        stn = r["STATION_NUMBER"]
        if stn not in range_map:
            range_map[stn] = {}
        dtype = str(r["DATA_TYPE"]).upper()
        if dtype == "Q":
            key = "flow"
        elif dtype == "H":
            key = "level"
        else:
            continue
        range_map[stn][key] = {
            "year_from": r["Year_from"],
            "year_to": r["Year_to"],
            "record_length": r["RECORD_LENGTH"],
        }

    # --- Build output ---
    output = []
    for s in stations_rows:
        stn = s["STATION_NUMBER"]
        status_code = str(s["HYD_STATUS"] or "").upper()
        status = "active" if status_code == "A" else "discontinued"

        lat = s["LATITUDE"]
        lon = s["LONGITUDE"]
        if lat is None or lon is None:
            continue  # skip stations without coordinates

        output.append({
            "station_number": stn,
            "name": s["STATION_NAME"],
            "province": s["PROV_TERR_STATE_LOC"],
            "status": status,
            "latitude": float(lat),
            "longitude": float(lon),
            "drainage_area_gross_km2": float(s["DRAINAGE_AREA_GROSS"]) if s["DRAINAGE_AREA_GROSS"] else None,
            "drainage_area_effective_km2": float(s["DRAINAGE_AREA_EFFECT"]) if s["DRAINAGE_AREA_EFFECT"] else None,
            "regulated": regulated_map.get(stn),
            "rhbn": bool(s["RHBN"]),
            "real_time": bool(s["REAL_TIME"]),
            "datum": s["DATUM_ID"] or None,
            "data_ranges": range_map.get(stn, {}),
        })

    con.close()

    stations_file = out / "stations.json"
    stations_file.write_text(json.dumps(output, ensure_ascii=False), encoding="utf-8")
    print(f"Written {len(output)} stations to {stations_file}")

    meta = {
        "hydat_version": hydat_version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "station_count": len(output),
    }
    meta_file = out / "catalog_meta.json"
    meta_file.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Metadata written to {meta_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build WSC station catalog from HYDAT SQLite")
    parser.add_argument("--hydat", required=True, help="Path to Hydat.sqlite3")
    parser.add_argument("--out", required=True, help="Output directory (e.g. web/public/data)")
    args = parser.parse_args()
    build_catalog(args.hydat, args.out)
