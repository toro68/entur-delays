<script>
  import { onMount, onDestroy } from "svelte";

  const REFRESH_MS = 30000;

  let delays = $state([]);
  let meta = $state({ generatedAt: null, transportMode: "", topN: 0 });
  let loading = $state(true);
  let error = $state(null);
  let intervalId = null;

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
    try {
      const res = await fetch("/api/top-delays");
      const json = await res.json();

      if (!res.ok) {
        error = json.error ?? "Ukjent feil";
        return;
      }

      error = null;
      delays = json.data ?? [];
      meta = {
        generatedAt: json.generatedAt,
        transportMode: json.transportMode,
        topN: json.topN,
      };
    } catch (e) {
      error = e.message ?? "Nettverksfeil";
    } finally {
      loading = false;
    }
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
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th class="col-delay">Forsinkelse</th>
            <th class="col-line">Linje</th>
            <th class="col-dest">Destinasjon</th>
            <th class="col-stop">Stopp</th>
            <th class="col-operator hide-mobile">Operatør</th>
            <th class="col-time">Planlagt</th>
            <th class="col-time">Forventet</th>
          </tr>
        </thead>
        <tbody>
          {#each delays as row (row.serviceJourneyId + row.aimedDepartureTime)}
            <tr>
              <td class="col-delay {getDelayClass(row.delayMin)}">
                {row.delayMin} min
              </td>
              <td class="col-line">
                <span class="line-badge">{row.linePublicCode ?? row.lineName ?? "–"}</span>
              </td>
              <td class="col-dest">{row.destination ?? "–"}</td>
              <td class="col-stop">{row.stopPlaceName ?? row.quayName ?? "–"}</td>
              <td class="col-operator hide-mobile">{row.authority ?? "–"}</td>
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
              <td colspan="7" class="no-data">Ingen forsinkelser akkurat nå 🎉</td>
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
    .hide-mobile {
      display: none;
    }

    th,
    td {
      padding: 10px 12px;
      font-size: 0.9rem;
    }

    .col-dest,
    .col-stop {
      max-width: 120px;
    }
  }
</style>
