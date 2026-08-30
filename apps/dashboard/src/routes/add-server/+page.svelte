<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { api } from "$lib/utils/api";
  import { getToasts } from "$lib/stores/toast.svelte";
  import { CopyButton } from "@glassmkr/ui";

  const toast = getToasts();

  // Registration mutates customer state, so it 403s for the shared read-only
  // demo tenant. The form was still rendered with an enabled Register button,
  // which meant the only way to find out was to fill it in and submit.
  let isDemo = $derived($page.data.customer?.isDemo === true);

  let serverName = $state("");
  let saving = $state(false);
  let result = $state<{ apiKey: string; serverId: string } | null>(null);
  let hostProfiles = $state<Array<{ id: string; label: string }>>([]);
  let selectedProfile = $state("");

  // Host-profile catalog (static product metadata): fetch once so the
  // operator can pick a profile at registration. General (no profile) is
  // the default; a fetch failure is non-fatal and just hides the selector.
  $effect(() => {
    api<any>("/api/v1/host-profiles")
      .then((r) => { hostProfiles = r.profiles ?? []; })
      .catch(() => { /* non-fatal: selector stays hidden */ });
  });

  let installCmdRoot = $derived(
    result
      ? `curl -sf https://glassmkr.com/install.sh | GLASSMKR_API_KEY=${result.apiKey} bash`
      : ""
  );
  let installCmdSudo = $derived(
    result
      ? `curl -sf https://glassmkr.com/install.sh | sudo GLASSMKR_API_KEY=${result.apiKey} bash`
      : ""
  );

  async function handleSubmit(e: Event) {
    e.preventDefault();
    saving = true;
    try {
      // Name is optional. Send it only if the operator typed something;
      // an empty string would fail validation server-side, and we want
      // the placeholder branch instead.
      const body: { name?: string; profile?: string } = {};
      const trimmed = serverName.trim();
      if (trimmed.length > 0) body.name = trimmed;
      // Omit profile for General (the default, empty value) so the server
      // stores NULL; only send a concrete host-type id.
      if (selectedProfile) body.profile = selectedProfile;
      const data: any = await api("/api/v1/servers", {
        method: "POST",
        body: JSON.stringify(body),
      });
      result = {
        apiKey: data.server?.api_key ?? data.api_key ?? data.apiKey,
        serverId: data.server?.id ?? data.id,
      };
      toast.show("Server registered", "success");
    } catch (err: any) {
      toast.show(err.message || "Failed to register server", "error");
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Add Server | Dashboard</title>
</svelte:head>

<div class="container-narrow">
  <h1 class="page-title">Register a Server</h1>

  {#if isDemo}
    <div class="card demo-card">
      <p>
        In your own account this is where you register a machine: you give it an
        optional label, pick a host profile, and get back a per-server key plus
        the one command that installs the agent. Registration is disabled in the
        read-only demo.
      </p>
      <p class="demo-card-sub">
        The same thing is available over the API, and the whole flow is
        documented at
        <a href="https://glassmkr.com/docs/automated-onboarding" target="_blank" rel="noopener">automated onboarding ↗</a>.
      </p>
      <a href="/" class="btn">Back to the fleet</a>
    </div>
  {:else if !result}
    <div class="card form-card">
      <form onsubmit={handleSubmit}>
        <div class="field">
          <label for="srv-name">Label <span class="optional">(optional)</span></label>
          <input
            id="srv-name"
            bind:value={serverName}
            placeholder="e.g. web-prod-01"
          />
          <p class="hint">
            The dashboard identifies servers by their hostname + IP, which Crucible reports on its first snapshot. A label is only shown as a placeholder until then; leave blank to use a generic placeholder.
          </p>
        </div>
        {#if hostProfiles.length > 0}
          <div class="field">
            <label for="srv-profile">Host profile <span class="optional">(optional)</span></label>
            <select id="srv-profile" bind:value={selectedProfile}>
              <option value="">General</option>
              {#each hostProfiles as p}
                <option value={p.id}>{p.label}</option>
              {/each}
            </select>
            <p class="hint">
              General is the default and suppresses nothing. A host-type profile silences alerts that are expected by design for that kind of host (a marketplace GPU box, for example); real problems still fire. You can change this later from the server page.
            </p>
          </div>
        {/if}
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" disabled={saving}>
            {saving ? "Registering..." : "Register"}
          </button>
          <a href="/" class="btn">Cancel</a>
        </div>
      </form>
    </div>
  {:else}
    <div class="card success-card">
      <h2>Server registered successfully</h2>
      <p class="desc">Save your API key now. It will not be shown again.</p>

      <div class="key-section">
        <span class="label">API Key</span>
        <div class="key-row">
          <code class="key-value">{result.apiKey}</code>
          <CopyButton text={result.apiKey} />
        </div>
      </div>

      <div class="key-section mt-3">
        <span class="label">Quick Install</span>
        <p class="hint mb-1">Run one of these commands on your server:</p>
        <p class="hint mb-1" style="font-weight:500;color:var(--text-secondary)">As root:</p>
        <div class="key-row">
          <code class="key-value">{installCmdRoot}</code>
          <CopyButton text={installCmdRoot} />
        </div>
        <p class="hint mt-2 mb-1" style="font-weight:500;color:var(--text-secondary)">As a non-root user with sudo:</p>
        <div class="key-row">
          <code class="key-value">{installCmdSudo}</code>
          <CopyButton text={installCmdSudo} />
        </div>
      </div>

      <div class="manual-section mt-3">
        <span class="label">Manual Setup</span>
        <p class="hint">
          If you prefer manual installation, download the Crucible binary from the
          <a href="/docs/getting-started">getting started guide</a> and set the
          <code>GLASSMKR_API_KEY</code> environment variable.
        </p>
      </div>

      <div class="mt-3">
        <a href="/" class="btn btn-primary">Go to Dashboard</a>
      </div>
    </div>
  {/if}
</div>

<style>
  .demo-card { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
  .demo-card p { margin: 0; max-width: 62ch; line-height: 1.6; }
  .demo-card-sub { font-size: 14px; color: var(--text-secondary); }
  .page-title {
    font-size: 28px;
    font-weight: 600;
    margin-bottom: 24px;
  }
  .form-card {
    padding: 28px;
    max-width: 480px;
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
  .field .optional {
    font-weight: 400;
    color: var(--text-tertiary);
  }
  .field .hint {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 6px;
    line-height: 1.5;
  }
  .form-actions {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }

  .success-card {
    padding: 28px;
  }
  .success-card h2 {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .desc {
    font-size: 14px;
    color: var(--text-secondary);
    margin-bottom: 20px;
  }

  .key-section {
    margin-bottom: 4px;
  }
  .key-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    padding: 10px 14px;
    margin-top: 6px;
  }
  .key-value {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    background: none;
    padding: 0;
    overflow-wrap: break-word;
    word-break: keep-all;
    white-space: pre-wrap;
  }

  .hint {
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.5;
  }

  .manual-section {
    font-size: 13px;
  }
</style>
