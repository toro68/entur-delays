// Entur GraphQL API - direkte kall fra browser
const ENTUR_ENDPOINT = 'https://api.entur.io/journey-planner/v3/graphql';
const ENTUR_CLIENT_NAME = 'aftenbladet-forsinkelser';
const TOP_N = 25;
const MAX_STOP_PLACES = 200;

// Bounding box for Sør-Rogaland (ekskluderer Haugalandet)
const ROGALAND_BBOX = {
  minLat: 58.4,
  maxLat: 59.15,
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
let stopPlaceIdsCache = { ids: [], fetchedAt: 0 };
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

async function getStopPlaceIds() {
  const now = Date.now();
  if (stopPlaceIdsCache.ids.length > 0 && now - stopPlaceIdsCache.fetchedAt < STOP_PLACE_CACHE_TTL) {
    return stopPlaceIdsCache.ids;
  }

  const data = await enturGraphql(STOP_PLACES_QUERY, ROGALAND_BBOX);
  const ids = (data?.stopPlacesByBbox ?? []).map(sp => sp.id);
  
  stopPlaceIdsCache = { ids, fetchedAt: now };
  return ids;
}

export async function fetchTopDelays(transportMode = 'bus') {
  const mode = transportMode.toLowerCase();
  
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

  const stopPlaceIds = await getStopPlaceIds();

  // Adaptiv limit: start lavt og øk til vi har nok kandidater.
  const limitSteps = [50, 100, 150, MAX_STOP_PLACES];
  
  // Fetch in batches (single GraphQL request per batch)
  const BATCH_SIZE = 25;
  const rows = [];
  const seen = new Set();

  for (const limit of limitSteps) {
    const limitedIds = stopPlaceIds.slice(0, Math.min(limit, MAX_STOP_PLACES));

    for (let i = 0; i < limitedIds.length; i += BATCH_SIZE) {
      const batch = limitedIds.slice(i, i + BATCH_SIZE);

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

      // Early exit if we have enough
      if (rows.length >= TOP_N * 3) break;
    }

    if (rows.length >= TOP_N * 2) break;
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
