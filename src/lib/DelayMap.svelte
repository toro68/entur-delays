<script>
  import { onMount, onDestroy } from "svelte";
  import L from "leaflet";

  export let rows = [];
  export let bbox = null;

  let map;
  let layer;
  let mapEl;

  function getCoordinates(row) {
    const lat = row?.quayLatitude ?? row?.stopPlaceLatitude ?? null;
    const lon = row?.quayLongitude ?? row?.stopPlaceLongitude ?? null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return [lat, lon];
  }

  function colorForDelay(delayMin) {
    if (delayMin >= 10) return "#ef4444";
    if (delayMin >= 5) return "#f97316";
    return "#eab308";
  }

  function fitToBbox() {
    if (!map || !bbox) return;
    const bounds = L.latLngBounds(
      [bbox.minLat, bbox.minLon],
      [bbox.maxLat, bbox.maxLon]
    );
    map.fitBounds(bounds, { padding: [16, 16] });
  }

  function updateMarkers() {
    if (!layer) return;
    layer.clearLayers();
    const points = rows
      .map((row) => ({ row, coords: getCoordinates(row) }))
      .filter((item) => item.coords);

    for (const { row, coords } of points) {
      const delay = row?.delayMin ?? 0;
      const marker = L.circleMarker(coords, {
        radius: 6,
        color: colorForDelay(delay),
        weight: 2,
        fillColor: colorForDelay(delay),
        fillOpacity: 0.7,
      });
      const lineLabel = row?.linePublicCode ?? row?.lineName ?? "–";
      const destination = row?.destination ?? "–";
      const stop = row?.stopPlaceName ?? row?.quayName ?? "–";
      marker.bindTooltip(
        `<strong>${lineLabel}</strong> · ${delay} min<br/>${destination}<br/>${stop}`,
        { direction: "top" }
      );
      marker.addTo(layer);
    }
  }

  onMount(() => {
    map = L.map(mapEl, {
      zoomControl: true,
      scrollWheelZoom: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    layer = L.layerGroup().addTo(map);

    if (bbox) {
      fitToBbox();
    } else {
      map.setView([58.97, 5.73], 10);
    }

    updateMarkers();
  });

  $effect(() => {
    if (map && layer) {
      updateMarkers();
    }
  });

  $effect(() => {
    if (map && bbox) {
      fitToBbox();
    }
  });

  onDestroy(() => {
    if (map) map.remove();
  });
</script>

<div class="map-wrapper">
  <div bind:this={mapEl} class="map"></div>
</div>

<style>
  .map-wrapper {
    height: 520px;
    width: 100%;
  }

  .map {
    height: 100%;
    width: 100%;
    background: #0f172a;
  }
</style>
