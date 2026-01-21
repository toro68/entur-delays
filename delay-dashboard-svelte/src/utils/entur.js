// Entur GraphQL API - direkte kall fra browser
const ENTUR_ENDPOINT = 'https://api.entur.io/journey-planner/v3/graphql';
const ENTUR_CLIENT_NAME = 'aftenbladet-forsinkelser';
const TOP_N = 25;

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
  
  // Limit to first 200 stopPlaces for browser performance
  const limitedIds = stopPlaceIds.slice(0, 200);
  
  // Fetch in batches
  const BATCH_SIZE = 20;
  const rows = [];

  for (let i = 0; i < limitedIds.length; i += BATCH_SIZE) {
    const batch = limitedIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(id =>
        enturGraphql(STOP_PLACE_DEPARTURES_QUERY, {
          id,
          numberOfDepartures: 3
        }).catch(() => null)
      )
    );

    for (const data of results) {
      if (!data?.stopPlace) continue;
      const sp = data.stopPlace;
      for (const quay of sp.quays ?? []) {
        for (const call of quay.estimatedCalls ?? []) {
          const lineMode = call?.serviceJourney?.line?.transportMode?.toLowerCase();
          if (mode && lineMode && lineMode !== mode) continue;
          
          const delayMin = minutesBetween(call.aimedDepartureTime, call.expectedDepartureTime);
          if (delayMin == null || delayMin <= 0) continue;
          
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
    
    // Early exit if we have enough
    if (rows.length >= TOP_N * 3) break;
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
