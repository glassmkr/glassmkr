<script lang="ts">
  import { api } from "$lib/utils/api";

  let email = $state("");
  let loading = $state(false);
  let sent = $state(false);
  let error = $state("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    loading = true;
    error = "";
    try {
      await api("/api/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      sent = true;
    } catch (err: any) {
      error = err.message || "Something went wrong. Please try again.";
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Reset password | Dashboard</title>
  <!-- These pages had a title and nothing else: no description, no canonical,
       and their only heading was an h2 with no h1 above it. They are the app
       origin's only crawlable pages. -->
  <meta name="description" content="Request a password reset link for your Glassmkr dashboard account." />
  <link rel="canonical" href="https://app.glassmkr.com/forgot-password" />
</svelte:head>

<h1 class="heading">Reset your password</h1>

{#if sent}
  <p class="confirm">
    If an account exists for <strong>{email}</strong>, we've sent a password reset link.
    Check your inbox (and spam). The link expires in 30 minutes.
  </p>
  <p class="switch-link"><a href="/login">Back to log in</a></p>
{:else}
  <p class="lede">Enter your account email and we'll send you a link to set a new password.</p>
  {#if error}
    <div class="error-msg">{error}</div>
  {/if}
  <form onsubmit={handleSubmit}>
    <div class="field">
      <label for="email">Email</label>
      <input id="email" type="email" bind:value={email} required placeholder="you@example.com" />
    </div>
    <button type="submit" class="btn btn-primary submit-btn" disabled={loading}>
      {loading ? "Sending..." : "Send reset link"}
    </button>
  </form>
  <p class="switch-link">Remembered it? <a href="/login">Log in</a></p>
{/if}

<style>
  .heading {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 16px;
    text-align: center;
  }
  .lede {
    font-size: 13px;
    color: var(--text-secondary);
    text-align: center;
    margin-bottom: 20px;
  }
  .confirm {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 20px;
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
