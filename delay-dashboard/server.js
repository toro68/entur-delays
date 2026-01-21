import express from 'express';

const app = express();

const PORT = Number.parseInt(process.env.PORT ?? '5173', 10);
const ENTUR_ENDPOINT = process.env.ENTUR_ENDPOINT ?? 'https://api.entur.io/journey-planner/v3/graphql';
const ENTUR_CLIENT_NAME = process.env.ENTUR_CLIENT_NAME;
const TOP_N = Number.parseInt(process.env.TOP_N ?? '25', 10);
const TRANSPORT_MODE = (process.env.TRANSPORT_MODE ?? 'bus').toLowerCase();
const REFRESH_MS = Number.parseInt(process.env.REFRESH_MS ?? '30000', 10);

function requireClientName() {
  if (!ENTUR_CLIENT_NAME) {
    const error = new Error(
      'Missing ENTUR_CLIENT_NAME. Create delay-dashboard/.env and set ENTUR_CLIENT_NAME.'
    );
    error.statusCode = 500;
    throw error;
  }
}

function minutesBetween(aimedIso, expectedIso) {
  if (!aimedIso || !expectedIso) return null;
  const aimedMs = Date.parse(aimedIso);
  const expectedMs = Date.parse(expectedIso);
  if (!Number.isFinite(aimedMs) || !Number.isFinite(expectedMs)) return null;
  return Math.round((expectedMs - aimedMs) / 60000);
}

async function enturGraphql(query, variables) {
  requireClientName();
  const res = await fetch(ENTUR_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'ET-Client-Name': ENTUR_CLIENT_NAME
    },
    body: JSON.stringify({ query, variables })
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Entur GraphQL HTTP ${res.status}: ${text}`);
    err.statusCode = 502;
    throw err;
  }

  const json = await res.json();
  if (json.errors?.length) {
    const err = new Error(`Entur GraphQL error: ${JSON.stringify(json.errors)}`);
    err.statusCode = 502;
    throw err;
  }
  return json.data;
}

// Bounding box for Rogaland (Kolumbus-området)
// Bounding box for Sør-Rogaland (Stavanger, Sandnes, Jæren, Ryfylke)
// Ekskluderer Haugalandet (Haugesund, Karmøy, Tysvær, Vindafjord) ved å sette maxLat til 59.15
const ROGALAND_BBOX = {
  minLat: 58.4,
  maxLat: 59.15,  // Stopper før Haugalandet
  minLon: 5.5,
  maxLon: 7.2
};

const STOP_PLACES_QUERY = `
  query StopPlacesByBbox($minLat: Float!, $minLon: Float!, $maxLat: Float!, $maxLon: Float!) {
    stopPlacesByBbox(
      minimumLatitude: $minLat
      minimumLongitude: $minLon
      maximumLatitude: $maxLat
      maximumLongitude: $maxLon
    ) {
      id
    }
  }
`;

const STOP_PLACE_DEPARTURES_QUERY = `
  query StopPlaceDepartures($id: String!, $numberOfDepartures: Int!) {
    stopPlace(id: $id) {
      id
      name
      quays {
        id
        name
        estimatedCalls(timeRange: 7200, numberOfDepartures: $numberOfDepartures) {
          aimedDepartureTime
          expectedDepartureTime
          realtime
          destinationDisplay { frontText }
          serviceJourney {
            id
            line { 
              id 
              publicCode 
              name 
              transportMode
              authority { id name } 
            }
          }
        }
      }
    }
  }
`;

// Cache for stopPlace IDs (refreshed every 10 minutes)
let stopPlaceIdsCache = { ids: [], fetchedAt: 0 };
const STOP_PLACE_CACHE_TTL = 10 * 60 * 1000; // 10 min

// Cache for delays (refreshed every 30 seconds)
let delaysCache = { data: [], fetchedAt: 0, mode: '' };
const DELAYS_CACHE_TTL = 30 * 1000; // 30 sec

async function getStopPlaceIds() {
  const now = Date.now();
  if (stopPlaceIdsCache.ids.length > 0 && now - stopPlaceIdsCache.fetchedAt < STOP_PLACE_CACHE_TTL) {
    return stopPlaceIdsCache.ids;
  }

  console.log('Fetching stopPlace IDs for Rogaland...');
  const data = await enturGraphql(STOP_PLACES_QUERY, ROGALAND_BBOX);
  const ids = (data?.stopPlacesByBbox ?? []).map(sp => sp.id);
  console.log(`Found ${ids.length} stopPlaces in Rogaland`);
  
  stopPlaceIdsCache = { ids, fetchedAt: now };
  return ids;
}

async function fetchTopDelays({ transportMode }) {
  const mode = (transportMode ?? TRANSPORT_MODE).toLowerCase();
  
  // Return cached data if still fresh
  const now = Date.now();
  if (delaysCache.data.length > 0 && 
      delaysCache.mode === mode && 
      now - delaysCache.fetchedAt < DELAYS_CACHE_TTL) {
    return delaysCache.data;
  }

  const stopPlaceIds = await getStopPlaceIds();
  
  // Limit to first 500 stopPlaces to avoid timeout (covers main areas)
  const limitedIds = stopPlaceIds.slice(0, 500);
  console.log(`Fetching departures for ${limitedIds.length} stopPlaces...`);
  
  // Fetch departures for all stopPlaces in parallel (batched)
  const BATCH_SIZE = 50;
  const rows = [];

  for (let i = 0; i < limitedIds.length; i += BATCH_SIZE) {
    const batch = limitedIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(id =>
        enturGraphql(STOP_PLACE_DEPARTURES_QUERY, {
          id,
          numberOfDepartures: 3
        }).catch(err => {
          // Silent fail for individual stopPlaces
          return null;
        })
      )
    );

    for (const data of results) {
      if (!data?.stopPlace) continue;
      const sp = data.stopPlace;
      for (const quay of sp.quays ?? []) {
        for (const call of quay.estimatedCalls ?? []) {
          // Filter by transport mode on client side
          const lineMode = call?.serviceJourney?.line?.transportMode?.toLowerCase();
          if (mode && lineMode && lineMode !== mode) continue;
          
          const delayMin = minutesBetween(call.aimedDepartureTime, call.expectedDepartureTime);
          if (delayMin == null || delayMin <= 0) continue; // Only show actual delays
          rows.push({
            delayMin,
            aimedDepartureTime: call.aimedDepartureTime,
            expectedDepartureTime: call.expectedDepartureTime,
            realtime: call.realtime ?? false,
            destination: call?.destinationDisplay?.frontText ?? null,
            linePublicCode: call?.serviceJourney?.line?.publicCode ?? null,
            lineName: call?.serviceJourney?.line?.name ?? null,
            transportMode: lineMode ?? null,
            authority: call?.serviceJourney?.line?.authority?.name ?? null,
            quayName: quay?.name ?? null,
            stopPlaceName: sp?.name ?? null,
            quayId: quay?.id ?? null,
            stopPlaceId: sp?.id ?? null,
            serviceJourneyId: call?.serviceJourney?.id ?? null
          });
        }
      }
    }
    
    // Early exit if we already have enough delayed departures
    if (rows.length >= TOP_N * 3) {
      console.log(`Found enough delays (${rows.length}), stopping early at batch ${i / BATCH_SIZE + 1}`);
      break;
    }
  }

  rows.sort((a, b) => b.delayMin - a.delayMin);
  const result = rows.slice(0, Number.isFinite(TOP_N) ? TOP_N : 25);
  
  // Cache the result
  delaysCache = { data: result, fetchedAt: Date.now(), mode };
  console.log(`Returning ${result.length} delayed departures`);
  
  return result;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/top-delays', async (_req, res) => {
  try {
    const data = await fetchTopDelays({
      transportMode: typeof _req.query.mode === 'string' ? _req.query.mode : undefined
    });
    res.json({
      generatedAt: new Date().toISOString(),
      endpoint: ENTUR_ENDPOINT,
      transportMode:
        typeof _req.query.mode === 'string' ? _req.query.mode : TRANSPORT_MODE,
      topN: TOP_N,
      refreshMs: REFRESH_MS,
      data
    });
  } catch (err) {
    res.status(err?.statusCode ?? 500).json({
      error: err?.message ?? String(err)
    });
  }
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="no">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Forsinkede busser – Rogaland</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border-bottom: 1px solid #eee; padding: 8px; text-align: left; }
      th { position: sticky; top: 0; background: #fff; }
      .muted { color: #666; }
      .delay-high { color: #c00; font-weight: bold; }
      .delay-medium { color: #d60; }
      .realtime { color: #090; }
    </style>
  </head>
  <body>
    <h1>🚌 Forsinkede busser – Rogaland</h1>
    <p class="muted">Henter sanntid fra Entur JourneyPlanner v3 (GraphQL) for Kolumbus-området.</p>
    <div id="meta" class="muted"></div>
    <table>
      <thead>
        <tr>
          <th>Forsinkelse</th>
          <th>Linje</th>
          <th>Destinasjon</th>
          <th>Stopp</th>
          <th>Operatør</th>
          <th>Planlagt</th>
          <th>Forventet</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <script>
      function fmtTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
      }

      function esc(s) {
        return String(s ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      }

      async function load() {
        const res = await fetch('/api/top-delays');
        const json = await res.json();
        if (!res.ok) {
          document.getElementById('meta').textContent = json.error ?? 'Ukjent feil';
          return;
        }
        document.getElementById('meta').textContent = 
          'Sist oppdatert: ' + new Date(json.generatedAt).toLocaleString('no-NO') + 
          ' · Mode: ' + json.transportMode + 
          ' · Viser topp ' + json.topN + ' forsinkelser i Rogaland';
        const tbody = document.getElementById('rows');
        tbody.innerHTML = '';
        for (const row of json.data ?? []) {
          const tr = document.createElement('tr');
          const delayClass = row.delayMin >= 10 ? 'delay-high' : row.delayMin >= 5 ? 'delay-medium' : '';
          const realtimeIcon = row.realtime ? '<span class="realtime" title="Sanntid">●</span> ' : '';
          tr.innerHTML = 
            '<td class="' + delayClass + '">' + row.delayMin + ' min</td>' +
            '<td>' + esc(row.linePublicCode ?? row.lineName ?? '') + '</td>' +
            '<td>' + esc(row.destination ?? '') + '</td>' +
            '<td>' + esc(row.stopPlaceName ?? row.quayName ?? '') + '</td>' +
            '<td>' + esc(row.authority ?? '') + '</td>' +
            '<td>' + fmtTime(row.aimedDepartureTime) + '</td>' +
            '<td>' + realtimeIcon + fmtTime(row.expectedDepartureTime) + '</td>';
          tbody.appendChild(tr);
        }
      }
      load();
      setInterval(load, ${REFRESH_MS});
    </script>
  </body>
</html>`);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`delay-dashboard listening on http://localhost:${PORT}`);
});
