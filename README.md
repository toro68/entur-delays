# Forsinkede busser – Rogaland

Sanntids-dashboard som viser de mest forsinkede bussene i Kolumbus-området (Sør-Rogaland).

## Oppsett

```bash
npm install
npm run dev
```

Åpne http://localhost:5200

## Bygg for produksjon

```bash
npm run build
```

Bygget havner i `dist/`-mappen.

## Teknologi

- **Svelte 5** med runes
- **Vite** for bygg
- **Entur GraphQL API** (kall direkte fra browser)
- Ingen backend nødvendig – alt kjører i browser

## Data

- Henter sanntidsdata fra Entur JourneyPlanner v3
- Bounding box: Sør-Rogaland (ekskl. Haugalandet)
- Caching: Stoppesteder 10 min, forsinkelser 30 sek
- Auto-refresh hvert 5. minutt (unngår rate-limiting)
- Adaptiv henting: Starter med 50 stoppesteder, utvider til 200 ved behov
- Deduplicering av avganger på tvers av stoppesteder
