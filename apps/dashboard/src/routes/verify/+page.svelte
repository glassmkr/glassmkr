<script lang="ts">
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
  const COPY: Record<string, { title: string; msg: string }> = {
    verified: { title: "Email confirmed", msg: "Thanks - your email address is verified. You can head back to your dashboard." },
    expired:  { title: "Link expired", msg: "That verification link has expired. Sign in and use the 'Resend' button on the dashboard to get a fresh one." },
    invalid:  { title: "Link not valid", msg: "That link is not valid (it may have already been used). If your email is not verified yet, sign in and resend it." },
    missing:  { title: "No token", msg: "This page needs a verification token. Open the link from your confirmation email." },
    error:    { title: "Something went wrong", msg: "We could not verify the link just now. Please try again in a moment." },
  };
  const c = $derived(COPY[data.status] ?? COPY.error);
</script>

<svelte:head><title>Verify email - Glassmkr</title></svelte:head>

<main class="verify-wrap">
  <div class="verify-card">
    <h1>{c.title}</h1>
    <p>{c.msg}</p>
    <a class="btn btn-primary" href="/">Go to dashboard</a>
  </div>
</main>

<style>
  .verify-wrap { min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
  .verify-card { max-width: 30rem; text-align: center; }
  .verify-card h1 { margin: 0 0 0.75rem; font-size: 1.5rem; }
  .verify-card p { color: var(--text-muted, #A2A9B4); line-height: 1.6; margin: 0 0 1.5rem; }
  /* Button styling comes from the shared .btn/.btn-primary in @glassmkr/ui
     (imported globally by the dashboard root layout), so it matches every
     other primary action across the site and dashboard. */
</style>
