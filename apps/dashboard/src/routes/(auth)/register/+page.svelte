<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/stores";
  import { api } from "$lib/utils/api";
  import OAuthButtons from "$lib/components/OAuthButtons.svelte";

  let email = $state("");
  let password = $state("");
  let loading = $state(false);
  let error = $state("");
  // ?plan=pro used to route a brand-new account straight into Stripe checkout.
  // Hosted has no paid tier (P0-03; ground-truth hosted_pricing_state), and the
  // Terms say no new subscriptions can be created, so the parameter is ignored
  // rather than honoured: an old marketing link still registers the account, it
  // just cannot buy anything.

  async function handleSubmit(e: Event) {
    e.preventDefault();
    loading = true;
    error = "";
    try {
      await api("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await invalidateAll();
      goto("/");
    } catch (err: any) {
      error = err.message || "Registration failed";
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Sign up | Dashboard</title>
  <!-- These pages had a title and nothing else: no description, no canonical,
       and their only heading was an h2 with no h1 above it. They are the app
       origin's only crawlable pages. -->
  <meta name="description" content="Create a free Glassmkr account and start watching bare-metal hardware failures. Self-hosting needs no account at all." />
  <link rel="canonical" href="https://app.glassmkr.com/register" />
</svelte:head>

<h1 class="heading">Create your account</h1>

<OAuthButtons />

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
    <input id="password" type="password" bind:value={password} required minlength="8" placeholder="Min. 8 characters" />
  </div>
  <button type="submit" class="btn btn-primary submit-btn" disabled={loading}>
    {loading ? "Creating account..." : "Sign up"}
  </button>
</form>

<p class="register-legal">
  By creating an account, you agree to our
  <a href="https://glassmkr.com/terms" target="_blank" rel="noopener">Terms of Service</a>
  and acknowledge our
  <a href="https://glassmkr.com/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
</p>

<p class="switch-link">
  Have an account? <a href="/login">Log in</a>
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
  .register-legal {
    font-size: 12px;
    color: var(--text-tertiary);
    text-align: center;
    margin-top: 12px;
    line-height: 1.5;
  }
  .register-legal a {
    color: var(--text-secondary);
    text-decoration: underline;
  }
  .switch-link {
    margin-top: 20px;
    text-align: center;
    font-size: 13px;
    color: var(--text-secondary);
  }
  /* 24px minimum tap target on the standalone auth links (prelaunch audit).
     inline-block + line-height grows the hit area without breaking the
     sentence flow; WCAG 2.5.5 exempts inline links but the audit asked for it. */
  .switch-link a {
    display: inline-block;
    min-height: 24px;
    line-height: 24px;
    padding: 0 2px;
  }
</style>
