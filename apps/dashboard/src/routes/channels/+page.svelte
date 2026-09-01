<script lang="ts">
  import { page } from "$app/stores";
  import { PRIORITIES, DEFAULT_PRIORITIES, priorityRecord, type Priority } from "$lib/alerts/priority";
  // The dispatcher expands a stored list before filtering, so the UI must
  // show the expanded view or it displays something the routing does not do.
  import { expandChannelPriorities as effectiveChannelPriorities } from "$lib/alerts/presentation";
  import { api } from "$lib/utils/api";
  import { getToasts } from "$lib/stores/toast.svelte";
  import { ConfirmModal } from "@glassmkr/ui";

  const toast = getToasts();
  // Read-only demo tenant: mutations are blocked server-side, so don't
  // surface the Add Channel button (it would only 403).
  let isDemo = $derived($page.data.customer?.isDemo === true);

  let channels = $state<any[]>([]);
  let loading = $state(true);
  let showForm = $state(false);
  let activeTab = $state<"telegram" | "email" | "slack" | "discord" | "webhook" | "pagerduty">("telegram");

  // Form fields
  let channelName = $state("");
  let telegramChatId = $state("");
  let emailAddress = $state("");
  let slackWebhook = $state("");
  let discordWebhook = $state("");
  let genericWebhook = $state("");
  let pagerdutyKey = $state("");
  let saving = $state(false);
  // Which channel's "Test" send is in flight (one button per channel, so track
  // by id, not a bare boolean). Drives the spinner + lock on that Test button.
  let testingId = $state<number | null>(null);
  let newPriorities = $state<Record<Priority, boolean>>(priorityRecord(DEFAULT_PRIORITIES));
  let newNotifyMinorUpdate = $state(false);
  let newConflictError = $state("");

  const PRIO_META = PRIORITIES;


  // Edit state
  let editingId = $state<number | null>(null);
  let editName = $state("");
  let editValue = $state("");
  let editPriorities = $state<Record<Priority, boolean>>(priorityRecord(DEFAULT_PRIORITIES));
  let editNotifyMinorUpdate = $state(false);

  function startEdit(ch: any) {
    editingId = ch.id;
    editName = ch.name;
    // The secret is no longer returned by the API (P-3). Start blank: a blank
    // value on save keeps the existing secret, a new value replaces it.
    editValue = "";
    const prios = ch.priorities || DEFAULT_PRIORITIES;
    // Show the toggles the way the alert actually routes. A row stored before
    // P0 existed lists P1 without P0, and the dispatcher treats that as "also
    // P0" via expandChannelPriorities, so opening the editor and saving must
    // not silently narrow the channel.
    editPriorities = priorityRecord(effectiveChannelPriorities(prios));
    editNotifyMinorUpdate = ch.notify_minor_update ?? false;
  }

  function cancelEdit() {
    editingId = null;
  }

  async function saveEdit(ch: any) {
    try {
      const prios = Object.entries(editPriorities).filter(([, v]) => v).map(([k]) => k);
      if (prios.length === 0) { toast.show("Select at least one priority level", "error"); return; }

      // Only send config (the secret) when the user entered a NEW value. A blank
      // field keeps the existing secret unchanged (keep-on-omit), so editing the
      // name or priorities never wipes it (P-3).
      const body: Record<string, unknown> = {
        name: editName,
        priorities: prios,
        notify_minor_update: editNotifyMinorUpdate,
      };
      const v = editValue.trim();
      if (v) {
        if (ch.channel_type === "telegram") body.config = { chat_id: v };
        else if (ch.channel_type === "email") body.config = { email: v };
        else if (ch.channel_type === "pagerduty") body.config = { routing_key: v };
        else body.config = { webhook_url: v };
      }

      await api(`/api/v1/channels/${ch.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      toast.show("Channel updated", "success");
      editingId = null;
      loadChannels();
    } catch (err: any) {
      toast.show(err.message || "Failed to update", "error");
    }
  }

  // Delete confirmation
  let deleteOpen = $state(false);
  let deleteTarget = $state<any>(null);

  // Consistent monochrome line icons (thin-stroke, currentColor), one per
  // channel type, so they sit inside the design system instead of the old
  // grab-bag of emoji dingbats and bare letters. Returns inline SVG markup;
  // rendered with {@html} at a fixed, non-user-controlled call site (the
  // switch only ever emits our own static strings, so no injection surface).
  function channelIcon(type: string): string {
    const paths: Record<string, string> = {
      // paper plane (send)
      telegram: '<path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9 22 2Z"/>',
      // envelope
      email: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
      // channel hash
      slack: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
      // chat bubble
      discord: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/>',
      // link (webhook URL)
      webhook: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/>',
      // bell (paging)
      pagerduty: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    };
    const inner = paths[type] || '<circle cx="12" cy="12" r="4"/>';
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  async function loadChannels() {
    loading = true;
    try {
      const data: any = await api("/api/v1/channels");
      channels = data.channels ?? data ?? [];
    } catch {
      channels = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadChannels();
  });

  function resetForm() {
    channelName = "";
    telegramChatId = "";
    emailAddress = "";
    slackWebhook = "";
    discordWebhook = "";
    genericWebhook = "";
    pagerdutyKey = "";
    newPriorities = priorityRecord(DEFAULT_PRIORITIES);
    newNotifyMinorUpdate = false;
    showForm = false;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    saving = true;
    newConflictError = "";
    try {
      let config: Record<string, string> = {};
      if (activeTab === "telegram") {
        config = { chat_id: telegramChatId };
      } else if (activeTab === "email") {
        config = { email: emailAddress };
      } else if (activeTab === "slack") {
        config = { webhook_url: slackWebhook };
      } else if (activeTab === "discord") {
        config = { webhook_url: discordWebhook };
      } else if (activeTab === "webhook") {
        config = { webhook_url: genericWebhook };
      } else {
        config = { routing_key: pagerdutyKey };
      }

      const prios = Object.entries(newPriorities).filter(([, v]) => v).map(([k]) => k);
      if (prios.length === 0) { toast.show("Select at least one priority level", "error"); saving = false; return; }

      await api("/api/v1/channels", {
        method: "POST",
        body: JSON.stringify({
          name: channelName,
          channel_type: activeTab,
          config,
          priorities: prios,
          notify_minor_update: newNotifyMinorUpdate,
        }),
      });
      toast.show("Channel created", "success");
      resetForm();
      loadChannels();
    } catch (err: any) {
      // 409 conflict is the free-tier abuse block; surface inline near the input.
      if (err.status === 409) {
        newConflictError = err.message || "This identifier is already in use by another free account.";
      } else {
        toast.show(err.message || "Failed to create channel", "error");
      }
    } finally {
      saving = false;
    }
  }

  async function testChannel(id: number) {
    if (testingId !== null) return;
    testingId = id;
    try {
      await api(`/api/v1/channels/${id}/test`, { method: "POST" });
      toast.show("Test notification sent", "success");
    } catch (err: any) {
      toast.show(err.message || "Test failed", "error");
    } finally {
      testingId = null;
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/api/v1/channels/${deleteTarget.id}`, { method: "DELETE" });
      toast.show("Channel deleted", "success");
      loadChannels();
    } catch (err: any) {
      toast.show(err.message || "Failed to delete", "error");
    }
    deleteOpen = false;
    deleteTarget = null;
  }
</script>

<svelte:head>
  <title>Alert Channels | Dashboard</title>
</svelte:head>

<div class="container">
  <div class="page-header">
    <h1>Alert Channels</h1>
    {#if !isDemo}
      <button class="btn btn-primary" onclick={() => (showForm = !showForm)}>
        {showForm ? "Cancel" : "+ Add Channel"}
      </button>
    {/if}
  </div>

  <!-- Add channel form -->
  {#if showForm}
    <div class="card add-form">
      <div class="tab-bar">
        <button
          class="tab {activeTab === 'telegram' ? 'active' : ''}"
          onclick={() => (activeTab = "telegram")}
        >
          Telegram
        </button>
        <button
          class="tab {activeTab === 'email' ? 'active' : ''}"
          onclick={() => (activeTab = "email")}
        >
          Email
        </button>
        <button
          class="tab {activeTab === 'slack' ? 'active' : ''}"
          onclick={() => (activeTab = "slack")}
        >
          Slack
        </button>
        <button
          class="tab {activeTab === 'discord' ? 'active' : ''}"
          onclick={() => (activeTab = "discord")}
        >
          Discord
        </button>
        <button
          class="tab {activeTab === 'webhook' ? 'active' : ''}"
          onclick={() => (activeTab = "webhook")}
        >
          Webhook
        </button>
        <button
          class="tab {activeTab === 'pagerduty' ? 'active' : ''}"
          onclick={() => (activeTab = "pagerduty")}
        >
          PagerDuty
        </button>
      </div>

      <form onsubmit={handleSubmit}>
        <div class="field">
          <label for="ch-name">Channel Name</label>
          <input id="ch-name" bind:value={channelName} required placeholder="e.g. Ops Team" />
        </div>

        {#if activeTab === "telegram"}
          <div class="field">
            <label for="chat-id">Telegram Chat ID</label>
            <input id="chat-id" bind:value={telegramChatId} required placeholder="-1001234567890" class:input-error={newConflictError} />
            {#if newConflictError}
              <p class="inline-error">{newConflictError}</p>
            {/if}
          </div>
          <p class="hint">
            Add <strong>@glassmkr_bot</strong> to your group or start a DM with it,
            then use <code>/start</code> to get your chat ID.
          </p>
        {:else if activeTab === "email"}
          <div class="field">
            <label for="ch-email">Email Address</label>
            <input id="ch-email" type="email" bind:value={emailAddress} required placeholder="alerts@example.com" class:input-error={newConflictError} />
            {#if newConflictError}
              <p class="inline-error">{newConflictError}</p>
            {/if}
          </div>
        {:else if activeTab === "slack"}
          <div class="field">
            <label for="webhook">Slack Webhook URL</label>
            <input id="webhook" bind:value={slackWebhook} required placeholder="https://hooks.slack.com/services/..." />
          </div>
        {:else if activeTab === "discord"}
          <div class="field">
            <label for="discord-webhook">Discord Webhook URL</label>
            <input id="discord-webhook" bind:value={discordWebhook} required placeholder="https://discord.com/api/webhooks/..." />
          </div>
          <p class="hint">Server Settings &gt; Integrations &gt; Webhooks &gt; New Webhook, then copy the URL.</p>
        {:else if activeTab === "webhook"}
          <div class="field">
            <label for="generic-webhook">Webhook URL</label>
            <input id="generic-webhook" bind:value={genericWebhook} required placeholder="https://example.com/hooks/glassmkr" />
          </div>
          <p class="hint">We POST a JSON payload (server identity + new/resolved alerts) to this URL on each notification.</p>
        {:else}
          <div class="field">
            <label for="pagerduty-key">PagerDuty Routing Key</label>
            <input id="pagerduty-key" bind:value={pagerdutyKey} required placeholder="Events API v2 integration key" />
          </div>
          <p class="hint">In PagerDuty: your service &gt; Integrations &gt; add an Events API v2 integration, then copy the Integration/Routing Key.</p>
        {/if}

        <div class="field">
          <span class="field-label">Priorities</span>
          <div class="prio-checkboxes">
            {#each PRIO_META as p}
              <label class="prio-check" style="--prio-color:{p.color}">
                <input type="checkbox" bind:checked={newPriorities[p.key]} />
                <span class="prio-label">{p.label}</span>
              </label>
            {/each}
          </div>
          {#if activeTab === "telegram"}
            <p class="hint mt-1">Recommended: P1, P2 for urgent alerts</p>
          {:else if activeTab === "email"}
            <p class="hint mt-1">Recommended: all priorities for audit trail</p>
          {:else}
            <p class="hint mt-1">Recommended: P1, P2, P3 for team visibility</p>
          {/if}
        </div>

        <div class="field">
          <span class="field-label">Crucible updates</span>
          <div class="update-checkboxes">
            <label class="update-check locked">
              <input type="checkbox" checked disabled />
              <span>Major releases</span>
              <span class="update-hint">always on</span>
            </label>
            <label class="update-check">
              <input type="checkbox" bind:checked={newNotifyMinorUpdate} />
              <span>Patch releases</span>
            </label>
          </div>
        </div>

        <button type="submit" class="btn btn-primary mt-2" disabled={saving}>
          {saving ? "Creating..." : "Create Channel"}
        </button>
      </form>
    </div>
  {/if}

  <!-- Channel list -->
  {#if loading}
    <p class="muted">Loading channels...</p>
  {:else if channels.length === 0 && !showForm}
    <div class="card empty">
      {#if isDemo}
        <p>In your own account, this is where you would connect Telegram, email, or Slack so alerts reach you. Channel setup is disabled in the read-only demo.</p>
      {:else}
        <p>No alert channels configured yet. Add one to start receiving notifications.</p>
      {/if}
    </div>
  {:else}
    <div class="channel-grid">
      {#each channels as ch (ch.id)}
        <div class="card channel-card">
          {#if editingId === ch.id}
            <form class="edit-form" onsubmit={(e) => { e.preventDefault(); saveEdit(ch); }}>
              <div class="field">
                <label for="edit-name-{ch.id}">Name</label>
                <input id="edit-name-{ch.id}" bind:value={editName} required />
              </div>
              <div class="field">
                <label for="edit-val-{ch.id}">
                  {ch.channel_type === "telegram" ? "Chat ID" : ch.channel_type === "email" ? "Email Address" : ch.channel_type === "pagerduty" ? "Routing Key" : "Webhook URL"}
                </label>
                {#if ch.has_secret}
                  <span class="edit-keep-hint">Current: {ch.destination || "set"}. Leave blank to keep it.</span>
                {/if}
                <input
                  id="edit-val-{ch.id}"
                  type={ch.channel_type === "email" ? "email" : "text"}
                  bind:value={editValue}
                  placeholder={ch.has_secret ? "Leave blank to keep current" : ""}
                />
              </div>
              <div class="field">
                <span class="field-label">Priorities</span>
                <div class="prio-checkboxes">
                  {#each PRIO_META as p}
                    <label class="prio-check" style="--prio-color:{p.color}">
                      <input type="checkbox" bind:checked={editPriorities[p.key]} />
                      <span class="prio-label">{p.label}</span>
                    </label>
                  {/each}
                </div>
              </div>
              <div class="field">
                <span class="field-label">Crucible updates</span>
                <div class="update-checkboxes">
                  <label class="update-check locked">
                    <input type="checkbox" checked disabled />
                    <span>Major releases</span>
                    <span class="update-hint">always on</span>
                  </label>
                  <label class="update-check">
                    <input type="checkbox" bind:checked={editNotifyMinorUpdate} />
                    <span>Patch releases</span>
                  </label>
                </div>
              </div>
              <div class="ch-actions">
                <button type="submit" class="btn btn-primary btn-small">Save</button>
                <button type="button" class="btn btn-small" onclick={cancelEdit}>Cancel</button>
              </div>
            </form>
          {:else}
            <div class="ch-header">
              <span class="ch-icon">{@html channelIcon(ch.channel_type)}</span>
              <div class="ch-info">
                <span class="ch-name">{ch.name}</span>
                {#if ch.destination}
                  <span class="ch-detail">{ch.destination}</span>
                {/if}
              </div>
              <span class="tag tag-blue">{ch.channel_type}</span>
            </div>
            <div class="prio-badges">
              {#each PRIO_META as p}
                {#if effectiveChannelPriorities(ch.priorities || DEFAULT_PRIORITIES).includes(p.key)}
                  <span class="prio-badge" style="color:{p.color};border-color:{p.color}">{p.key}</span>
                {/if}
              {/each}
            </div>
            <div class="ch-actions">
              <button class="btn btn-small" onclick={() => testChannel(ch.id)} aria-busy={testingId === ch.id}>Test</button>
              <button class="btn btn-small" onclick={() => startEdit(ch)}>Edit</button>
              <button
                class="btn btn-small btn-danger"
                onclick={() => { deleteTarget = ch; deleteOpen = true; }}
              >
                Delete
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<ConfirmModal
  bind:open={deleteOpen}
  title="Delete Channel"
  message="Are you sure you want to delete the channel '{deleteTarget?.name}'? You will stop receiving notifications on it."
  confirmText="Delete"
  danger
  onconfirm={confirmDelete}
  oncancel={() => { deleteOpen = false; deleteTarget = null; }}
/>

<style>
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  .page-header h1 {
    font-size: 28px;
    font-weight: 500;
  }

  .add-form {
    margin-bottom: 24px;
    padding: 24px;
  }
  .tab-bar {
    display: flex;
    gap: 4px;
    margin-bottom: 20px;
  }
  .tab {
    padding: 6px 14px;
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s, border-color 0.15s;
  }
  .tab:hover {
    color: var(--text-primary);
    background: var(--surface);
  }
  .tab.active {
    background: var(--accent);
    color: #000;
    border-color: var(--accent);
    font-weight: 500;
  }

  .field {
    margin-bottom: 14px;
  }
  .field label, .field .field-label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }
  .hint {
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.5;
  }
  .inline-error {
    font-size: 12px;
    color: var(--red);
    line-height: 1.5;
    margin-top: 6px;
    padding: 8px 10px;
    background: rgba(229, 86, 75, 0.08);
    border: 1px solid rgba(229, 86, 75, 0.25);
    border-radius: 4px;
  }
  .input-error {
    border-color: var(--red);
  }

  .channel-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
  }
  .channel-card {
    padding: 16px;
  }
  .ch-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .ch-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    color: var(--text-secondary);
  }
  .ch-icon :global(svg) {
    display: block;
  }
  .ch-info {
    flex: 1;
    min-width: 0;
  }
  .ch-name {
    font-size: 14px;
    font-weight: 600;
    display: block;
  }
  .edit-keep-hint {
    display: block;
    font-size: 12px;
    color: var(--text-tertiary);
    margin: -2px 0 6px;
  }
  .ch-detail {
    font-size: 12px;
    color: var(--text-tertiary);
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ch-actions {
    display: flex;
    gap: 8px;
  }
  .edit-form .field {
    margin-bottom: 10px;
  }

  .prio-checkboxes {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .prio-check {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--prio-color);
    cursor: pointer;
  }
  .prio-check input[type="checkbox"] {
    accent-color: var(--prio-color);
    width: 14px;
    height: 14px;
    cursor: pointer;
  }
  .prio-label {
    font-weight: 500;
  }
  .update-checkboxes {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  .update-check {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .update-check.locked {
    opacity: 0.7;
    cursor: default;
  }
  .update-check input[type="checkbox"] {
    accent-color: var(--accent);
    width: 14px;
    height: 14px;
  }
  .update-hint {
    font-size: 12px;
    color: var(--text-tertiary);
    font-style: italic;
  }
  .prio-badges {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
  }
  .prio-badge {
    font-size: 12px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 2px;
    border: 1px solid;
  }

  .empty {
    text-align: center;
    padding: 32px;
    color: var(--text-secondary);
    font-size: 14px;
  }
  .muted {
    color: var(--text-tertiary);
    font-size: 14px;
  }
</style>
