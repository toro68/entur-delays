// Entur GraphQL API - direkte kall fra browser
import { REGIONS, getRegionByLabel } from "../config/regions.js";
const ENTUR_ENDPOINT = 'https://api.entur.io/journey-planner/v3/graphql';
const ENTUR_CLIENT_NAME = 'aftenbladet-forsinkelser';
const TOP_N_DEFAULT = 25;


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
      latitude
      longitude
      transportMode
      quays {
        id
        name
        latitude
        longitude
        estimatedCalls(timeRange: 7200, numberOfDepartures: $numberOfDepartures) {
          aimedDepartureTime
          expectedDepartureTime
          actualDepartureTime
          aimedArrivalTime
          expectedArrivalTime
          actualArrivalTime
          realtime
          cancellation
          realtimeState
          predictionInaccurate
          occupancyStatus
          destinationDisplay { frontText via }
          serviceJourney {
            id
            line {
              id
              publicCode
              name
              transportMode
              transportSubmode
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

  const zone = getRegionByLabel(zoneName) ?? REGIONS[0];
  const data = await enturGraphql(STOP_PLACES_QUERY, zone.bbox);
  const maxStops = Number.isFinite(maxStopsOverride) ? maxStopsOverride : zone.maxStops;
  const ids = (data?.stopPlacesByBbox ?? []).map((sp) => sp.id).slice(0, maxStops);

  stopPlaceIdsCache = { ids, fetchedAt: now, zone: zone.name, maxStops };
  return ids;
}

export async function fetchTopDelays(transportMode = 'bus', options = {}) {
  const mode = transportMode.toLowerCase();
  const zone = options?.zone ?? REGIONS[0].label;
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
          const realtimeState = call?.realtimeState ?? null;
          const isCanceled = call?.cancellation === true || realtimeState === "canceled";

          const lineMode = call?.serviceJourney?.line?.transportMode?.toLowerCase();
          if (mode && lineMode && lineMode !== mode) continue;

          let delayMin = minutesBetween(aimedDepartureTime, expectedDepartureTime);
          if (delayMin == null) delayMin = isCanceled ? 0 : null;
          if (!isCanceled && (delayMin == null || delayMin <= 0)) continue;

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
            actualDepartureTime: call?.actualDepartureTime ?? null,
            aimedArrivalTime: call?.aimedArrivalTime ?? null,
            expectedArrivalTime: call?.expectedArrivalTime ?? null,
            actualArrivalTime: call?.actualArrivalTime ?? null,
            realtime: call.realtime ?? false,
            cancellation: call?.cancellation ?? false,
            realtimeState,
            predictionInaccurate: call?.predictionInaccurate ?? false,
            occupancyStatus: call?.occupancyStatus ?? null,
            destination: call?.destinationDisplay?.frontText ?? null,
            via: call?.destinationDisplay?.via ?? [],
            linePublicCode: call?.serviceJourney?.line?.publicCode ?? null,
            lineName: call?.serviceJourney?.line?.name ?? null,
            transportSubmode: call?.serviceJourney?.line?.transportSubmode ?? null,
            transportMode: lineMode ?? null,
            authority: call?.serviceJourney?.line?.authority?.name ?? null,
            quayName: quay?.name ?? null,
            stopPlaceName: sp?.name ?? null,
            quayLatitude: quay?.latitude ?? null,
            quayLongitude: quay?.longitude ?? null,
            stopPlaceLatitude: sp?.latitude ?? null,
            stopPlaceLongitude: sp?.longitude ?? null,
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
