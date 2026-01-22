// Entur GraphQL API - direkte kall fra browser
import { REGIONS, getRegionByLabel } from "../config/regions.js";
const ENTUR_ENDPOINT = 'https://api.entur.io/journey-planner/v3/graphql';
const ENTUR_CLIENT_NAME = 'aftenbladet-forsinkelser';
const ENTUR_VM_ENDPOINT = 'https://api.entur.io/realtime/v1/rest/vm';
const ENTUR_VM_REQUESTOR = 'aftenbladet-forsinkelser-vm';
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
  query StopPlaceDepartures($ids: [String!]!, $numberOfDepartures: Int!, $timeRange: Int!) {
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
        estimatedCalls(timeRange: $timeRange, numberOfDepartures: $numberOfDepartures) {
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
          datedServiceJourney {
            id
          }
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
let delaysCache = { data: [], fetchedAt: 0, mode: '', zone: '', viewMode: '' };
let vehicleCache = { data: new Map(), fetchedAt: 0 };
const STOP_PLACE_CACHE_TTL = 10 * 60 * 1000; // 10 min
const DELAYS_CACHE_TTL = 30 * 1000; // 30 sec
const VEHICLE_CACHE_TTL = 30 * 1000; // 30 sec

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

export async function fetchVehiclePositions(datasource = 'KOL') {
  const now = Date.now();
  if (vehicleCache.data.size > 0 && now - vehicleCache.fetchedAt < VEHICLE_CACHE_TTL) {
    return vehicleCache.data;
  }

  const url = new URL(ENTUR_VM_ENDPOINT);
  url.searchParams.set('requestorId', ENTUR_VM_REQUESTOR);
  if (datasource) url.searchParams.set('datasource', datasource);

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Entur VM feil: ${res.status}`);
  }

  const xmlText = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const map = new Map();

  const activities = doc.getElementsByTagName('VehicleActivity');
  for (const activity of activities) {
    const journey = activity.getElementsByTagName('MonitoredVehicleJourney')[0];
    if (!journey) continue;
    const datedRef = journey.getElementsByTagName('DatedVehicleJourneyRef')[0]?.textContent?.trim() ?? null;
    const vehicleJourneyRef = journey.getElementsByTagName('VehicleJourneyRef')[0]?.textContent?.trim() ?? null;
    const vehicleRef = journey.getElementsByTagName('VehicleRef')[0]?.textContent?.trim() ?? null;
    if (vehicleRef) {
      if (datedRef) map.set(datedRef, vehicleRef);
      if (vehicleJourneyRef) map.set(vehicleJourneyRef, vehicleRef);
    }
  }

  vehicleCache = { data: map, fetchedAt: now };
  return map;
}

async function getStopPlaceIdsByZone(zoneName, maxStopsOverride, includeAllStops = false) {
  const now = Date.now();
  const cacheMaxStops = Number.isFinite(stopPlaceIdsCache.maxStops)
    ? stopPlaceIdsCache.maxStops
    : 0;
  const requestedMaxStops = Number.isFinite(maxStopsOverride) ? maxStopsOverride : null;

  if (
    stopPlaceIdsCache.ids.length > 0 &&
    stopPlaceIdsCache.zone === zoneName &&
    (includeAllStops || requestedMaxStops == null || cacheMaxStops >= requestedMaxStops) &&
    now - stopPlaceIdsCache.fetchedAt < STOP_PLACE_CACHE_TTL
  ) {
    if (includeAllStops || requestedMaxStops == null) return stopPlaceIdsCache.ids;
    return stopPlaceIdsCache.ids.slice(0, requestedMaxStops);
  }

  const zone = getRegionByLabel(zoneName) ?? REGIONS[0];
  const data = await enturGraphql(STOP_PLACES_QUERY, zone.bbox);
  const maxStops = includeAllStops
    ? Number.POSITIVE_INFINITY
    : (Number.isFinite(maxStopsOverride) ? maxStopsOverride : zone.maxStops);
  const ids = (data?.stopPlacesByBbox ?? []).map((sp) => sp.id).slice(0, maxStops);

  stopPlaceIdsCache = { ids, fetchedAt: now, zone: zone.name, maxStops };
  return ids;
}

export async function fetchTopDelays(transportMode = 'bus', options = {}) {
  const mode = transportMode.toLowerCase();
  const zone = options?.zone ?? REGIONS[0].label;
  const topN = options?.topN ?? TOP_N_DEFAULT;
  const maxStopsOverride = options?.maxStops;
  const viewMode = options?.viewMode ?? "delays";
  const includeAllStops = options?.includeAllStops === true;
  const includeAllCalls = viewMode === "all";
  const timeRange = includeAllCalls ? 21600 : 7200;
  const numberOfDepartures = includeAllCalls ? 10 : 3;
  
  // Return cached data if fresh
  const now = Date.now();
  if (
    delaysCache.data.length > 0 &&
    delaysCache.mode === mode &&
    delaysCache.zone === zone &&
    delaysCache.viewMode === viewMode &&
    now - delaysCache.fetchedAt < DELAYS_CACHE_TTL
  ) {
    return {
      generatedAt: new Date(delaysCache.fetchedAt).toISOString(),
      transportMode: mode,
      topN,
      data: delaysCache.data
    };
  }

  const stopPlaceIds = await getStopPlaceIdsByZone(zone, maxStopsOverride, includeAllStops);

  // Fetch in batches (single GraphQL request per batch)
  const BATCH_SIZE = 25;
  const rows = [];
  const seen = new Set();

  // Hent alle stoppesteder (allerede prioritert etter sone)
  for (let i = 0; i < stopPlaceIds.length; i += BATCH_SIZE) {
    const batch = stopPlaceIds.slice(i, i + BATCH_SIZE);

    const data = await enturGraphql(STOP_PLACE_DEPARTURES_QUERY, {
      ids: batch,
      numberOfDepartures,
      timeRange,
    }).catch(() => null);
    const stopPlaces = data?.stopPlaces ?? [];

    for (const sp of stopPlaces) {
      if (!sp) continue;
      for (const quay of sp.quays ?? []) {
        for (const call of quay.estimatedCalls ?? []) {
          const serviceJourneyId = call?.serviceJourney?.id ?? null;
          const datedServiceJourneyId = call?.datedServiceJourney?.id ?? null;
          const aimedDepartureTime = call?.aimedDepartureTime ?? null;
          const expectedDepartureTime = call?.expectedDepartureTime ?? null;
          const realtimeState = call?.realtimeState ?? null;
          const isCanceled = call?.cancellation === true || realtimeState === "canceled";

          const lineMode = call?.serviceJourney?.line?.transportMode?.toLowerCase();
          if (mode && lineMode && lineMode !== mode) continue;

          let delayMin = minutesBetween(aimedDepartureTime, expectedDepartureTime);
          if (delayMin == null) delayMin = isCanceled ? 0 : null;
          if (includeAllCalls) {
            // keep all calls
          } else if (viewMode === "cancellations") {
            if (!isCanceled) continue;
          } else if (!isCanceled && (delayMin == null || delayMin <= 0)) {
            continue;
          }

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
            datedServiceJourneyId,
          });
        }
      }
    }
  }

  let result = [];
  if (includeAllCalls) {
    result = rows;
    result.sort((a, b) => String(a.expectedDepartureTime ?? a.aimedDepartureTime ?? "").localeCompare(
      String(b.expectedDepartureTime ?? b.aimedDepartureTime ?? "")
    ));
    result = result.slice(0, topN);
  } else if (viewMode === "cancellations") {
    const cancelMap = new Map();
    for (const row of rows) {
      const key = row.serviceJourneyId && row.aimedDepartureTime
        ? `${row.serviceJourneyId}|${row.aimedDepartureTime}`
        : `${row.stopPlaceId ?? ""}|${row.quayId ?? ""}|${row.aimedDepartureTime ?? ""}`;
      if (!cancelMap.has(key)) cancelMap.set(key, row);
    }
    result = Array.from(cancelMap.values());
    result.sort((a, b) => String(b.expectedDepartureTime ?? b.aimedDepartureTime ?? "").localeCompare(
      String(a.expectedDepartureTime ?? a.aimedDepartureTime ?? "")
    ));
    result = result.slice(0, topN);
  } else {
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
    result = uniqueRows.slice(0, topN);
  }
  
  // Cache
  delaysCache = { data: result, fetchedAt: Date.now(), mode, zone, viewMode };
  
  return {
      generatedAt: new Date().toISOString(),
      transportMode: mode,
      topN,
      data: result
  };
}
