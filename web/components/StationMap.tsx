"use client";
import { useEffect, useRef, useState } from "react";
import type { Station } from "@/lib/types";

interface Props {
  stations: Station[];
  onSelect: (station: Station) => void;
  selectedId?: string;
}

export function StationMap({ stations, onSelect, selectedId }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Dynamically import leaflet (avoids SSR issues)
    Promise.all([
      import("leaflet"),
      import("leaflet/dist/leaflet.css" as string),
    ]).then(([L]) => {
      // Fix default icon paths for webpack
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current!, {
        center: [60, -96],
        zoom: 4,
        minZoom: 3,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      // Active / discontinued icon styles
      const activeIcon = L.circleMarker([0, 0], {
        radius: 5,
        color: "#1d4ed8",
        fillColor: "#3b82f6",
        fillOpacity: 0.8,
        weight: 1,
      });

      import("leaflet.markercluster").then((MC) => {
        // @ts-expect-error dynamic import
        const cluster = (MC.default || MC).markerClusterGroup({ maxClusterRadius: 40 });

        stations.forEach((stn) => {
          const icon =
            stn.status === "active"
              ? L.circleMarker([stn.latitude, stn.longitude], {
                  radius: 5,
                  color: "#1d4ed8",
                  fillColor: "#3b82f6",
                  fillOpacity: 0.8,
                  weight: 1,
                })
              : L.circleMarker([stn.latitude, stn.longitude], {
                  radius: 4,
                  color: "#6b7280",
                  fillColor: "#d1d5db",
                  fillOpacity: 0.6,
                  weight: 1,
                });

          icon
            .bindPopup(
              `<strong>${stn.name}</strong><br/>${stn.station_number} · ${stn.province}<br/>
               <span style="font-size:11px;color:${stn.status === "active" ? "#16a34a" : "#6b7280"}">${stn.status}</span>`
            )
            .on("click", () => onSelect(stn));

          cluster.addLayer(icon);
        });

        map.addLayer(cluster);
        setReady(true);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mapInstanceRef.current = map as any;
    });

    return () => {
      if (mapInstanceRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mapInstanceRef.current as any).remove();
        mapInstanceRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
