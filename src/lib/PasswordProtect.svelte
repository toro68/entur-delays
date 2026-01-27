<script>
  import { onMount } from 'svelte';

  let password = '';
  let isAuthenticated = false;
  let error = '';
  
  // Endre dette passordet til ønsket passord
  const CORRECT_PASSWORD = 'enturtij2026';
  const AUTH_KEY = 'entur_authenticated';

  onMount(() => {
    // Sjekk om brukeren allerede er autentisert i denne sesjonen
    const authenticated = sessionStorage.getItem(AUTH_KEY);
    if (authenticated === 'true') {
      isAuthenticated = true;
    }
  });

  function handleSubmit() {
    if (password === CORRECT_PASSWORD) {
      isAuthenticated = true;
      error = '';
      sessionStorage.setItem(AUTH_KEY, 'true');
    } else {
      error = 'Feil passord. Prøv igjen.';
      password = '';
    }
  }

  function handleKeyPress(event) {
    if (event.key === 'Enter') {
      handleSubmit();
    }
  }
</script>

{#if isAuthenticated}
  <slot />
{:else}
  <div class="password-container">
    <div class="password-box">
      <h1>Passordbeskytet side</h1>
      <p>Vennligst skriv inn passord for å få tilgang</p>
      
      <div class="input-group">
        <input
          type="password"
          bind:value={password}
          on:keypress={handleKeyPress}
          placeholder="Passord"
          autofocus
        />
        <button on:click={handleSubmit}>Logg inn</button>
      </div>
      
      {#if error}
        <p class="error">{error}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .password-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
     background: radial-gradient(circle at 10% 20%, rgba(96, 165, 250, 0.16), transparent 30%),
      radial-gradient(circle at 80% 0%, rgba(52, 211, 153, 0.12), transparent 24%),
      linear-gradient(145deg, #0b1221 0%, #0f172a 50%, #0b1221 100%);
    padding: 20px;
  }

  .password-box {
    background: white;
    padding: 40px;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    max-width: 600px;
    width: 100%;
  }

  h1 {
    margin: 0 0 10px 0;
    font-size: 24px;
    color: #333;
  }

  p {
    margin: 0 0 20px 0;
    color: #666;
    font-size: 14px;
  }

  .input-group {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
  }

  input {
    flex: 1;
    padding: 12px;
    border: 2px solid #ddd;
    border-radius: 6px;
    font-size: 16px;
    transition: border-color 0.3s;
  }

  input:focus {
    outline: none;
    border-color: #667eea;
  }

  button {
    padding: 12px 24px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    cursor: pointer;
    transition: background 0.3s;
    font-weight: 600;
  }

  button:hover {
    background: #5568d3;
  }

  .error {
    color: #e74c3c;
    margin: 10px 0 0 0;
    font-size: 14px;
  }
</style>
