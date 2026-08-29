<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // Button label reflects the highest granted scope so it never understates the
  // authority being approved (Codex 2026-07-21 #5).
  const approveLabel = $derived(
    data.scopes.includes("glassmkr:admin")
      ? "Authorize administrative access"
      : data.scopes.includes("glassmkr:write")
        ? "Authorize read + write access"
        : "Authorize read access",
  );

  // The form gives no feedback while the server mints the grant and redirects to
  // the client's loopback, so a click felt like nothing happened and people
  // clicked again; the second submit hits the now-consumed one-time request and
  // 400s. Flip aria-busy on submit: the shared .btn styling then shows a spinner
  // and sets pointer-events:none, so the action is visibly underway and cannot be
  // double-fired. We keep the native form POST (the browser follows the 303 to
  // the loopback), and aria-busy (not disabled) so the submitter's value is still
  // sent; if JS never runs, the form still works, just without the spinner.
  let submitting = $state<false | "approve" | "deny">(false);

  function onSubmit(event: SubmitEvent) {
    const decision = (event.submitter as HTMLButtonElement | null)?.value;
    submitting = decision === "deny" ? "deny" : "approve";
  }
</script>

<svelte:head>
  <title>Authorize MCP client | Glassmkr</title>
</svelte:head>

<main class="consent card">
  <p class="eyebrow">Glassmkr MCP</p>
  <h1>Authorize {data.clientName}</h1>
  {#if !data.isVerified}
    <p class="warning" role="alert">
      Unverified client. "{data.clientName}" is a name this client chose for itself;
      Glassmkr has not confirmed it. Only continue if you just started this connection
      and recognize {data.redirectHost}.
    </p>
  {/if}
  <p class="identity">
    {data.isVerified ? "Verified client" : "Unverified client"}
    connecting as <strong>{data.accountEmail}</strong>
  </p>

  <section>
    <h2>This client is requesting permission to:</h2>
    <ul>
      {#each data.scopes as scope}
        {#if scope === "glassmkr:read"}
          <li>View your servers, telemetry, alerts, and configuration metadata.</li>
        {:else if scope === "glassmkr:write"}
          <li>Acknowledge and resolve your alerts on your behalf (reversible changes; no deleting servers or keys).</li>
        {:else if scope === "glassmkr:admin"}
          <li><strong>Administrative changes:</strong> enroll servers, rotate collector keys, and move servers to trash. Each destructive action requires a separate confirmation step.</li>
        {/if}
      {/each}
    </ul>
  </section>

  <p class="redirect-host">After approval, you will return to {data.redirectHost}.</p>

  <form method="POST" onsubmit={onSubmit}>
    <input type="hidden" name="request_id" value={data.requestId} />
    <input type="hidden" name="csrf" value={data.csrf} />
    <div class="actions">
      <button
        class="btn"
        type="submit"
        name="decision"
        value="deny"
        aria-busy={submitting === "deny"}
        disabled={submitting === "approve"}
      >
        {submitting === "deny" ? "Denying..." : "Deny"}
      </button>
      <button
        class="btn btn-primary"
        type="submit"
        name="decision"
        value="approve"
        aria-busy={submitting === "approve"}
        disabled={submitting === "deny"}
      >
        {submitting === "approve" ? "Authorizing, returning to your client..." : approveLabel}
      </button>
    </div>
  </form>
</main>

<style>
  .consent {
    width: min(620px, calc(100% - 32px));
    margin: 64px auto;
    padding: 28px;
  }
  .eyebrow {
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h1 {
    margin: 6px 0 10px;
    font-size: 22px;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  h2 {
    font-size: 14px;
    font-weight: 600;
    margin-top: 24px;
  }
  ul {
    margin: 10px 0 0;
    padding-left: 20px;
  }
  li {
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 8px 0;
  }
  .identity,
  .redirect-host {
    color: var(--text-secondary);
    font-size: 13px;
  }
  .warning {
    margin: 12px 0 0;
    padding: 12px 14px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text-primary);
    font-size: 13px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 28px;
  }
</style>
