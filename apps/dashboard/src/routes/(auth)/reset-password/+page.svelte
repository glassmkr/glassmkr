<script lang="ts">
  import { goto } from "$app/navigation";
  import { api } from "$lib/utils/api";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let password = $state("");
  let confirm = $state("");
  let loading = $state(false);
  let error = $state("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = "";
    if (password.length < 8) {
      error = "Password must be at least 8 characters";
      return;
    }
    if (password !== confirm) {
      error = "Passwords do not match";
      return;
    }
    loading = true;
    try {
      await api("/api/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: data.token, password }),
      });
      goto("/login?reset=1");
    } catch (err: any) {
      error = err.message || "Reset failed. Request a new link.";
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Choose a new password | Dashboard</title>
  <!-- These pages had a title and nothing else: no description, no canonical,
       and their only heading was an h2 with no h1 above it. They are the app
       origin's only crawlable pages. -->
  <meta name="description" content="Set a new password for your Glassmkr dashboard account." />
  <link rel="canonical" href="https://app.glassmkr.com/reset-password" />
</svelte:head>

<h1 class="heading">Choose a new password</h1>

{#if !data.token}
  <div class="error-msg">
    This reset link is missing or malformed. Request a new one from the
    <a href="/forgot-password">forgot password</a> page.
  </div>
{:else}
  {#if error}
    <div class="error-msg">{error}</div>
  {/if}
  <form onsubmit={handleSubmit}>
    <div class="field">
      <label for="password">New password</label>
      <input
        id="password"
        type="password"
        bind:value={password}
        required
        minlength="8"
        placeholder="At least 8 characters"
      />
    </div>
    <div class="field">
      <label for="confirm">Confirm password</label>
      <input id="confirm" type="password" bind:value={confirm} required placeholder="Re-enter password" />
    </div>
    <button type="submit" class="btn btn-primary submit-btn" disabled={loading}>
      {loading ? "Updating..." : "Update password"}
    </button>
  </form>
{/if}

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
    line-height: 1.5;
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
    width: 100%;
    justify-content: center;
    margin-top: 4px;
    padding: 10px 16px;
  }
</style>
