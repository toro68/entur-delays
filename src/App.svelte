<script>
  import DelayTable from "./lib/DelayTable.svelte";
  import PasswordProtect from "./lib/PasswordProtect.svelte";
</script>

<PasswordProtect>
  <section class="entur-delays-section">
  <div class="container">
    <header class="header">
      <h1>🚦 Kollektivforsinkelser</h1>
      <p class="subtitle">Sanntid fra Entur i Rogaland</p>
    </header>
    <DelayTable />
  </div>
</section>

<style lang="scss">
  .entur-delays-section {
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 32px 16px 72px;
    background: radial-gradient(circle at 10% 20%, rgba(96, 165, 250, 0.16), transparent 30%),
      radial-gradient(circle at 80% 0%, rgba(52, 211, 153, 0.12), transparent 24%),
      linear-gradient(145deg, #0b1221 0%, #0f172a 50%, #0b1221 100%);
  }

  .container {
    width: 100%;
    max-width: 1200px;
  }

  .header {
    text-align: center;
    margin-bottom: 32px;

    h1 {
      font-size: 2rem;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 8px;
    }

    .subtitle {
      color: #94a3b8;
      font-size: 1rem;
    }
  }

  @media (max-width: 640px) {
    .entur-delays-section {
      padding: 16px 12px 48px;
    }

    .header h1 {
      font-size: 1.5rem;
    }
  }
</style>
</PasswordProtect>
