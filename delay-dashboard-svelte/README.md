# Forsinkede busser – Rogaland (Svelte)

Sanntids-dashboard som viser de mest forsinkede bussene i Kolumbus-området.

## Oppsett

1. Installer avhengigheter:
   ```bash
   npm install
   ```

2. Start backend-serveren (i `delay-dashboard`-mappen):
   ```bash
   cd ../delay-dashboard
   npm install
   cp .env.example .env  # Sett ENTUR_CLIENT_NAME
   node --env-file=.env server.js
   ```

3. Start Svelte-appen (i denne mappen):
   ```bash
   npm run dev
   ```

4. Åpne http://localhost:5200

## Bygg for produksjon

```bash
npm run build
```

Bygget havner i `dist/`-mappen og peker til `https://editorial.aftenbladet.no/2026/sa-entur-delays/`.

## Arkitektur

- **Backend**: Express-server på port 5173 som henter data fra Entur GraphQL API
- **Frontend**: Svelte 5-app på port 5200 med proxy til backend
- Vite config basert på Aftenbladet-malen med riktig base-URL for produksjon
