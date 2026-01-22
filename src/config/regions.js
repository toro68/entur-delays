export const REGIONS = [
  {
    id: "nord-jaeren",
    label: "Nord-Jæren",
    description: "Stavanger, Sola, Randaberg",
    bbox: { minLat: 58.85, maxLat: 59.05, minLon: 5.6, maxLon: 6.1 },
    maxStops: 300,
    lines: null,
  },
  {
    id: "jaeren",
    label: "Jæren",
    description: "Sandnes, Time, Klepp, Hå, Gjesdal",
    bbox: { minLat: 58.6, maxLat: 58.85, minLon: 5.5, maxLon: 6.0 },
    maxStops: 100,
    lines: null,
  },
  {
    id: "ryfylke",
    label: "Ryfylke",
    description: "Strand, Hjelmeland, Forsand, Suldal, Sauda",
    bbox: { minLat: 59.0, maxLat: 59.5, minLon: 5.8, maxLon: 7.2 },
    maxStops: 60,
    lines: null,
  },
  {
    id: "dalane",
    label: "Dalane",
    description: "Eigersund, Bjerkreim, Sokndal, Lund",
    bbox: { minLat: 58.15, maxLat: 58.7, minLon: 5.2, maxLon: 6.9 },
    maxStops: 80,
    lines: ["8"],
  },
];

export function getRegionByLabel(label) {
  return REGIONS.find((r) => r.label === label) ?? REGIONS[0];
}

export function isRowInRegion(row, region) {
  if (!region) return true;
  const bbox = region?.bbox ?? null;
  const lat = row?.quayLatitude ?? row?.stopPlaceLatitude ?? null;
  const lon = row?.quayLongitude ?? row?.stopPlaceLongitude ?? null;

  if (bbox && Number.isFinite(lat) && Number.isFinite(lon)) {
    return (
      lat >= bbox.minLat &&
      lat <= bbox.maxLat &&
      lon >= bbox.minLon &&
      lon <= bbox.maxLon
    );
  }

  const lines = region?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return true;
  const code = row?.linePublicCode ?? row?.lineName ?? null;
  if (!code) return false;
  return lines.includes(code);
}
