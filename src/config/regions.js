export const REGIONS = [
  {
    id: "nord-jaeren",
    label: "Nord-Jæren",
    description: "Stavanger, Sandnes, Sola, Randaberg",
    lines: null,
  },
  {
    id: "jaeren",
    label: "Jæren",
    description: "Time, Klepp, Hå, Gjesdal",
    lines: null,
  },
  {
    id: "ryfylke",
    label: "Ryfylke",
    description: "Strand, Hjelmeland, Forsand",
    lines: null,
  },
  {
    id: "dalane",
    label: "Dalane",
    description: "Eigersund, Sokndal, Lund, Bjerkreim",
    lines: null,
  },
];

export function getRegionByLabel(label) {
  return REGIONS.find((r) => r.label === label) ?? REGIONS[0];
}

export function isRowInRegion(row, region) {
  const lines = region?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return true;
  const code = row?.linePublicCode ?? row?.lineName ?? null;
  if (!code) return false;
  return lines.includes(code);
}

