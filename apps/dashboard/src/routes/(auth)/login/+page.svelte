<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/stores";
  import { api } from "$lib/utils/api";
  import OAuthButtons from "$lib/components/OAuthButtons.svelte";
  import { safeLocalRedirect } from "$lib/auth/local-redirect";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let email = $state("");
  let password = $state("");
  let loading = $state(false);
  let error = $state("");
  let redirectTo = $derived(safeLocalRedirect($page.url.searchParams.get("redirect")));
  let oauthHrefSuffix = $derived(
    redirectTo !== "/" ? `?redirect=${encodeURIComponent(redirectTo)}` : "",
  );

  async function handleSubmit(e: Event) {
    e.preventDefault();
    loading = true;
    error = "";
    try {
      await api("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await invalidateAll();
      goto(redirectTo);
    } catch (err: any) {
      error = err.message || "Login failed";
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Log in | Dashboard</title>
  <!-- These pages had a title and nothing else: no description, no canonical,
       and their only heading was an h2 with no h1 above it. They are the app
       origin's only crawlable pages. -->
  <meta name="description" content="Sign in to your Glassmkr dashboard to see fleet health, active alerts and trend warnings." />
  <link rel="canonical" href="https://app.glassmkr.com/login" />
</svelte:head>

<h1 class="heading">Log in to Dashboard</h1>

{#if $page.url.searchParams.get("reset")}
  <div class="success-msg">Password updated. Log in with your new password.</div>
{/if}

<OAuthButtons lastMethod={data.lastMethod} hrefSuffix={oauthHrefSuffix} />

{#if error}
  <div class="error-msg">{error}</div>
{/if}

<form onsubmit={handleSubmit}>
  <div class="field">
    <label for="email">Email</label>
    <input id="email" type="email" bind:value={email} required placeholder="you@example.com" />
  </div>
  <div class="field">
    <label for="password">Password</label>
    <input id="password" type="password" bind:value={password} required placeholder="Your password" />
  </div>
  <div class="forgot-row">
    <a href="/forgot-password">Forgot password?</a>
  </div>
  <button type="submit" class="btn btn-primary submit-btn" class:is-last={data.lastMethod === "password"} disabled={loading}>
    {#if data.lastMethod === "password"}<span class="last-used">Last used</span>{/if}
    {loading ? "Logging in..." : "Log in"}
  </button>
</form>

<p class="switch-link">
  No account? <a href="/register">Sign up</a>
</p>

<style>
  .heading {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 24px;
    text-align: center;
  }
  .error-msg {
    background: var(--red-bg);
    color: var(--red);
    padding: 10px 14px;
    border-radius: 4px;
    font-size: 13px;
    margin-bottom: 16px;
  }
  .success-msg {
    background: var(--accent-glow);
    color: var(--accent);
    padding: 10px 14px;
    border-radius: 4px;
    font-size: 13px;
    margin-bottom: 16px;
  }
  .forgot-row {
    text-align: right;
    margin: -4px 0 12px;
  }
  .forgot-row a {
    font-size: 12.5px;
    color: var(--text-secondary);
    text-decoration: none;
  }
  .forgot-row a:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .field {
    margin-bottom: 14px;
  }
  .field label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }
  .submit-btn {
    position: relative;
    width: 100%;
    justify-content: center;
    margin-top: 4px;
    padding: 10px 16px;
  }
  .last-used {
    position: absolute;
    top: -9px;
    right: 12px;
    background: var(--accent);
    color: var(--bg-base);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1.5;
    padding: 1px 8px;
    border-radius: 999px;
  }
  .switch-link {
    margin-top: 20px;
    text-align: center;
    font-size: 13px;
    color: var(--text-secondary);
  }
</style>
