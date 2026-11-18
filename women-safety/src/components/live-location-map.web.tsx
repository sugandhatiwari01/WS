import { useMemo } from "react";

type Props = { latitude: number; longitude: number };

/**
 * Embedded OpenStreetMap centred on the victim's latest position (browser dashboards).
 * Coordinates are rounded to ~10 m so the map only reloads when the person actually moves.
 */
export default function LiveLocationMap({ latitude, longitude }: Props) {
  const lat = Math.round(latitude * 10_000) / 10_000;
  const lng = Math.round(longitude * 10_000) / 10_000;
  const src = useMemo(() => {
    const d = 0.004; // roughly 400 m either side
    const bbox = [lng - d, lat - d, lng + d, lat + d].join(",");
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  }, [lat, lng]);

  return (
    <iframe
      title="Live location map"
      src={src}
      style={{ width: "100%", height: 320, border: 0, borderRadius: 12, marginTop: 12 }}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
