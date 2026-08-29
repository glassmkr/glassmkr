# Billing enforcement — discovery (Phase 7 P1)

> Discovery doc per `CC_STRIPE_BILLING_ENFORCEMENT.md` Task 1.
> No code changes in this PR. Written to surface findings + a shape
> recommendation to Simon, who picks scope before any implementation.
>
> **Carve-out reminder**: this work modifies billing/Stripe code. Per
> master plan rule, every PR in the workstream stops for Simon's
> pre-merge review (no auto-merge for the implementation PRs). This
> discovery PR is the exception — it's pure docs.

## TL;DR

The codebase already has substantial scaffolding the spec assumes is
absent:

- **`servers.status = 'suspended'`** is an existing disable state, used
  on `customer.subscription.deleted` to suspend excess servers when a
  customer downgrades to Free. The dispatcher does NOT yet gate on
  it (alerts still flow on suspended servers), but the column and the
  precedent exist.
- **Stripe webhook handler** is mature: idempotency-claim pattern,
  signature verification, `stripe_subscriptions` audit table,
  per-event handlers for `checkout.session.completed`,
  `customer.subscription.created/updated/deleted`,
  `invoice.payment_failed/succeeded`. **Missing**:
  `payment_method.detached`, `payment_method.attached`.
- **Email engine** is Resend + a hand-written `billingEmailShell()`
  template builder. Adding 4-5 new templates is straightforward.
- **Scheduler pattern** is `node-cron` started from `hooks.server.ts`;
  `startWatchdog()` (every 2 min) and the trend-warnings job (every
  6h at 00/06/12/18 UTC) are the two existing examples. The
  periodic billing-period-rollover check follows the same pattern.
- **Dunning banner** already renders on `/settings`; reads
  `has_default_payment_method` from `/api/v1/billing/status`. The UI
  read-side for "card on file?" is already wired.

These reduce the implementation surface meaningfully. Net new code:
two webhook event handlers, one cron scheduler, one alert-dispatcher
gate, one restore endpoint, one migration, four email templates, and
the disabled-state UI on the dashboard + server detail page.

## Per-spec discovery items

### 1. Billing state tracking

Two tables (both already migrated in production):

- **`customers`** ([migrations/postgres/001_initial.sql](../migrations/postgres/001_initial.sql)) — flat per-customer state: `plan`, `stripe_customer_id`, `stripe_subscription_id`, `plan_server_limit` (default 3), `plan_retention_days`, `plan_managed_alerts`, `plan_updated_at`. Updated by `applyPlan()` on every webhook event. **No card-on-file column** — the truth is in Stripe; we re-fetch when needed.
- **`stripe_subscriptions`** ([migrations/postgres/004_stripe_state.sql](../migrations/postgres/004_stripe_state.sql)) — append-/upsert-only audit mirror of every Stripe subscription, keyed on Stripe sub id. Tracks `status`, `current_period_end`, `cancel_at_period_end`, `cancelled_at`, `updated_at`. **`current_period_end` is the trigger field** for the spec's billing-period-rollover periodic job.
- **`stripe_events_processed`** ([migrations/postgres/004_stripe_state.sql](../migrations/postgres/004_stripe_state.sql)) — webhook idempotency log; INSERT-with-ON-CONFLICT pattern.

Read pattern in `/api/v1/billing/status` ([routes/api/v1/billing/status/+server.ts](../src/routes/api/v1/billing/status/+server.ts)): joins customers + Stripe API call to retrieve `default_payment_method`. Returns `has_default_payment_method` boolean to clients. This is the single source of truth for "card on file?" (per-request, no caching).

### 2. Dunning banner

Lives in [`routes/settings/+page.svelte:255-280`](../src/routes/settings/+page.svelte). Three branches:

1. `subscription_status === "past_due" || === "unpaid"` → red warning, "Your servers will be suspended if this isn't resolved."
2. `isPro && !has_subscription && has_default_payment_method === false` → orange warning, "No card on file. … Add a card now via Manage Subscription."
3. (other states) — no banner.

The banner is hard-coded UI; no route layout-level dunning yet (i.e. dashboard server tiles and server-detail pages don't currently surface this). The spec's UI work adds banners to those surfaces.

### 3. Servers table schema

[`migrations/postgres/001_initial.sql`](../migrations/postgres/001_initial.sql):

```sql
CREATE TABLE servers (
  id varchar(32) PRIMARY KEY,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  hostname varchar(255),
  ip varchar(45),
  os_type varchar(50),
  os_version varchar(50),
  api_key_hash varchar(128) NOT NULL,
  status varchar(20) DEFAULT 'active',           -- {'active', 'suspended', ...}
  created_at timestamptz DEFAULT now(),          -- ✓ exists, ASC = oldest first
  last_seen_at timestamptz,
  collector_version varchar(50),
  config_overrides jsonb DEFAULT '{}',
  muted_rules jsonb DEFAULT '[]',
  free_analysis_used boolean DEFAULT false
);
```

`created_at` exists — "oldest 3" logic uses `ORDER BY created_at ASC LIMIT 3`. `status` already has `'suspended'` as an in-use value from the `customer.subscription.deleted` webhook (lines 320-332).

**Schema decision point** for Simon (see "Shape" section): reuse `status='suspended'` and add a reason/timestamp pair, or add separate `disabled_at`/`disabled_reason` columns alongside the existing `status` enum?

### 4. Alert dispatcher hook point

[`lib/server/alerts/dispatcher.ts:dispatchNotifications()`](../src/lib/server/alerts/dispatcher.ts). Single function, called from the ingest path per server per snapshot. Looks up server + customer's enabled alert channels, then fans out to Telegram / Slack / email per channel.

```ts
const serverResult = await query(`SELECT id, name, hostname, ip, customer_id FROM servers WHERE id = $1`, [serverId]);
if (serverResult.rows.length === 0) return;
const server: Server = serverResult.rows[0];
const channelResult = await query(`SELECT id, channel_type, name, config, priorities FROM alert_channels WHERE customer_id = $1 AND enabled = TRUE`, [server.customer_id]);
```

**The disable gate is a one-line addition**: extend the SELECT to fetch `status` (or `disabled_at`), and short-circuit `if (server.status === 'suspended') return;` after the existing 404 guard. Snapshot ingest itself is upstream of this function and **continues unaffected** — exactly what the spec requires (alerts still record in `active_alerts` table; only the channel fanout is suppressed).

### 5. Stripe webhook handlers

[`routes/webhook/stripe/+server.ts`](../src/routes/webhook/stripe/+server.ts) (402 lines). Idempotency claim → switch on event type → release-on-error pattern.

**Handled today**:

| Event | Behaviour |
|---|---|
| `checkout.session.completed` | upsert sub row, `applyPlan(...)`, sync quantity |
| `customer.subscription.created` | upsert sub row; ping operator if checkout didn't fire recently |
| `customer.subscription.updated` | upsert sub row, applyPlan if active; operator-ping for cancel-flip / qty-or-plan changes |
| `customer.subscription.deleted` | applyPlan to free, **suspend excess servers** (the existing precedent) |
| `invoice.payment_failed` | send dunning email, operator ping |
| `invoice.payment_succeeded` | audit log only |

**Missing for billing-enforcement** (spec calls these out):

- **`payment_method.detached`** — fired when customer removes their default payment method. The "card removed" Email 1 trigger.
- **`payment_method.attached`** — fired when customer adds a new payment method. Spec wants this to mark "billing state recovered" but **not auto-restore** disabled servers (customer must click Restore). Cleanest mapping: clear any `pending_enforcement_at` flag on the customer record; UI restore-button enable state already reads live Stripe state via `/billing/status`.

Detection of "no card on file" is currently inferred from the absence of `default_payment_method` on the subscription. Note the **race condition the spec hints at**: a customer could `payment_method.detached` then immediately `payment_method.attached` with a different card; the current `current_period_end` rollover check needs to fetch fresh state from Stripe at the moment of disable, not trust a webhook-derived flag set hours earlier. The spec's Restore endpoint already does this; the periodic job needs the same defence.

### 6. Email templates + engine

[`lib/server/billing/email.ts`](../src/lib/server/billing/email.ts) (95 lines). One template — `sendPaymentFailedEmail()` — and a shared `billingEmailShell(title, body, ctaText, ctaUrl)` builder.

Stack:

- **Provider**: Resend (`resend` SDK; `RESEND_API_KEY` env var; degrades to log-and-skip if absent).
- **Format**: hand-written HTML in a `<table role="presentation">` shell with inline CSS. Dark theme matching the dashboard. Plain-text fallback always provided. MSO conditional comments for Outlook compatibility.
- **From address**: `Dashboard Billing <alerts@glassmkr.com>`.
- **Branding**: orange "Billing" pill badge (`#F97316`), gold CTA (`#C9A043`), brand grey-on-black palette.

Adding the four spec emails (Card removed / T-3 / T-1 / Servers disabled) is each a `sendXxx(email, args)` function calling `billingEmailShell()` with title + body + CTA. ~30-40 lines per template + a unit test. Email 5 (Servers restored) per-server. Restore-confirmation email exists nowhere yet.

No external email-rendering test harness; QA against major clients would be manual against the Resend test inbox.

### 7. Existing disable mechanism

**Yes, and it predates this spec.** The `customer.subscription.deleted` handler ([webhook/stripe/+server.ts:320-332](../src/routes/webhook/stripe/+server.ts)) executes:

```ts
const activeServers = await query(
  `SELECT id FROM servers WHERE customer_id = $1 AND status = 'active' ORDER BY last_seen_at DESC`,
  [customerId]
);
if (activeServers.rows.length > freeLimit) {
  const toSuspend = activeServers.rows.slice(freeLimit).map((r) => r.id);
  await query(`UPDATE servers SET status = 'suspended' WHERE id = ANY($1::text[])`, [toSuspend]);
}
```

Two notes:

- This sorts by `last_seen_at DESC` (keep most-recently-seen 3). Spec wants `created_at ASC` (keep oldest 3). **Operationally different**: a customer with 5 servers where the 2 oldest haven't reported in days would lose their 2 oldest under spec; today's logic would lose 2 different servers. Spec wins on stability of "which 3 stay" — operator can rely on consistent semantics. Worth flipping the ORDER BY in the same workstream for consistency.
- This currently fires only on full-cancellation, not on "card removed but sub still active". The spec's new periodic job is the addition, not a replacement.

The `'suspended'` value already exists in `servers.status` and shows up in queries elsewhere (e.g., [sync.ts:50](../src/lib/server/billing/sync.ts) computes billable count from `status = 'active'` only — suspended servers don't get billed for, which is correct).

## Other findings (open questions from the spec)

1. **Scheduler pattern**: `node-cron` started from `hooks.server.ts` (in-process). New cron added with `cron.schedule("0 * * * *", async () => { ... })`. No external scheduler. Existing precedents: [watchdog-scheduler.ts](../src/lib/server/watchdog-scheduler.ts) (every 2 min), trend-warnings (every 6 h). The billing-rollover check fits this pattern; recommend hourly cadence (the 1h delay between billing-period-end and disable-action is acceptable per spec).

2. **Audit log for system actions on customer accounts**: nothing dedicated. `api_audit_log` (migration 006/009) is for API actions only; `stripe_events_processed` is idempotency. **Recommendation**: log disable/restore events as `console.log("[billing-enforcement] ...")` lines (matches all other billing operator-side logging) and surface a separate ticket for a structured audit table if it becomes operationally needed. Don't bundle into this workstream.

3. **Stripe test mode vs live mode**: Stripe SDK is configured per env var (`STRIPE_*`); test/live separation is environment-driven. Manual verification against test mode requires test API keys and a test webhook endpoint. Surface to Simon to confirm test-mode webhook endpoint exists for the manual verification plan.

4. **Existing customers in the "Pro + no card + >3 servers" state**: **I cannot query prod from this CC session** (sandbox blocks SSH and there's no read-only DB endpoint exposed). **Surface to Simon to check before deploy** — this is the most important pre-deploy diligence item: any customer in this state will receive their first disable-warning email immediately on deploy. The query is something like:

   ```sql
   SELECT c.id, c.email, COUNT(s.id) AS server_count
   FROM customers c
   JOIN servers s ON s.customer_id = c.id AND s.status = 'active'
   WHERE c.plan = 'pro'
     AND c.stripe_customer_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM stripe_subscriptions ss
       WHERE ss.glassmkr_customer_id = c.id AND ss.status = 'active'
     )
   GROUP BY c.id, c.email
   HAVING COUNT(s.id) > 3;
   ```

   (Cross-reference Stripe for `default_payment_method == null` to be precise; the SQL alone may over-count if some have cards but no active sub for unrelated reasons.)

## Three options for shape

The spec offers three shapes (1 / 2 / 3 PRs). Given Task 1 findings, here's a refined view of each:

### Shape 1 — Three PRs

- **PR A (backend)**: migration adding `disabled_at` + `disabled_reason` (or extending the existing `status='suspended'` pattern with audit columns), webhook handlers for `payment_method.{detached,attached}`, periodic cron job, alert-dispatcher gate, restore endpoint, tests.
- **PR B (UI)**: dashboard server tile disabled state, detail-page banner, restore button, hover tooltips.
- **PR C (emails)**: 4 templates + dispatch wiring.

Pros: each PR has a clear scope; PR A can ship and run silently before any UI / customer-visible email lands; lets Simon deploy A first to a dark-mode state where the periodic job logs what it would have done without actually doing it (add a feature flag).
Cons: Phase 7 takes 3 deploys to complete. Customer sees partial state during gap.

### Shape 2 — Two PRs

- **PR A**: backend + emails (one big logic PR, all server-side change).
- **PR B**: UI (visible customer-facing changes).

Pros: complete enforcement lands in one deploy; UI follows once verified.
Cons: PR A is large (migration + 2 webhooks + cron + dispatcher gate + restore + 4 emails + tests) — likely 600-900 lines. Harder to review.

### Shape 3 — One PR

Bundle everything.

Pros: atomic; no partial state ever exists in production.
Cons: ~1000-1500 line PR. Harder to spot regressions; bigger blast radius.

## My recommendation

**Shape 1 + a feature-flag dark-mode in PR A.** Specifically:

- **PR A**: backend with a `BILLING_ENFORCEMENT_ENABLED` env-var gate. With the flag off, the periodic job runs but only logs what it *would* do; webhooks for `payment_method.{detached,attached}` upsert state but don't trigger emails; restore endpoint returns 503 ("not yet enabled"). Migrations + dispatcher gate land but are gated by the flag too.
- **PR B**: UI changes (server tile + detail banner + restore button). Land while flag is still off; no customer-visible behaviour change yet.
- **PR C**: emails wired to the cron and webhooks. Land while flag is still off.
- **Then**: Simon flips the flag in services-1 env, deploys, and the enforcement goes live atomically. Smoke-tests against a test Stripe customer before the flip.

This gets us the staged-review benefits of Shape 1 with the atomic-flip benefits of Shape 3, at the cost of one extra env var that gets removed in a subsequent cleanup PR after the feature is stable.

If Simon would rather avoid the feature flag, Shape 2 is my second choice: combine A+C in one PR (so emails land with the logic that triggers them — they're tightly coupled anyway), keep UI separate (UI changes are isolated and easier to review separately).

**Schema decision** (independent of shape): I'd reuse `servers.status = 'suspended'` and add `suspended_at TIMESTAMPTZ` + `suspended_reason TEXT` columns alongside it. Reasons:

- One source of truth for "is this server disabled?" — `status != 'active'`.
- The existing `customer.subscription.deleted` suspension gets a reason audit trail for free.
- Dispatcher gate, billable-count calculations, etc. that already check `status = 'active'` continue working unchanged.
- Avoids the "two parallel disable mechanisms" ambiguity (`status` enum says 'suspended', but a separate `disabled_at` says active — which wins?).

Migration:

```sql
ALTER TABLE servers
  ADD COLUMN suspended_at TIMESTAMPTZ,
  ADD COLUMN suspended_reason TEXT;

-- Backfill: any servers currently 'suspended' get NOW() and 'unknown'
-- (we don't know historically whether it was downgrade or what; future
-- transitions will set a real reason).
UPDATE servers SET suspended_at = NOW(), suspended_reason = 'unknown'
  WHERE status = 'suspended' AND suspended_at IS NULL;

CREATE INDEX idx_servers_suspended_at ON servers (suspended_at) WHERE suspended_at IS NOT NULL;
```

Then the spec's `disabled_reason` enum becomes `suspended_reason` with values like `'no_card_on_file'`, `'subscription_cancelled'`, `'unknown'` (backfill), `'manual'` (future), `'admin_suspended'` (future). Spec's "disabled" verb can stay in customer-facing copy ("disabled" reads better than "suspended"); internal column name doesn't need to match.

## Open questions for Simon

1. **Pick shape**: 1 (with feature flag) / 1 (no flag, deploy-by-deploy partial state OK) / 2 / 3.
2. **Pick schema**: reuse `status='suspended'` + new `suspended_at`/`suspended_reason` (my rec) vs. new orthogonal `disabled_at`/`disabled_reason` columns.
3. **Existing-customer audit before deploy**: who runs the SQL probe on prod? Whatever the answer, **don't deploy the cron without that count being zero or known**. The first cron firing after deploy could send disable emails to N existing customers — surprise customers don't take well to "we just disabled 4 of your 7 servers" without warning.
4. **Confirm the disable ordering**: spec says "oldest 3 stay active" (ORDER BY `created_at` ASC). Existing `customer.subscription.deleted` code uses `last_seen_at DESC`. Should this PR also flip the cancellation handler to match, or are the two paths intentionally different?
5. **Restore email** (Email 5 in spec): is the per-server restore email essential, or can we just show a toast in the dashboard? Per-server restore for a customer with 10 disabled servers means 10 emails on a multi-restore session — could be noisy. Surface for tone review.
6. **Feature-flag cleanup PR**: if Shape 1 with flag, when do we remove the flag? After 1 customer has run through the full enforcement cycle? After 30 days?

**No deploy / no follow-up PR until Simon picks a shape and answers the existing-customer-audit question.**
