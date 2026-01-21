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
- **Prioriterte soner** (viktigst først):
  1. Nord-Jæren (200 stopp) – Stavanger, Sandnes, Sola, Randaberg
  2. Jæren (100 stopp) – Time, Klepp, Hå, Gjesdal
  3. Ryfylke (60 stopp) – Strand, Hjelmeland, Forsand
  4. Dalane (40 stopp) – Eigersund, Sokndal, Lund, Bjerkreim
- Totalt ~400 stoppesteder, 16 API-kall per refresh
- Auto-refresh hvert minutt
- Caching: Stoppesteder 10 min, forsinkelser 30 sek
- Deduplicering av avganger på tvers av stoppesteder
