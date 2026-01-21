<script>
  import { onMount, onDestroy } from "svelte";
  import { fetchTopDelays } from "../utils/entur.js";

  const REFRESH_MS = 60000; // 1 minutt

  const ZONES = ["Nord-Jæren", "Jæren", "Ryfylke", "Dalane"];

  let delays = $state([]);
  let query = $state("");
  let meta = $state({ generatedAt: null, transportMode: "", topN: 0 });
  let loading = $state(true);
  let refreshing = $state(false);
  let error = $state(null);
  let intervalId = null;
  let activeZone = $state(ZONES[0]);

  function normalizeQuery(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  function rowMatchesQuery(row, normalized) {
    if (!normalized) return true;
    const haystack = `${row?.linePublicCode ?? ""} ${row?.lineName ?? ""} ${row?.destination ?? ""} ${row?.stopPlaceName ?? ""} ${row?.quayName ?? ""}`.toLowerCase();
    return haystack.includes(normalized);
  }

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("no-NO", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getDelayClass(delayMin) {
    if (delayMin >= 10) return "delay-high";
    if (delayMin >= 5) return "delay-medium";
    return "delay-low";
  }

  async function fetchDelays() {
    const isInitial = loading;
    if (!isInitial) refreshing = true;
    try {
      const result = await fetchTopDelays("bus", { zone: activeZone });

      error = null;
      delays = result.data ?? [];
      meta = {
        generatedAt: result.generatedAt,
        transportMode: result.transportMode,
        topN: result.topN,
      };
    } catch (e) {
      error = e.message ?? "Nettverksfeil";
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function getRowKey(row) {
    if (row?.serviceJourneyId && row?.aimedDepartureTime) {
      return `${row.serviceJourneyId}|${row.aimedDepartureTime}`;
    }
    return `${row?.stopPlaceId ?? ""}|${row?.quayId ?? ""}|${row?.expectedDepartureTime ?? ""}|${row?.linePublicCode ?? row?.lineName ?? ""}|${row?.destination ?? ""}`;
  }

  const normalizedQuery = $derived(normalizeQuery(query));
  const filteredDelays = $derived(delays.filter((row) => rowMatchesQuery(row, normalizedQuery)));

  function setZone(zone) {
    if (zone === activeZone) return;
    activeZone = zone;
    query = "";
    loading = true;
    fetchDelays();
  }

  onMount(() => {
    fetchDelays();
    intervalId = setInterval(fetchDelays, REFRESH_MS);
  });

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
  });
</script>

<div class="delay-table-wrapper">
  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Henter sanntidsdata fra Entur...</p>
    </div>
  {:else if error}
    <div class="error">
      <p>⚠️ {error}</p>
    </div>
  {:else}
    <div class="meta">
      Oppdatert {formatDate(meta.generatedAt)} · {meta.transportMode} · Topp {meta.topN} forsinkelser
      {#if refreshing}
        <span class="refreshing">Oppdaterer…</span>
      {/if}
    </div>

    <nav class="zone-tabs" aria-label="Områder">
      {#each ZONES as zone}
        <button
          type="button"
          class="zone-tab"
          class:is-active={zone === activeZone}
          onclick={() => setZone(zone)}
        >
          {zone}
        </button>
      {/each}
    </nav>

    <div class="controls">
      <label class="search">
        <span class="label">Søk linje</span>
        <input
          type="search"
          placeholder="f.eks. 1, 7, X60..."
          bind:value={query}
        />
      </label>
      {#if normalizedQuery}
        <div class="result-count">Viser {filteredDelays.length} av {delays.length}</div>
      {/if}
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th class="col-delay">Forsinkelse</th>
            <th class="col-line">Linje</th>
            <th class="col-dest">Destinasjon</th>
            <th class="col-stop">Stopp</th>
            <th class="col-time">Planlagt</th>
            <th class="col-time">Forventet</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredDelays as row (getRowKey(row))}
            <tr>
              <td class="col-delay {getDelayClass(row.delayMin)}">
                {row.delayMin} min
              </td>
              <td class="col-line">
                <span class="line-badge">{row.linePublicCode ?? row.lineName ?? "–"}</span>
              </td>
              <td class="col-dest">{row.destination ?? "–"}</td>
              <td class="col-stop">{row.stopPlaceName ?? row.quayName ?? "–"}</td>
              <td class="col-time">{formatTime(row.aimedDepartureTime)}</td>
              <td class="col-time">
                {#if row.realtime}
                  <span class="realtime-dot" title="Sanntid">●</span>
                {/if}
                {formatTime(row.expectedDepartureTime)}
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="6" class="no-data">Ingen treff</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style lang="scss">
  $panel: #0b1221;
  $panel-soft: #111a2d;
  $card-radius: 14px;
  $shadow-soft: 0 12px 40px rgba(0, 0, 0, 0.18);
  $accent: #60a5fa;
  $delay-high: #ef4444;
  $delay-medium: #f97316;
  $delay-low: #eab308;
  $realtime-green: #22c55e;

  .delay-table-wrapper {
    background: $panel;
    border-radius: $card-radius;
    box-shadow: $shadow-soft;
    overflow: hidden;
  }

  .loading,
  .error {
    padding: 48px 24px;
    text-align: center;
    color: #94a3b8;
  }

  .error {
    color: $delay-high;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid $panel-soft;
    border-top-color: $accent;
    border-radius: 50%;
    margin: 0 auto 16px;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .meta {
    padding: 16px 20px;
    font-size: 0.85rem;
    color: #64748b;
    border-bottom: 1px solid $panel-soft;
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .refreshing {
    color: $accent;
    font-weight: 600;
  }

  .controls {
    padding: 12px 20px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid $panel-soft;
  }

  .zone-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 20px;
    border-bottom: 1px solid $panel-soft;
    background: rgba(15, 23, 42, 0.25);
  }

  .zone-tab {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(15, 23, 42, 0.55);
    color: #cbd5e1;
    border-radius: 999px;
    padding: 8px 12px;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;

    &:hover {
      border-color: rgba(96, 165, 250, 0.55);
      background: rgba(96, 165, 250, 0.12);
    }

    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.18);
      border-color: rgba(96, 165, 250, 0.55);
    }

    &.is-active {
      background: rgba(96, 165, 250, 0.25);
      border-color: rgba(96, 165, 250, 0.75);
      color: #e2e8f0;
    }
  }

  .search {
    display: grid;
    gap: 6px;
  }

  .label {
    font-size: 0.75rem;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  input[type="search"] {
    width: min(360px, 70vw);
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(15, 23, 42, 0.55);
    color: #e2e8f0;
    outline: none;

    &:focus {
      border-color: rgba(96, 165, 250, 0.55);
      box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.18);
    }
  }

  .result-count {
    font-size: 0.85rem;
    color: #64748b;
  }

  .table-container {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 12px 16px;
    text-align: left;
    white-space: nowrap;
  }

  th {
    background: $panel-soft;
    color: #94a3b8;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: sticky;
    top: 0;
  }

  tbody tr {
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    transition: background 0.15s ease;

    &:hover {
      background: rgba(96, 165, 250, 0.08);
    }
  }

  .col-delay {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .delay-high {
    color: $delay-high;
  }

  .delay-medium {
    color: $delay-medium;
  }

  .delay-low {
    color: $delay-low;
  }

  .line-badge {
    display: inline-block;
    background: $accent;
    color: #0f172a;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .col-dest,
  .col-stop {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .col-time {
    font-variant-numeric: tabular-nums;
    color: #cbd5e1;
  }

  .realtime-dot {
    color: $realtime-green;
    margin-right: 4px;
  }

  .no-data {
    text-align: center;
    color: #64748b;
    padding: 48px 24px;
  }

  @media (max-width: 768px) {
    th,
    td {
      padding: 10px 12px;
      font-size: 0.9rem;
    }

    .col-dest,
    .col-stop {
      max-width: 120px;
    }

    .controls {
      flex-direction: column;
      align-items: stretch;
    }

    input[type="search"] {
      width: 100%;
    }
  }
</style>
