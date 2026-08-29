<script lang="ts">
  import rules from "$lib/data/rules.json";
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Notification channels", item: "https://glassmkr.com/docs/channels" },
    ],
  });
</script>

<svelte:head>
  <title>Notification channels: Glassmkr documentation</title>
  <meta name="description" content="Configure email, Telegram, Slack, Discord, PagerDuty, and webhook channels for Glassmkr alerts. All six are free, with per-channel priority filtering across P0-P4." />
  <link rel="canonical" href="https://glassmkr.com/docs/channels" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/channels" />
  <meta property="og:title" content="Notification channels" />
  <meta property="og:description" content="Email, Telegram, Slack, Discord, PagerDuty, webhooks. All free, with per-channel priority filtering." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260826" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr notification channels" />
  <meta name="twitter:description" content="Email, Telegram, Slack, Discord, PagerDuty, webhooks with per-priority filtering." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260826" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<div class="docs-layout">
  <aside class="sidebar">
    <nav class="sidebar-nav">
      <a href="/docs" class="sidebar-section">&larr; Back to docs</a>
      <a href="#email" class="sidebar-link">Email</a>
      <a href="#telegram" class="sidebar-link">Telegram</a>
      <a href="#slack" class="sidebar-link">Slack</a>
      <a href="#discord" class="sidebar-link">Discord</a>
      <a href="#pagerduty" class="sidebar-link">PagerDuty</a>
      <a href="#webhooks" class="sidebar-link">Webhooks</a>
      <a href="#priority" class="sidebar-link">Priority filtering</a>
      <a href="#format" class="sidebar-link">Notification format</a>
      <a href="#updates" class="sidebar-link">Version updates</a>
      <a href="#testing" class="sidebar-link">Testing channels</a>
    </nav>
  </aside>

  <article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / CHANNELS</p>
      <h1>Notification channels</h1>
      <p class="docs-subtitle">Glassmkr routes alerts to email, Telegram, Slack, Discord, PagerDuty, and generic webhook destinations. All six are free on every plan, with no cap on how many you configure; filter which priority levels (P0-P4) each one receives.</p>
    </header>

    <section id="email">
      <h2><a href="#email" class="anchor-link">#</a>Email</h2>
      <p>The simplest channel. Glassmkr sends styled HTML emails from <code>alerts@glassmkr.com</code> with priority badges, diagnostic commands, and a direct link to the alert in the dashboard. SPF, DKIM, and DMARC are configured on the sending domain.</p>
      <h3>Setup</h3>
      <ol class="step-list">
        <li>Go to <strong>Channels</strong> in the dashboard and click <strong>+ Add Channel</strong>.</li>
        <li>Select the <strong>Email</strong> tab.</li>
        <li>Enter a channel name and the recipient email address.</li>
        <li>Choose which priority levels this channel should receive (P0 through P4).</li>
        <li>Click <strong>Create Channel</strong>.</li>
        <li>Click <strong>Test</strong> to verify delivery. Check your spam folder if it does not arrive.</li>
      </ol>
    </section>

    <section id="telegram">
      <h2><a href="#telegram" class="anchor-link">#</a>Telegram</h2>
      <p>Telegram messages arrive instantly and support rich formatting with priority badges and code blocks.</p>
      <h3>Setup</h3>
      <ol class="step-list">
        <li>Open Telegram and start a conversation with <strong>@glassmkr_bot</strong>.</li>
        <li>Send <code>/start</code> to the bot. It replies with your chat ID.</li>
        <li>For group notifications, add <strong>@glassmkr_bot</strong> to your group, then send <code>/start</code> in the group. The bot replies with the group chat ID (a negative number like <code>-1001234567890</code>).</li>
        <li>In the dashboard, go to <strong>Channels</strong>, click <strong>+ Add Channel</strong>, select <strong>Telegram</strong>.</li>
        <li>Enter the chat ID from step 2 or 3.</li>
        <li>Choose priority levels and click <strong>Create Channel</strong>.</li>
        <li>Click <strong>Test</strong> to verify.</li>
      </ol>
    </section>

    <section id="slack">
      <h2><a href="#slack" class="anchor-link">#</a>Slack</h2>
      <p>Slack integration uses incoming webhooks. Each webhook targets a specific Slack channel.</p>
      <h3>Setup</h3>
      <ol class="step-list">
        <li>Go to <a href="https://api.slack.com/apps">api.slack.com/apps</a> and click <strong>Create New App</strong>.</li>
        <li>Select <strong>From scratch</strong>. Name the app (e.g., "Glassmkr Alerts") and select your workspace.</li>
        <li>In the app settings, go to <strong>Incoming Webhooks</strong> and toggle it on.</li>
        <li>Click <strong>Add New Webhook to Workspace</strong> and select the channel (e.g., #ops-alerts).</li>
        <li>Copy the webhook URL.</li>
        <li>In the dashboard, go to <strong>Channels</strong>, click <strong>+ Add Channel</strong>, select <strong>Slack</strong>.</li>
        <li>Paste the webhook URL, choose priority levels, and click <strong>Create Channel</strong>.</li>
        <li>Click <strong>Test</strong> to verify.</li>
      </ol>
    </section>

    <section id="discord">
      <h2><a href="#discord" class="anchor-link">#</a>Discord</h2>
      <p>Discord integration uses incoming webhooks, like Slack. Alerts post as rich embeds with severity colors to the channel the webhook targets.</p>
      <h3>Setup</h3>
      <ol class="step-list">
        <li>In Discord, open <strong>Server Settings &rarr; Integrations &rarr; Webhooks</strong> and click <strong>New Webhook</strong>.</li>
        <li>Pick the channel it should post to, then copy the webhook URL.</li>
        <li>In the dashboard, go to <strong>Channels</strong>, click <strong>+ Add Channel</strong>, select <strong>Discord</strong>.</li>
        <li>Paste the webhook URL, choose priority levels, and click <strong>Create Channel</strong>.</li>
        <li>Click <strong>Test</strong> to verify.</li>
      </ol>
    </section>

    <section id="pagerduty">
      <h2><a href="#pagerduty" class="anchor-link">#</a>PagerDuty</h2>
      <p>PagerDuty integration uses the Events API v2. Glassmkr triggers an incident when an alert fires and resolves it when the alert clears. Alert priority maps to PagerDuty severity.</p>
      <h3>Setup</h3>
      <ol class="step-list">
        <li>In PagerDuty, open the service you want to alert on and go to <strong>Integrations &rarr; Add an integration</strong>.</li>
        <li>Select <strong>Events API v2</strong> and copy the <strong>Integration Key</strong> (the routing key).</li>
        <li>In the dashboard, go to <strong>Channels</strong>, click <strong>+ Add Channel</strong>, select <strong>PagerDuty</strong>.</li>
        <li>Paste the routing key, choose priority levels, and click <strong>Create Channel</strong>.</li>
        <li>Click <strong>Test</strong> to verify a test incident is created and auto-resolved.</li>
      </ol>
    </section>

    <section id="webhooks">
      <h2><a href="#webhooks" class="anchor-link">#</a>Webhooks</h2>
      <p>For routing alerts into your own incident tooling (custom Slack apps, internal ticket systems, anything not covered by the first-class channels above), use a generic webhook. Glassmkr POSTs a JSON payload to the URL you configure.</p>
      <h3>Setup</h3>
      <ol class="step-list">
        <li>In the dashboard, <strong>Channels</strong> &rarr; <strong>+ Add Channel</strong> &rarr; <strong>Webhook</strong>.</li>
        <li>Enter the endpoint URL and an optional shared-secret header (sent as <code>X-Glassmkr-Signature</code>; HMAC-SHA256 of the body).</li>
        <li>Choose priority levels and click <strong>Create Channel</strong>.</li>
        <li>Click <strong>Test</strong>. Inspect your endpoint's request log to confirm the payload arrived.</li>
      </ol>
      <p>4xx and 5xx responses are retried with exponential backoff for up to one hour, then dropped. Delivery history is visible on the channel card.</p>
    </section>

    <section id="priority">
      <h2><a href="#priority" class="anchor-link">#</a>Priority filtering</h2>
      <p>Each channel has five priority toggles: P0 Critical, P1 Urgent, P2 High, P3 Medium, P4 Low. When an alert fires, Glassmkr sends notifications only to channels that have that priority level enabled.</p>
      <p>P0 is the tier above urgent, currently carried by three rules covering uncorrected memory and GPU errors. A channel that has P1 enabled also receives P0, so an existing channel keeps paging without being edited. P4 is the informational tier: an alert whose instance severity is informational lands there so it appears on the dashboard without paging.</p>
      <p>For example, configure a Telegram channel for P0 and P1 only (the alerts that need immediate attention), and an email channel for all five levels (audit trail).</p>
      <p>Change priority settings at any time by clicking <strong>Edit</strong> on any channel card.</p>
    </section>

    <section id="format">
      <h2><a href="#format" class="anchor-link">#</a>Notification format</h2>
      <p>All channels receive structured notifications that include:</p>
      <ul>
        <li><strong>Priority badge</strong>: P0 Critical (red), P1 Urgent (red), P2 High (orange), P3 Medium (amber), P4 Low (blue).</li>
        <li><strong>Server name and alert rule</strong>: identifies which server and which of the {rules.length} rules fired.</li>
        <li><strong>Summary</strong>: current value, threshold, and what it means, in human-readable units.</li>
        <li><strong>Recommendation</strong>: context-aware advisory text explaining the likely cause.</li>
        <li><strong>Fix commands</strong>: copy-pasteable shell commands with real interface and device names. Every rule ships with deep FIX content (safe-mode, validation, rollback notes).</li>
        <li><strong>View in Dashboard</strong>: direct link to the server detail page.</li>
      </ul>
      <p>When an alert resolves, a resolution notification is sent to the same channels that received the original alert.</p>
    </section>

    <section id="updates">
      <h2><a href="#updates" class="anchor-link">#</a>Version update notifications</h2>
      <p>When a new Crucible version is available, Glassmkr sends a one-off notification listing all servers running an outdated version. This is sent once per customer per release, not per server.</p>
    </section>

    <section id="testing">
      <h2><a href="#testing" class="anchor-link">#</a>Testing channels</h2>
      <p>Click <strong>Test</strong> on any channel card, or use the API:</p>
      <pre><code>curl -X POST https://app.glassmkr.com/api/v1/channels/CHANNEL_ID/test \
  -H "Authorization: Bearer $ACCT_KEY"</code></pre>
      <p>The account key is created in <strong>Settings &rarr; API keys</strong> (on every plan; this <code>test</code> call needs a write-scoped key). See the <a href="/docs/programmatic-api">Programmatic API</a> page for scopes and rotation.</p>
      <p class="note">Last verified: 2026-05-22 against Crucible v0.13.3.</p>
    </section>
  </article>
</div>

<style>
  .docs-layout { display: flex; max-width: 960px; margin: 0 auto; padding: 60px 24px 120px; gap: 48px; }
  .sidebar { position: sticky; top: 80px; align-self: flex-start; flex-shrink: 0; width: 180px; max-height: calc(100vh - 100px); overflow-y: auto; }
  .sidebar-nav { display: flex; flex-direction: column; gap: 2px; }
  .sidebar-section { display: block; padding: 6px 12px; font-size: 12px; color: var(--text-tertiary); text-decoration: none; margin-bottom: 8px; }
  .sidebar-link { display: block; padding: 6px 12px; font-size: 13px; color: var(--text-tertiary); text-decoration: none; border-left: 2px solid transparent; border-radius: 0 4px 4px 0; transition: color 0.15s, border-color 0.15s; }
  .sidebar-link:hover { color: var(--text-secondary); }
  .docs-content { flex: 1; min-width: 0; }
  .eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.12em; color: var(--text-tertiary); margin-bottom: 8px; }
  h1 { font-size: 2.25rem; color: var(--text-primary); margin-bottom: 0.25rem; }
  .docs-subtitle { color: var(--text-secondary); font-size: 1.05rem; margin-bottom: 2rem; line-height: 1.6; }
  section { margin-bottom: 3.5rem; scroll-margin-top: 80px; }
  h2 { font-size: 1.5rem; color: var(--text-primary); margin-bottom: 1rem; position: relative; }
  h3 { font-size: 1.1rem; color: var(--text-primary); margin-top: 1.5rem; margin-bottom: 0.5rem; }
  p, li { color: var(--text-secondary); line-height: 1.7; margin-bottom: 0.75rem; }
  .anchor-link { color: transparent; text-decoration: none; margin-right: 4px; font-weight: 400; transition: color 0.15s; }
  h2:hover .anchor-link { color: var(--text-tertiary); }
  .anchor-link:hover { color: var(--accent) !important; text-decoration: none; }
  pre { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid rgba(245, 166, 35, 0.35); border-radius: var(--radius-md); padding: 14px 16px; overflow-x: auto; margin: 0.75rem 0 1.25rem; }
  pre code { font-family: var(--font-mono); font-size: 0.84rem; line-height: 1.65; color: var(--text-primary); background: transparent; padding: 0; }
  code { font-family: var(--font-mono); background: var(--surface); padding: 2px 6px; border-radius: var(--radius-md); font-size: 0.88em; }
  .note { font-size: 0.85rem; color: var(--text-tertiary); font-style: italic; margin-top: 1rem; }
  .step-list { counter-reset: steps; list-style: none; padding-left: 0; }
  .step-list li { counter-increment: steps; margin: 0.9rem 0; padding-left: 2.25rem; position: relative; }
  .step-list li::before { content: counter(steps); position: absolute; left: 0; top: 0; background: var(--surface); border: 1px solid var(--surface-border); width: 1.6rem; height: 1.6rem; border-radius: 50%; text-align: center; line-height: 1.5rem; font-size: 0.85rem; color: var(--accent); font-family: var(--font-mono); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: none; }
  @media (max-width: 900px) { .sidebar { display: none; } .docs-layout { gap: 0; padding: 40px 20px 100px; } }

  /* Mobile technical-text floor (taste pass 4.1): 12px minimum on a
     phone; wide tables scroll rather than shrink. */
  @media (max-width: 768px) {
    code, pre code { font-size: 12px; }
  }
</style>
