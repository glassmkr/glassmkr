<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { api, ApiError } from "$lib/utils/api";
  import { timeAgo } from "$lib/utils/time";
  import { ConfirmModal, CopyButton } from "@glassmkr/ui";
  import DatePicker from "$lib/components/DatePicker.svelte";
  import { getToasts } from "$lib/stores/toast.svelte";

  const toast = getToasts();
  let customer = $derived($page.data.customer);
  // Used to: hide the scope selector at create-time, force `newScope = "read"`,
  // and hide the rotate action (rotation is admin-scope only, unconditionally Pro-gated).
  // The 2026-06-21 re-gating made the programmatic API free: any plan may mint
  // write and admin keys, and no key route gates on plan. The UI kept saying
  // otherwise for two months, telling free users to upgrade for scopes they
  // already had. These stay as named constants rather than inlined `true` so the
  // markup reads the same and a future gate has one place to land.
  let canChooseScope = true;
  let canRotate = true;

  interface KeyRow {
    id: string;
    name: string;
    prefix: string;
    last_4: string;
    scope: "read" | "write" | "admin";
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
    grace_period_ends_at: string | null;
    replaced_by_key_id: string | null;
    replaces_key_id: string | null;
  }

  let keys = $state<KeyRow[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function loadKeys() {
    loading = true;
    loadError = null;
    try {
      const data: any = await api("/api/v1/account/keys?include_revoked=false");
      keys = (data.keys ?? []) as KeyRow[];
    } catch (err: any) {
      loadError = err?.message ?? "Failed to load keys.";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (customer) loadKeys();
  });

  // --- Status badge derivation ---------------------------------------
  function statusBadge(k: KeyRow): { label: string; cls: string; title: string } {
    const now = Date.now();
    if (k.revoked_at) return { label: "Revoked", cls: "badge-revoked", title: `Revoked ${timeAgo(k.revoked_at)}` };
    if (k.expires_at && new Date(k.expires_at).getTime() < now) {
      return { label: "Expired", cls: "badge-expired", title: `Expired ${timeAgo(k.expires_at)}` };
    }
    if (k.grace_period_ends_at) {
      const ms = new Date(k.grace_period_ends_at).getTime() - now;
      // Grace window already elapsed: the key is no longer valid (pending
      // reap), so show Expired rather than "Grace 0h".
      if (ms <= 0) {
        return { label: "Expired", cls: "badge-expired", title: `Grace ended ${timeAgo(k.grace_period_ends_at)}` };
      }
      // Still in grace: round up so a key with under an hour left never shows "0h".
      const hrs = Math.max(1, Math.ceil(ms / 3600000));
      return { label: `Grace ${hrs}h`, cls: "badge-grace", title: `Auto-revokes ${timeAgo(k.grace_period_ends_at)}` };
    }
    return { label: "Active", cls: "badge-active", title: "" };
  }

  function isActionable(k: KeyRow): boolean {
    if (k.revoked_at) return false;
    if (k.expires_at && new Date(k.expires_at).getTime() < Date.now()) return false;
    return true;
  }

  // --- Create modal --------------------------------------------------
  let createOpen = $state(false);
  let creating = $state(false);
  let newName = $state("");
  // Free accounts can only create read keys; default the radio to "write" for
  // Pro (most automation needs Write) and to "read" for Free (only option).
  // The selector itself is hidden for Free so the value stays "read".
  let newScope = $state<"read" | "write" | "admin">("read");
  let newExpiresAt = $state<string>("");
  let createdSecret = $state<string | null>(null);

  function openCreate() {
    // Default scope: "write" for Pro (matches the pre-unify-auth default;
    // most automation needs Write), "read" for Free (only option allowed).
    newScope = canChooseScope ? "write" : "read";
    newName = "";
    newExpiresAt = "";
    createOpen = true;
  }

  async function submitCreate() {
    if (!newName.trim()) {
      toast.show("Name is required", "error");
      return;
    }
    creating = true;
    try {
      const body: Record<string, unknown> = {
        name: newName.trim(),
        scope: newScope,
      };
      if (newExpiresAt) {
        // Convert local datetime-local input to ISO 8601 UTC.
        body.expires_at = new Date(newExpiresAt).toISOString();
      }
      const res: any = await api("/api/v1/account/keys", {
        method: "POST",
        body: JSON.stringify(body),
      });
      createdSecret = res.api_key ?? null;
      createOpen = false;
      newName = "";
      newScope = "write";
      newExpiresAt = "";
      await loadKeys();
    } catch (err: any) {
      if (isReauthError(err)) {
        // Pop the reauth modal and queue the original action to
        // re-run after verify-password succeeds.
        promptReauth(submitCreate);
        return;
      }
      toast.show(err?.message ?? "Failed to create key", "error");
    } finally {
      creating = false;
    }
  }

  // --- Rotate modal --------------------------------------------------
  let rotateTarget = $state<KeyRow | null>(null);
  let rotating = $state(false);
  let rotatedSecret = $state<string | null>(null);
  let rotatedGraceUntil = $state<string | null>(null);

  async function submitRotate() {
    if (!rotateTarget) return;
    rotating = true;
    try {
      const res: any = await api(`/api/v1/account/keys/${rotateTarget.id}/rotate`, { method: "POST" });
      rotatedSecret = res.api_key ?? null;
      rotatedGraceUntil = res.grace?.grace_period_ends_at ?? null;
      rotateTarget = null;
      await loadKeys();
    } catch (err: any) {
      if (isReauthError(err)) {
        promptReauth(submitRotate);
        return;
      }
      toast.show(err?.message ?? "Failed to rotate key", "error");
    } finally {
      rotating = false;
    }
  }

  // --- Revoke modal --------------------------------------------------
  let revokeTarget = $state<KeyRow | null>(null);
  let revokeImmediate = $state(false);
  let revoking = $state(false);

  async function submitRevoke() {
    if (!revokeTarget) return;
    revoking = true;
    try {
      const qs = revokeImmediate ? "?immediate=true" : "";
      await api(`/api/v1/account/keys/${revokeTarget.id}${qs}`, { method: "DELETE" });
      toast.show(revokeImmediate ? "Key revoked immediately." : "Key scheduled for revocation in 48h.", "success");
      revokeTarget = null;
      revokeImmediate = false;
      await loadKeys();
    } catch (err: any) {
      toast.show(err?.message ?? "Failed to revoke key", "error");
    } finally {
      revoking = false;
    }
  }

  function defaultExpiryMin(): string {
    // datetime-local minimum: tomorrow.
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 16);
  }

  // --- Re-auth gate ------------------------------------------------
  // The create + rotate endpoints require a password re-verification
  // within the last 5 minutes (spec part 4: step-up auth on
  // sensitive operations). When the API returns 403 with the
  // reauth-required message, we surface a password prompt instead
  // of a useless "Request failed" toast.
  let reauthOpen = $state(false);
  let reauthPassword = $state("");
  let reauthError = $state<string | null>(null);
  let reauthSubmitting = $state(false);
  let reauthRetry = $state<(() => Promise<void>) | null>(null);

  // Which re-auth methods this account has. Password-less social accounts
  // (GitHub/Google only) have no password to re-verify, so they step up via
  // their provider instead. Loaded lazily when the reauth modal is prompted.
  type AuthMethods = {
    has_password: boolean;
    providers: { provider: string }[];
    github_configured: boolean;
    google_configured: boolean;
  };
  let authMethods = $state<AuthMethods | null>(null);

  async function loadAuthMethods() {
    try {
      const r = await fetch("/auth/providers");
      if (r.ok) authMethods = (await r.json()) as AuthMethods;
    } catch {
      authMethods = null; // fall back to the password form
    }
  }

  function hasProvider(p: string): boolean {
    return !!authMethods?.providers?.some((x) => x.provider === p);
  }

  // A full-page bounce through the provider; on return the gate is satisfied
  // for 5 min and the user re-clicks Create/Rotate. `redirect` brings them back
  // here (the callback appends ?reauth=ok|mismatch, handled in onMount).
  function reauthWithProvider(p: "github" | "google") {
    const back = window.location.pathname;
    window.location.href = `/auth/${p}?reauth=1&redirect=${encodeURIComponent(back)}`;
  }

  onMount(() => {
    const r = $page.url.searchParams.get("reauth");
    if (r === "ok") {
      toast.show("Re-authenticated. You can create or rotate a key for the next 5 minutes.", "success");
    } else if (r === "mismatch") {
      toast.show("That provider account is not linked to your login, so re-authentication failed.", "error");
    }
    if (r) {
      // Strip the marker so a refresh does not re-toast.
      const url = new URL(window.location.href);
      url.searchParams.delete("reauth");
      history.replaceState(history.state, "", url.pathname + url.search);
    }
  });

  function isReauthError(err: unknown): boolean {
    if (!(err instanceof ApiError)) return false;
    if (err.status !== 403) return false;
    // SvelteKit error helper returns { message } only; check the
    // message string for the documented reauth-required text.
    return /re-?authenticat/i.test(err.message);
  }

  function promptReauth(retry: () => Promise<void>) {
    reauthRetry = retry;
    reauthPassword = "";
    reauthError = null;
    reauthOpen = true;
    // Learn whether this account re-verifies by password or by provider.
    if (!authMethods) void loadAuthMethods();
  }

  async function submitReauth() {
    if (!reauthPassword) {
      reauthError = "Password required.";
      return;
    }
    reauthSubmitting = true;
    reauthError = null;
    try {
      await api("/api/v1/account/verify-password", {
        method: "POST",
        body: JSON.stringify({ password: reauthPassword }),
      });
      reauthOpen = false;
      reauthPassword = "";
      // Replay the original action.
      const retry = reauthRetry;
      reauthRetry = null;
      if (retry) await retry();
    } catch (err: any) {
      reauthError = err?.message ?? "Verification failed";
    } finally {
      reauthSubmitting = false;
    }
  }
</script>

<svelte:head>
  <title>API keys | Dashboard Settings</title>
</svelte:head>

<div class="container">
  <a href="/settings" class="back-link">&larr; Back to settings</a>
  <h1 class="page-title">API keys</h1>
  <p class="page-desc">
    Programmatic access keys for the Dashboard API.
    Three scopes (read / write / admin), optional expiry, 48-hour graceful rotation.
    See <a href="https://glassmkr.com/docs/programmatic-api" target="_blank" rel="noopener">the API docs ↗</a> for usage.
  </p>


  <section class="section card">
    <div class="section-header">
      <h2>Your keys</h2>
      <!-- The demo is a shared read-only tenant, so key creation 403s at the
           API. An enabled button that always fails is a worse answer than no
           button: say what would happen in your own account instead. Same
           pattern as the channels page. -->
      {#if !customer?.isDemo}
        <button class="btn btn-primary btn-small" onclick={openCreate}>
          + Create new key
        </button>
      {:else}
        <span class="demo-note">Key creation is disabled in the read-only demo.</span>
      {/if}
    </div>

    {#if loading}
      <p class="muted">Loading keys...</p>
    {:else if loadError}
      <p class="error">Error: {loadError}</p>
    {:else if keys.length === 0}
      <p class="muted">No keys yet. Create one to start automating against the Dashboard API.</p>
    {:else}
      <div class="keys-table">
        <div class="keys-row keys-head">
          <div>Name</div>
          <div>Scope</div>
          <div>Prefix</div>
          <div>Status</div>
          <div>Created</div>
          <div>Last used</div>
          <div>Expires</div>
          <div></div>
        </div>
        {#each keys as k (k.id)}
          {@const badge = statusBadge(k)}
          <div class="keys-row" title={badge.title}>
            <div class="cell-name">{k.name}</div>
            <div><span class="scope scope-{k.scope}">{k.scope}</span></div>
            <div class="mono">{k.prefix}...{k.last_4}</div>
            <div><span class="badge {badge.cls}">{badge.label}</span></div>
            <div>{timeAgo(k.created_at)}</div>
            <div>{k.last_used_at ? timeAgo(k.last_used_at) : "—"}</div>
            <div>{k.expires_at ? new Date(k.expires_at).toISOString().slice(0, 10) : "Never"}</div>
            <div class="cell-actions">
              {#if isActionable(k) && !k.grace_period_ends_at}
                {#if canRotate}
                  <button class="btn btn-small" onclick={() => (rotateTarget = k)}>Rotate</button>
                {/if}
                <button class="btn btn-danger btn-small" onclick={() => { revokeTarget = k; revokeImmediate = false; }}>
                  Revoke
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Shown to every account since the P0-03 resolution: the audit log is
       free, so the pointer to it stops hiding. -->
    <section class="section card">
      <h2>Activity</h2>
      <p class="desc">
        Audit log of API requests on this account, filterable by date and action.
      </p>
      <a href="/settings/audit" class="btn btn-small">Open audit log &rarr;</a>
    </section>
  

</div>

<!-- Create modal -->
{#if createOpen}
  <div class="overlay" role="presentation" onclick={() => (createOpen = false)}>
    <div class="modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2>Create new API key</h2>
      <div class="form-row">
        <label>Name</label>
        <input type="text" bind:value={newName} maxlength="64" placeholder="production-deployer" />
      </div>
        <div class="form-row">
          <label>Scope</label>
          <div class="scope-options">
            <label class="scope-option">
              <input type="radio" name="scope" value="read" bind:group={newScope} />
              <div>
                <strong>Read</strong>
                <div class="desc">View servers, alerts, billing status, account info. Cannot modify anything.</div>
              </div>
            </label>
            <label class="scope-option">
              <input type="radio" name="scope" value="write" bind:group={newScope} />
              <div>
                <strong>Write</strong>
                <div class="desc">All Read permissions, plus create/modify/delete servers, rotate collector keys, restore servers. Most automation needs this.</div>
              </div>
            </label>
            <label class="scope-option">
              <input type="radio" name="scope" value="admin" bind:group={newScope} />
              <div>
                <strong>Admin</strong>
                <div class="desc">All Write permissions, plus manage these account keys and access the audit log. Use only for trusted admin tooling.</div>
              </div>
            </label>
          </div>
        </div>
      <div class="form-row">
        <label>Expires (optional)</label>
        <DatePicker bind:value={newExpiresAt} enableTime={true} minDate={defaultExpiryMin()} placeholder="Select date and time" />
        <div class="desc">Leave blank for an indefinite key. Maximum 5 years.</div>
      </div>
      <div class="actions">
        <button class="btn" onclick={() => (createOpen = false)} disabled={creating}>Cancel</button>
        <button class="btn btn-primary" onclick={submitCreate} disabled={creating}>
          {creating ? "Creating..." : "Create key"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- One-time created-secret display -->
{#if createdSecret}
  <div class="overlay" role="presentation">
    <div class="modal" role="dialog" tabindex="-1">
      <h2>Your new API key</h2>
      <div class="token-display">
        <code class="token-value">{createdSecret}</code>
        <CopyButton text={createdSecret} />
      </div>
      <p class="warning">
        This is the only time you'll see this key in full. Save it somewhere
        secure (password manager, secrets vault) before continuing.
      </p>
      <div class="actions">
        <button class="btn btn-primary" onclick={() => (createdSecret = null)}>
          I've saved it, close
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Rotate confirm + result -->
<ConfirmModal
  open={rotateTarget !== null}
  title={`Rotate key${rotateTarget ? ': ' + rotateTarget.name : ''}`}
  message={
    rotateTarget
      ? `A new key with the same scope (${rotateTarget.scope}) and expiry will be generated. ` +
        `The old key keeps working for 48 hours, then auto-revokes. ` +
        `Use this for normal key rotation; for compromised keys, use Revoke immediately.`
      : ""
  }
  confirmText="Rotate gracefully (48h grace)"
  onconfirm={submitRotate}
  oncancel={() => (rotateTarget = null)}
/>

<!-- Post-rotate secret display -->
{#if rotatedSecret}
  <div class="overlay" role="presentation">
    <div class="modal" role="dialog" tabindex="-1">
      <h2>Rotated. Your new API key:</h2>
      <div class="token-display">
        <code class="token-value">{rotatedSecret}</code>
        <CopyButton text={rotatedSecret} />
      </div>
      {#if rotatedGraceUntil}
        <p class="warning">
          The old key keeps working until {new Date(rotatedGraceUntil).toUTCString()}.
          Update your automation to use the new key before then.
        </p>
      {/if}
      <p class="warning">This is the only time you'll see the new key in full.</p>
      <div class="actions">
        <button class="btn btn-primary" onclick={() => { rotatedSecret = null; rotatedGraceUntil = null; }}>
          I've saved it, close
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Re-auth modal: surfaced when create/rotate hits the 5-minute
     step-up gate. Prompts for the account password, posts to
     /api/v1/account/verify-password, then replays the queued action. -->
{#if reauthOpen}
  <div class="overlay" role="presentation" onclick={() => (reauthOpen = false)}>
    <div class="modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2>Confirm it's you</h2>
      <p class="desc">
        Creating or rotating an API key is a sensitive operation, so we
        re-verify you every 5 minutes.
      </p>

      <!-- Password re-verify: shown for accounts that have a password. Defaults
           to shown while authMethods is still loading so password users are
           never blocked. -->
      {#if authMethods?.has_password ?? true}
        <form onsubmit={(e) => { e.preventDefault(); submitReauth(); }}>
          <div class="form-row">
            <label for="reauth-password">Password</label>
            <input
              id="reauth-password"
              type="password"
              bind:value={reauthPassword}
              autocomplete="current-password"
              disabled={reauthSubmitting}
            />
          </div>
          {#if reauthError}
            <p class="error">{reauthError}</p>
          {/if}
          <div class="actions">
            <button type="button" class="btn btn-small" onclick={() => (reauthOpen = false)} disabled={reauthSubmitting}>
              Cancel
            </button>
            <button type="submit" class="btn btn-small btn-primary" disabled={reauthSubmitting || !reauthPassword}>
              {reauthSubmitting ? "Verifying..." : "Verify and continue"}
            </button>
          </div>
        </form>
      {/if}

      <!-- Provider step-up: the ONLY path for password-less social accounts,
           and an option for accounts that also linked a provider. -->
      {#if authMethods && !authMethods.has_password}
        <p class="desc">You sign in with a social provider, so re-verify with it:</p>
      {/if}
      {#if authMethods && ((authMethods.github_configured && hasProvider("github")) || (authMethods.google_configured && hasProvider("google")))}
        <div class="oauth-reauth" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
          {#if authMethods.github_configured && hasProvider("github")}
            <button type="button" class="btn btn-small" onclick={() => reauthWithProvider("github")}>
              Re-verify with GitHub
            </button>
          {/if}
          {#if authMethods.google_configured && hasProvider("google")}
            <button type="button" class="btn btn-small" onclick={() => reauthWithProvider("google")}>
              Re-verify with Google
            </button>
          {/if}
        </div>
      {/if}
      {#if authMethods && !authMethods.has_password}
        <div class="actions">
          <button type="button" class="btn btn-small" onclick={() => (reauthOpen = false)}>Cancel</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Revoke modal: graceful vs immediate, inline-radio so the choice is
     visible at confirm time rather than a floating checkbox. -->
{#if revokeTarget !== null}
  <div class="overlay" role="presentation" onclick={() => { revokeTarget = null; revokeImmediate = false; }}>
    <div class="modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2>Revoke key: {revokeTarget.name}</h2>
      <p class="desc">
        Choose how soon the key stops working. For a compromised or leaked
        key, use immediate. For a planned wind-down, use graceful so any
        automation using it has time to switch over.
      </p>
      <div class="scope-options">
        <label class="scope-option">
          <input type="radio" name="revoke-mode" value="graceful"
                 checked={!revokeImmediate}
                 onchange={() => (revokeImmediate = false)} />
          <div>
            <strong>Schedule revocation (48 hours)</strong>
            <div class="desc">The key keeps working for 48 hours, then auto-revokes. Standard wind-down.</div>
          </div>
        </label>
        <label class="scope-option">
          <input type="radio" name="revoke-mode" value="immediate"
                 checked={revokeImmediate}
                 onchange={() => (revokeImmediate = true)} />
          <div>
            <strong>Revoke immediately</strong>
            <div class="desc">The key stops working instantly. Any automation using it will 401. Use only if the key is compromised or leaked.</div>
          </div>
        </label>
      </div>
      <div class="actions">
        <button class="btn btn-small" onclick={() => { revokeTarget = null; revokeImmediate = false; }} disabled={revoking}>
          Cancel
        </button>
        <button class="btn btn-small {revokeImmediate ? 'btn-danger' : 'btn-primary'}" onclick={submitRevoke} disabled={revoking}>
          {#if revoking}Revoking...{:else if revokeImmediate}Revoke immediately{:else}Schedule revocation (48h){/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .container { max-width: 1100px; margin: 0 auto; padding: 24px; }
  .back-link { font-size: 12px; color: var(--text-tertiary); text-decoration: none; display: inline-block; margin-bottom: 12px; }
  .page-title { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
  .page-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 24px; }
  /* Match /settings/+page.svelte:574 — stacked sections are 20px apart, 24px internal padding. */
  .section { margin-bottom: 20px; padding: 24px; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  /* The global `input, select, textarea { width: 100%; padding: 10px 14px }` in
     packages/ui/src/lib/base.css catches checkbox + radio inputs too, which makes
     the visual indicator end up centered inside an oversized invisible bounding
     box. Restore browser defaults for those two types so they sit inline with
     their labels. */
  :global(input[type="radio"]),
  :global(input[type="checkbox"]) {
    width: auto;
    padding: 0;
  }
  .keys-table { display: flex; flex-direction: column; gap: 0; font-size: 13px; }
  /* minmax(0,fr) + a fixed actions column so the header row and body rows
     resolve identical track widths. With a bare `auto` last column the header
     (empty last cell) and body (Rotate/Revoke buttons) divided the leftover
     space differently, drifting every header label right of its value until
     the Expires "Never" sat under the "Last used" label. */
  .keys-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.7fr) minmax(0, 1.5fr) minmax(0, 0.9fr) minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 0.8fr) 150px; gap: 12px; padding: 10px 8px; border-bottom: 1px solid var(--surface-border); align-items: center; }
  .keys-row > div { min-width: 0; }
  .keys-row:last-child { border-bottom: none; }
  .keys-head { font-weight: 600; color: var(--text-tertiary); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .cell-name { font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .demo-note { font-size: 13px; color: var(--text-tertiary); }
  .mono { font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell-actions { display: flex; gap: 6px; justify-content: flex-end; }
  .scope { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .scope-read { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
  .scope-write { background: rgba(250, 204, 21, 0.15); color: #facc15; }
  .scope-admin { background: rgba(248, 113, 113, 0.15); color: #f87171; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .badge-active { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
  .badge-grace { background: rgba(250, 204, 21, 0.15); color: #facc15; }
  .badge-expired, .badge-revoked { background: rgba(255, 255, 255, 0.06); color: var(--text-tertiary); }
  .badge-revoked { color: #f87171; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 9999; }
  .modal { background: var(--bg); border: 1px solid var(--surface-border); border-radius: 4px; padding: 24px; max-width: 520px; width: 100%; }
  .modal h2 { margin-top: 0; }
  .form-row { margin-bottom: 16px; }
  .form-row label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
  .form-row input[type="text"] { width: 100%; padding: 8px 10px; background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px; color: var(--text-primary); font-size: 14px; }
  .scope-options { display: flex; flex-direction: column; gap: 10px; }
  /* `label.scope-option` (tag + class = (0,1,1)) beats the form-row
     label rule (`.form-row label` = (0,1,1)) on equal specificity by
     coming later in source order. Without the `label` tag selector
     the rule loses to `.form-row label { display: block }` which
     stacks the radio above its content. */
  label.scope-option { display: flex; gap: 10px; padding: 10px; border: 1px solid var(--surface-border); border-radius: 4px; cursor: pointer; align-items: flex-start; margin-bottom: 0; }
  label.scope-option:has(input:checked) { border-color: var(--accent); background: rgba(255, 107, 53, 0.06); }
  label.scope-option > input[type="radio"] { margin-top: 4px; flex-shrink: 0; }
  label.scope-option .desc { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
  .desc { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
  .token-display { display: flex; gap: 8px; align-items: center; background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px; padding: 10px 12px; margin: 12px 0; }
  .token-value { font-family: var(--font-mono); font-size: 13px; color: var(--accent); flex: 1; word-break: break-all; }
  .warning { font-size: 12px; color: var(--text-secondary); background: rgba(250, 204, 21, 0.06); border-left: 3px solid #facc15; padding: 8px 12px; border-radius: 4px; margin: 8px 0; }
  .muted { color: var(--text-tertiary); }
  .error { color: #f87171; }
  /* Free-tier soft upsell. Lighter visual than a full Pro-required block;
     sits above the always-rendered keys section so Free users see the
     create-key flow first and the upgrade prompt as secondary context. */
  .upsell-card { background: rgba(255, 107, 53, 0.04); border-color: rgba(255, 107, 53, 0.25); }
  .upsell-row { display: flex; justify-content: space-between; gap: 24px; align-items: center; }
  /* Scope display in the Free-tier create modal: a static "read" badge plus
     the upsell note, replacing the 3-radio selector. */
  .scope-readonly { display: flex; gap: 12px; align-items: center; padding: 10px; border: 1px solid var(--surface-border); border-radius: 4px; background: var(--surface); }
  .scope-readonly-note { font-size: 12px; color: var(--text-tertiary); }
</style>
