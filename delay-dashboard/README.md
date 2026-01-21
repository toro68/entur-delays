# Delay dashboard (Entur realtime)

Lite internt dashboard som viser de mest forsinkede bussavgangene akkurat nå, basert på Entur JourneyPlanner API v3 (GraphQL realtime).

## Oppsett

```bash
cd delay-dashboard
npm install
cp .env.example .env
```

Rediger `.env` og sett minst:

- `ENTUR_CLIENT_NAME` (påkrevd header for åpne endepunkt)

## Kjør lokalt

```bash
npm run dev
```

Åpne `http://localhost:5173`.

## API

- `GET /api/top-delays` returnerer JSON med `delayMin` per avgang.
- Valgfritt query-param: `mode` (f.eks. `bus`, `tram`, `rail`).

