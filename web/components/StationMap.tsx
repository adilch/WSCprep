"use client";
import { useEffect, useRef, useState } from "react";
import type { Station } from "@/lib/types";
import type { ColorMetric } from "@/lib/colorScale";
import { scaleColor } from "@/lib/colorScale";

// CSS must be static imports (Turbopack doesn't allow dynamic CSS imports).
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

interface Props {
  stations: Station[];
  onSelect: (station: Station) => void;
  selectedId?: string;
  /** Which attribute to colour markers by. Defaults to "status". */
  colorBy?: ColorMetric;
  /** [min, max] of the chosen metric across the full catalogue (for normalisation). */
  colorRange?: [number, number];
}

// ── Metric extraction ────────────────────────────────────────────────────────

function metricValue(s: Station, metric: ColorMetric): number {
  switch (metric) {
    case "record_length":
      return Math.max(
        s.data_ranges.flow?.record_length  ?? 0,
        s.data_ranges.level?.record_length ?? 0
      );
    case "drainage_area":
      return s.drainage_area_gross_km2 ?? 0;
    default:
      return 0;
  }
}

// ── Marker style ─────────────────────────────────────────────────────────────

function markerStyle(
  s: Station,
  colorBy: ColorMetric,
  colorRange: [number, number]
): { radius: number; color: string; fillColor: string; fillOpacity: number; weight: number } {
  if (colorBy === "status") {
    return s.status === "active"
      ? { radius: 5, color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.85, weight: 1 }
      : { radius: 4, color: "#6b7280", fillColor: "#d1d5db", fillOpacity: 0.65, weight: 1 };
  }

  const val = metricValue(s, colorBy);
  if (val === 0) {
    // No data for this metric — render as small grey dot.
    return { radius: 3, color: "#9ca3af", fillColor: "#e5e7eb", fillOpacity: 0.5, weight: 1 };
  }

  const [lo, hi] = colorRange;
  const t = hi > lo ? (val - lo) / (hi - lo) : 0.5;
  const { fill, stroke } = scaleColor(t);
  return { radius: 5, color: stroke, fillColor: fill, fillOpacity: 0.9, weight: 1 };
}

// ── Cluster population ───────────────────────────────────────────────────────

function populateCluster(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  L: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cluster: any,
  stations: Station[],
  onSelect: (s: Station) => void,
  colorBy: ColorMetric,
  colorRange: [number, number]
) {
  cluster.clearLayers();
  stations.forEach((stn) => {
    const style = markerStyle(stn, colorBy, colorRange);
    const marker = L.circleMarker([stn.latitude, stn.longitude], style);

    const statusColor = stn.status === "active" ? "#16a34a" : "#6b7280";
    marker
      .bindPopup(
        `<strong>${stn.name}</strong><br/>` +
        `${stn.station_number} · ${stn.province}<br/>` +
        `<span style="font-size:11px;color:${statusColor}">${stn.status}</span>`
      )
      .on("click", () => onSelect(stn));

    cluster.addLayer(marker);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StationMap({
  stations,
  onSelect,
  selectedId: _selectedId,
  colorBy   = "status",
  colorRange = [0, 1],
}: Props) {
  const mapRef        = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lRef          = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusterRef    = useRef<any>(null);

  // Keep refs to latest prop values so the async init always uses fresh data.
  const stationsRef   = useRef(stations);   stationsRef.current   = stations;
  const onSelectRef   = useRef(onSelect);   onSelectRef.current   = onSelect;
  const colorByRef    = useRef(colorBy);    colorByRef.current    = colorBy;
  const colorRangeRef = useRef(colorRange); colorRangeRef.current = colorRange;

  const [ready, setReady] = useState(false);

  // ── Effect 1: one-time map initialisation ─────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;

    let destroyed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null;

    const init = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L: any = await import("leaflet");
      if (destroyed || !mapRef.current) return;
      (window as any).L = L; // markercluster UMD needs L on window first // eslint-disable-line @typescript-eslint/no-explicit-any

      let clusterAvailable = false;
      try {
        await import("leaflet.markercluster");
        clusterAvailable = typeof L.markerClusterGroup === "function";
      } catch (e) {
        console.warn("[StationMap] markercluster unavailable, using plain layer:", e);
      }
      if (destroyed || !mapRef.current) return;

      // Fix Leaflet's default icon asset paths for Next.js.
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl:        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      map = L.map(mapRef.current, { center: [60, -96], zoom: 4, minZoom: 3 });
      mapInstanceRef.current = map;

      // ── Feature 11: Basemap toggle ───────────────────────────────────────
      const osmLayer = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }
      );
      const satelliteLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics",
          maxZoom: 19,
        }
      );
      const topoLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        {
          attribution: "Tiles &copy; Esri — Esri, HERE, Garmin, Intermap, USGS, FAO, EPA, NPS",
          maxZoom: 19,
        }
      );

      // Add OSM as the default basemap.
      osmLayer.addTo(map);

      // Layer-switcher control (top-right, built into Leaflet).
      L.control
        .layers(
          { "OpenStreetMap": osmLayer, "Esri Satellite": satelliteLayer, "Esri Topo": topoLayer },
          {},            // no overlay layers to expose via this control
          { collapsed: true, position: "topright" }
        )
        .addTo(map);
      // ── /Feature 11 ──────────────────────────────────────────────────────

      const cluster = clusterAvailable
        ? L.markerClusterGroup({ maxClusterRadius: 40 })
        : L.layerGroup();

      populateCluster(
        L, cluster,
        stationsRef.current, onSelectRef.current,
        colorByRef.current, colorRangeRef.current
      );
      map.addLayer(cluster);

      lRef.current     = L;
      clusterRef.current = cluster;
      setReady(true);
    };

    init().catch((err) => console.error("[StationMap] init failed:", err));

    return () => {
      destroyed = true;
      if (map) {
        map.remove();
        map = null;
        mapInstanceRef.current = null;
        lRef.current           = null;
        clusterRef.current     = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 2: re-populate markers when stations / colour config change ────
  useEffect(() => {
    if (!lRef.current || !clusterRef.current) return;
    populateCluster(
      lRef.current, clusterRef.current,
      stations, onSelect,
      colorBy, colorRange
    );
  }, [stations, onSelect, colorBy, colorRange]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full z-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 text-gray-400 text-sm z-10">
          Loading map…
        </div>
      )}
    </div>
  );
}
