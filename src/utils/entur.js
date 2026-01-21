// Entur GraphQL API - direkte kall fra browser
const ENTUR_ENDPOINT = 'https://api.entur.io/journey-planner/v3/graphql';
const ENTUR_CLIENT_NAME = 'aftenbladet-forsinkelser';
const TOP_N_DEFAULT = 25;

const ZONES = [
  {
    name: 'Nord-Jæren',
    bbox: { minLat: 58.85, maxLat: 59.05, minLon: 5.6, maxLon: 6.1 },
    maxStops: 300 // Stavanger, Sandnes, Sola, Randaberg
  },
  {
    name: 'Jæren',
    bbox: { minLat: 58.6, maxLat: 58.85, minLon: 5.5, maxLon: 6.0 },
    maxStops: 100 // Time, Klepp, Hå, Gjesdal
  },
  {
    name: 'Ryfylke',
    bbox: { minLat: 59.0, maxLat: 59.5, minLon: 5.8, maxLon: 7.2 },
    maxStops: 60 // Strand, Hjelmeland, Forsand
  },
  {
    name: 'Dalane',
    // Dalane ligger lenger sør/vest; sørg for at Eigersund/Sokndal dekkes.
    bbox: { minLat: 58.15, maxLat: 58.7, minLon: 5.2, maxLon: 6.9 },
    maxStops: 80 // Eigersund, Sokndal, Lund, Bjerkreim
  }
];

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
  query StopPlaceDepartures($ids: [String!]!, $numberOfDepartures: Int!) {
    stopPlaces(ids: $ids) {
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

// Cache
let stopPlaceIdsCache = { ids: [], fetchedAt: 0, zone: '', maxStops: 0 };
let delaysCache = { data: [], fetchedAt: 0, mode: '', zone: '' };
const STOP_PLACE_CACHE_TTL = 10 * 60 * 1000; // 10 min
const DELAYS_CACHE_TTL = 30 * 1000; // 30 sec

function minutesBetween(aimedIso, expectedIso) {
  if (!aimedIso || !expectedIso) return null;
  const aimedMs = Date.parse(aimedIso);
  const expectedMs = Date.parse(expectedIso);
  if (!Number.isFinite(aimedMs) || !Number.isFinite(expectedMs)) return null;
  return Math.round((expectedMs - aimedMs) / 60000);
}

async function enturGraphql(query, variables) {
  const res = await fetch(ENTUR_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ET-Client-Name': ENTUR_CLIENT_NAME
    },
    body: JSON.stringify({ query, variables })
  });

  if (!res.ok) {
    throw new Error(`Entur API feil: ${res.status}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`GraphQL feil: ${json.errors[0].message}`);
  }
  return json.data;
}

async function getStopPlaceIdsByZone(zoneName, maxStopsOverride) {
  const now = Date.now();
  const cacheMaxStops = Number.isFinite(stopPlaceIdsCache.maxStops)
    ? stopPlaceIdsCache.maxStops
    : 0;
  const requestedMaxStops = Number.isFinite(maxStopsOverride) ? maxStopsOverride : null;

  if (
    stopPlaceIdsCache.ids.length > 0 &&
    stopPlaceIdsCache.zone === zoneName &&
    (requestedMaxStops == null || cacheMaxStops >= requestedMaxStops) &&
    now - stopPlaceIdsCache.fetchedAt < STOP_PLACE_CACHE_TTL
  ) {
    return requestedMaxStops == null
      ? stopPlaceIdsCache.ids
      : stopPlaceIdsCache.ids.slice(0, requestedMaxStops);
  }

  const zone = ZONES.find((candidate) => candidate.name === zoneName) ?? ZONES[0];
  const data = await enturGraphql(STOP_PLACES_QUERY, zone.bbox);
  const maxStops = Number.isFinite(maxStopsOverride) ? maxStopsOverride : zone.maxStops;
  const ids = (data?.stopPlacesByBbox ?? []).map((sp) => sp.id).slice(0, maxStops);

  stopPlaceIdsCache = { ids, fetchedAt: now, zone: zone.name, maxStops };
  return ids;
}

export async function fetchTopDelays(transportMode = 'bus', options = {}) {
  const mode = transportMode.toLowerCase();
  const zone = options?.zone ?? ZONES[0].name;
  const topN = options?.topN ?? TOP_N_DEFAULT;
  const maxStopsOverride = options?.maxStops;
  
  // Return cached data if fresh
  const now = Date.now();
  if (
    delaysCache.data.length > 0 &&
    delaysCache.mode === mode &&
    delaysCache.zone === zone &&
    now - delaysCache.fetchedAt < DELAYS_CACHE_TTL
  ) {
    return {
      generatedAt: new Date(delaysCache.fetchedAt).toISOString(),
      transportMode: mode,
      topN,
      data: delaysCache.data
    };
  }

  const stopPlaceIds = await getStopPlaceIdsByZone(zone, maxStopsOverride);

  // Fetch in batches (single GraphQL request per batch)
  const BATCH_SIZE = 25;
  const rows = [];
  const seen = new Set();

  // Hent alle stoppesteder (allerede prioritert etter sone)
  for (let i = 0; i < stopPlaceIds.length; i += BATCH_SIZE) {
    const batch = stopPlaceIds.slice(i, i + BATCH_SIZE);

    const data = await enturGraphql(STOP_PLACE_DEPARTURES_QUERY, {
      ids: batch,
      numberOfDepartures: 3,
    }).catch(() => null);
    const stopPlaces = data?.stopPlaces ?? [];

    for (const sp of stopPlaces) {
      if (!sp) continue;
      for (const quay of sp.quays ?? []) {
        for (const call of quay.estimatedCalls ?? []) {
          const serviceJourneyId = call?.serviceJourney?.id ?? null;
          const aimedDepartureTime = call?.aimedDepartureTime ?? null;
          const expectedDepartureTime = call?.expectedDepartureTime ?? null;

          const lineMode = call?.serviceJourney?.line?.transportMode?.toLowerCase();
          if (mode && lineMode && lineMode !== mode) continue;

          const delayMin = minutesBetween(aimedDepartureTime, expectedDepartureTime);
          if (delayMin == null || delayMin <= 0) continue;

          // Dedup: same serviceJourney + aimedDepartureTime can appear across stop places.
          if (serviceJourneyId && aimedDepartureTime) {
            const key = `${serviceJourneyId}|${aimedDepartureTime}`;
            if (seen.has(key)) continue;
            seen.add(key);
          }

          rows.push({
            delayMin,
            aimedDepartureTime,
            expectedDepartureTime,
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
            serviceJourneyId,
          });
        }
      }
    }
  }

  const dedupedMap = new Map();
  for (const row of rows) {
    const lineKey = row.linePublicCode ?? row.lineName ?? null;
    const key = lineKey
      ? `${lineKey}|${row.destination ?? ""}`
      : `__sj:${row.serviceJourneyId ?? ""}|${row.aimedDepartureTime ?? ""}|${row.stopPlaceId ?? ""}`;

    const existing = dedupedMap.get(key);
    if (!existing || row.delayMin > existing.delayMin) {
      dedupedMap.set(key, row);
    }
  }

  const uniqueRows = Array.from(dedupedMap.values());
  uniqueRows.sort((a, b) => b.delayMin - a.delayMin);
  const result = uniqueRows.slice(0, topN);
  
  // Cache
  delaysCache = { data: result, fetchedAt: Date.now(), mode, zone };
  
  return {
      generatedAt: new Date().toISOString(),
      transportMode: mode,
      topN,
      data: result
  };
}
