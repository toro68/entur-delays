<script>
  import { onMount, onDestroy } from "svelte";
  import { fetchTopDelays } from "../utils/entur.js";
  import { REGIONS, getRegionByLabel, isRowInRegion } from "../config/regions.js";

  const REFRESH_MS = 60000; // 1 minutt
  const INITIAL_TOP_N = 25;
  const TOP_N_STEP = 25;
  const INITIAL_PAGE = 1;
  const DEFAULT_MAX_STOPS_BY_ZONE = Object.fromEntries(
    REGIONS.map((region) => [region.label, region.maxStops ?? Number.POSITIVE_INFINITY])
  );

  const TRANSPORT_MODES = [
    { value: "bus", label: "Buss" },
    { value: "water", label: "Båt" },
    { value: "rail", label: "Tog" },
  ];
  const VIEW_MODES = [
    { value: "delays", label: "Forsinkelser" },
    { value: "cancellations", label: "Innstillingskartet" },
  ];

  const ZONES = REGIONS.map((r) => r.label);

  let delays = $state([]);
  let query = $state("");
  let meta = $state({ generatedAt: null, transportMode: "", topN: 0 });
  let loading = $state(true);
  let refreshing = $state(false);
  let error = $state(null);
  let intervalId = null;
  let activeZone = $state(ZONES[0]);
  let topN = $state(INITIAL_TOP_N);
  let includeAllStops = $state(false);
  let page = $state(INITIAL_PAGE);
  let transportMode = $state("bus");
  let viewMode = $state("delays");

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

  function formatJourneyId(id) {
    if (!id) return "–";
    const s = String(id);
    return s.length > 12 ? s.slice(-12) : s;
  }

  function getDelayClass(delayMin) {
    if (delayMin >= 10) return "delay-high";
    if (delayMin >= 5) return "delay-medium";
    return "delay-low";
  }

  function formatStatus(row) {
    if (row?.cancellation) return "Kansellert";
    const state = row?.realtimeState ?? null;
    if (!state) return "Planlagt";
    if (state === "updated" || state === "modified") return "Oppdatert";
    if (state === "canceled") return "Kansellert";
    return state;
  }

  function formatDestination(row) {
    const base = row?.destination ?? "–";
    const via = Array.isArray(row?.via) ? row.via.filter(Boolean) : [];
    if (!via.length) return base;
    return `${base} (via ${via.join(", ")})`;
  }

  async function fetchDelays() {
    const isInitial = loading;
    if (!isInitial) refreshing = true;
    try {
      const maxStops = includeAllStops ? Number.POSITIVE_INFINITY : DEFAULT_MAX_STOPS_BY_ZONE[activeZone];
      const result = await fetchTopDelays(transportMode, {
        zone: activeZone,
        topN,
        maxStops,
        viewMode,
      });

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
  const activeRegion = $derived(getRegionByLabel(activeZone));
  const filteredByView = $derived(
    viewMode === "cancellations"
      ? delays.filter((row) => row?.cancellation || row?.realtimeState === "canceled")
      : delays
  );
  const filteredDelays = $derived(
    filteredByView
      .filter((row) => isRowInRegion(row, activeRegion))
      .filter((row) => rowMatchesQuery(row, normalizedQuery))
  );

  const pageCount = $derived(Math.max(1, Math.ceil(filteredDelays.length / TOP_N_STEP)));
  const pagedDelays = $derived(
    filteredDelays.slice((page - 1) * TOP_N_STEP, (page - 1) * TOP_N_STEP + TOP_N_STEP)
  );

  function setZone(zone) {
    if (zone === activeZone) return;
    activeZone = zone;
    query = "";
    topN = INITIAL_TOP_N;
    includeAllStops = false;
    page = INITIAL_PAGE;
    loading = true;
    fetchDelays();
  }

  function setTransportMode(mode) {
    if (mode === transportMode) return;
    transportMode = mode;
    query = "";
    topN = INITIAL_TOP_N;
    includeAllStops = false;
    page = INITIAL_PAGE;
    loading = true;
    fetchDelays();
  }

  function setViewMode(mode) {
    if (mode === viewMode) return;
    viewMode = mode;
    query = "";
    topN = INITIAL_TOP_N;
    includeAllStops = false;
    page = INITIAL_PAGE;
    loading = true;
    fetchDelays();
  }

  function showMore() {
    if (page < pageCount) {
      page += 1;
      return;
    }
    topN += TOP_N_STEP;
    page += 1;
    loading = true;
    fetchDelays();
  }

  function showPrevious() {
    if (page <= 1) return;
    page -= 1;
  }

  function loadAllStops() {
    includeAllStops = true;
    topN = INITIAL_TOP_N;
    page = INITIAL_PAGE;
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
      Oppdatert {formatDate(meta.generatedAt)} · {meta.transportMode} · Topp {meta.topN}
      {#if viewMode === "cancellations"}
        innstillinger
      {:else}
        forsinkelser
      {/if}
      {#if refreshing}
        <span class="refreshing">Oppdaterer…</span>
      {/if}
    </div>

    <nav class="zone-tabs" aria-label="Visning">
      {#each VIEW_MODES as mode}
        <button
          type="button"
          class="zone-tab"
          class:is-active={mode.value === viewMode}
          onclick={() => setViewMode(mode.value)}
        >
          {mode.label}
        </button>
      {/each}
    </nav>

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
      <label class="select">
        <span class="label">Transport</span>
        <select bind:value={transportMode} onchange={(event) => setTransportMode(event.target.value)}>
          {#each TRANSPORT_MODES as mode}
            <option value={mode.value}>{mode.label}</option>
          {/each}
        </select>
        {#if transportMode === "rail"}
          <span class="hint">Tog kan gi 0 treff i Rogaland.</span>
        {/if}
      </label>
      {#if normalizedQuery}
        <div class="result-count">Viser {filteredDelays.length} av {delays.length}</div>
      {/if}
    </div>

    <div class="actions">
      {#if !includeAllStops}
        <button type="button" class="action" onclick={loadAllStops}>
          Last alle stopp i {activeZone}
        </button>
      {/if}
      <button type="button" class="action" onclick={showPrevious} disabled={page <= 1}>
        Forrige
      </button>
      <button type="button" class="action" onclick={showMore}>
        Neste
      </button>
      <div class="page-status">Side {page} av {pageCount}</div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th class="col-delay">Forsinkelse</th>
            <th class="col-journey">Tur</th>
            <th class="col-status">Status</th>
            <th class="col-line">Linje</th>
            <th class="col-dest">Destinasjon</th>
            <th class="col-stop">Stopp</th>
            <th class="col-time">Planlagt</th>
            <th class="col-time">Forventet</th>
          </tr>
        </thead>
        <tbody>
          {#each pagedDelays as row (getRowKey(row))}
            <tr>
              <td class="col-delay {getDelayClass(row.delayMin)}">
                {row.delayMin} min
              </td>
              <td class="col-journey" title={row.serviceJourneyId ?? ""}>
                {formatJourneyId(row.serviceJourneyId)}
              </td>
              <td class="col-status">
                {#if row.cancellation}
                  <span class="status-badge status-canceled">Kansellert</span>
                {:else}
                  <span class="status-badge">{formatStatus(row)}</span>
                {/if}
                {#if row.predictionInaccurate}
                  <span class="status-warning" title="Usikker sanntid">⚠︎</span>
                {/if}
              </td>
              <td class="col-line">
                <span class="line-badge" title={row.transportSubmode ?? ""}>
                  {row.linePublicCode ?? row.lineName ?? "–"}
                </span>
              </td>
              <td class="col-dest">{formatDestination(row)}</td>
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
              <td colspan="8" class="no-data">Ingen treff</td>
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

  .actions {
    padding: 12px 20px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    border-bottom: 1px solid $panel-soft;
  }

  .action {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(15, 23, 42, 0.55);
    color: #e2e8f0;
    border-radius: 10px;
    padding: 10px 12px;
    font-weight: 600;
    cursor: pointer;

    &:hover {
      border-color: rgba(96, 165, 250, 0.55);
      background: rgba(96, 165, 250, 0.12);
    }

    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.18);
      border-color: rgba(96, 165, 250, 0.55);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .page-status {
    align-self: center;
    color: #94a3b8;
    font-size: 0.9rem;
    font-weight: 600;
    margin-left: auto;
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

  .select {
    display: grid;
    gap: 6px;
  }

  .hint {
    font-size: 0.75rem;
    color: #94a3b8;
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

  select {
    min-width: 160px;
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

  .col-journey {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-variant-numeric: tabular-nums;
    color: #94a3b8;
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

  .col-status {
    font-weight: 600;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .status-canceled {
    background: rgba(239, 68, 68, 0.2);
    color: #fecaca;
  }

  .status-warning {
    margin-left: 6px;
    color: #f59e0b;
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
