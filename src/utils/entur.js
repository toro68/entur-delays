// Entur GraphQL API - direkte kall fra browser
const ENTUR_ENDPOINT = 'https://api.entur.io/journey-planner/v3/graphql';
const ENTUR_CLIENT_NAME = 'aftenbladet-forsinkelser';
const TOP_N = 25;

const ZONES = [
  {
    name: 'Nord-Jæren',
    bbox: { minLat: 58.85, maxLat: 59.05, minLon: 5.6, maxLon: 6.1 },
    maxStops: 200 // Stavanger, Sandnes, Sola, Randaberg
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
    bbox: { minLat: 58.4, maxLat: 58.6, minLon: 5.8, maxLon: 6.8 },
    maxStops: 40 // Eigersund, Sokndal, Lund, Bjerkreim
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
let stopPlaceIdsCache = { ids: [], fetchedAt: 0, zone: '' };
let delaysCache = { data: [], fetchedAt: 0, mode: '' };
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

async function getStopPlaceIdsByZone(zoneName) {
  const now = Date.now();
  if (
    stopPlaceIdsCache.ids.length > 0 &&
    stopPlaceIdsCache.zone === zoneName &&
    now - stopPlaceIdsCache.fetchedAt < STOP_PLACE_CACHE_TTL
  ) {
    return stopPlaceIdsCache.ids;
  }

  const zone = ZONES.find((candidate) => candidate.name === zoneName) ?? ZONES[0];
  const data = await enturGraphql(STOP_PLACES_QUERY, zone.bbox);
  const ids = (data?.stopPlacesByBbox ?? []).map((sp) => sp.id).slice(0, zone.maxStops);

  stopPlaceIdsCache = { ids, fetchedAt: now, zone: zone.name };
  return ids;
}

export async function fetchTopDelays(transportMode = 'bus', options = {}) {
  const mode = transportMode.toLowerCase();
  const zone = options?.zone ?? ZONES[0].name;
  
  // Return cached data if fresh
  const now = Date.now();
  if (delaysCache.data.length > 0 && 
      delaysCache.mode === mode && 
      now - delaysCache.fetchedAt < DELAYS_CACHE_TTL) {
    return {
      generatedAt: new Date(delaysCache.fetchedAt).toISOString(),
      transportMode: mode,
      topN: TOP_N,
      data: delaysCache.data
    };
  }

  const stopPlaceIds = await getStopPlaceIdsByZone(zone);

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

  rows.sort((a, b) => b.delayMin - a.delayMin);
  const result = rows.slice(0, TOP_N);
  
  // Cache
  delaysCache = { data: result, fetchedAt: Date.now(), mode };
  
  return {
    generatedAt: new Date().toISOString(),
    transportMode: mode,
    topN: TOP_N,
    data: result
  };
}
