// scope: cru-key-only
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { clickhouse } from "@glassmkr/db/clickhouse";
import { evaluateAlerts, evaluateUnexpectedReboot, evaluateUnexpectedRebootDecay, evaluateInterfaceErrors, evaluateEccErrors, getRuleBootGrace, hasCleanRebootEvidence, isCleanIntentionalReboot, type Snapshot, type SuppressedAlert } from "$lib/server/alerts/evaluator";
import { dispatchNotifications } from "$lib/server/alerts/dispatcher";
import {
  routeAlertEmission,
  attachEvidenceToParent,
  loadActiveAlertsForHost,
  pruneToSurvivingActiveAlerts,
  type ActiveAlertRow,
} from "$lib/server/alerts/subordination";
import { freshEventKeys } from "$lib/server/alerts/event-stacking";
import { profileSuppressedRules } from "$lib/server/alerts/host-profiles";
import { classifyRelease } from "$lib/server/ingest/version";
import { getLatestCrucible } from "$lib/server/version";
import { deriveDiskHealth, persistDiskHealth } from "$lib/server/disk-health";
import { isEventRule } from "$lib/alerts/presentation";
import { isRateLimited, parseOsString, snapshotToClickhouseRow } from "$lib/server/ingest/lifecycle";
import { authenticateCollector } from "$lib/server/auth/ingest-auth";
import {
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import { take, TIER_INGEST_PER_KEY } from "$lib/server/auth/rate-limit";
import { parseSnapshot, safeJsonParse, IngestRejectError } from "$lib/server/ingest/snapshot-schema";
import { safeFetch } from "$lib/server/net/safe-fetch";
import { logSnapshotValidationFailure } from "$lib/server/ingest/validation-failures";
import { runPrePass } from "$lib/server/cross_snapshot";

// Rate limit: 1 ingest per minute per server
const lastIngest = new Map<string, number>();

// Explicit ingest body ceiling (security audit 2026-06-06 S3, defense-in-depth).
// adapter-node's BODY_SIZE_LIMIT default (512K) is the only body cap today and
// it is not pinned in deploy config, so it could drift on an adapter upgrade.
// Reject an over-declared Content-Length here so the highest-value ingest route
// does not depend solely on that default. Also pin BODY_SIZE_LIMIT in
// /etc/glassmkr/dashboard.env (see apps/dashboard/docs/security/README.md).
const MAX_INGEST_BODY_BYTES = 512 * 1024;

export const POST: RequestHandler = async (event) => {
  // Pre-auth IP debit. Without this, a brute-forcer probing
  // gmk_cru_* candidates against this endpoint forces a full HMAC +
  // DB lookup per attempt without burning any rate-limit token. The
  // per-server lastIngest limiter only kicks in after successful
  // auth; pre-auth coverage has to live here. Mirrors the management
  // surface (P1.2 fix), extended to ingest per CC pre-merge task 1
  // check 4.
  //
  // Codex F3 fix 2026-05-22: ingest uses a fleet-sized override (`ip:ingest`
  // namespace, 1000 burst / 100 rps) instead of the management default
  // (100 / 10 rps). One egress IP can NAT a whole fleet of collectors;
  // 200 servers booting at the same minute easily overruns the management
  // bucket before any of them reach the per-server `lastIngest` gate.
  // 1000/100rps supports a steady-state fleet of ~6000 ingests/min from
  // one egress IP, which dwarfs the largest realistic single-NAT customer.
  // Brute-force defence stays meaningful: 100 rps is still far short of
  // a usable rate against 16-hex-char `gmk_cru_*` key entropy.
  const ipFail = await enforceIpRateLimit(event, {
    namespaceSuffix: "ingest",
    capacity: 1000,
    refillPerSecond: 100,
  });
  if (ipFail) {
    return rateLimitedResponse(ipFail.failure);
  }

  // Reject an over-declared body before any auth / parse / allocation work.
  // Chunked uploads (no Content-Length) fall back to the adapter limit + the
  // per-field caps in safeJsonParse.
  const declaredLen = Number(event.request.headers.get("content-length"));
  if (Number.isFinite(declaredLen) && declaredLen > MAX_INGEST_BODY_BYTES) {
    return json({ error: "Payload too large" }, { status: 413 });
  }

  // Authenticate collector
  const authHeader = event.request.headers.get("authorization");
  const server = await authenticateCollector(authHeader);
  if (!server) {
    return json({ error: "Not authenticated" }, { status: 401 });
  }

  // Rate limit: the in-process 55s gate stays as the fast path; the Redis
  // per-key bucket (G2, launch hardening 2026-08-24) is the durable cap a
  // hostile or broken agent cannot reset by waiting out a deploy. Keyed on
  // the authenticated server id, so one melted agent throttles only itself.
  const lastTime = lastIngest.get(server.id) ?? null;
  if (isRateLimited(lastTime, Date.now())) {
    return json({ error: "Too frequent. Max 1 ingest per minute." }, { status: 429 });
  }
  const keyBudget = await take(TIER_INGEST_PER_KEY, server.id);
  if (!keyBudget.allowed) {
    return json(
      { error: "Ingest budget exceeded for this collector key.", retry_after_seconds: keyBudget.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(keyBudget.retryAfterSeconds) } },
    );
  }
  lastIngest.set(server.id, Date.now());

  try {
    // Hardened parse (security audit 2026-05-22 §1.3 / T-402, T-403, T-205).
    // safeJsonParse rejects prototype-pollution keys + oversize string
    // fields at the JSON boundary, independent of the Zod log-mode below.
    // The raw body is bounded by the Content-Length guard above plus
    // adapter-node BODY_SIZE_LIMIT. On a hostile payload we return 400 before
    // any parsing/storage work.
    const rawText = await event.request.text();
    let rawSnap: Snapshot & { collector_version?: string; timestamp?: string };
    try {
      rawSnap = safeJsonParse(rawText) as Snapshot & { collector_version?: string; timestamp?: string };
    } catch (parseErr) {
      if (parseErr instanceof IngestRejectError) {
        return json({ error: "Rejected payload", reason: parseErr.reason }, { status: 400 });
      }
      return json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Phase 1: Zod validation in log-mode. Failures don't block; we
    // record structured issues to a dedicated logger so we can detect
    // schema/reality drift before flipping to reject mode.
    // See snapshot-schema.ts and master-plan Phase 1.
    const parseResult = parseSnapshot(rawSnap);
    if (!parseResult.ok) {
      logSnapshotValidationFailure({
        serverId: server.id,
        collectorVersion: rawSnap.collector_version,
        issues: parseResult.issues,
      });
    }

    const snap = rawSnap;

    // 1. Update server metadata in PostgreSQL
    const { osType, osVersion } = parseOsString(snap.system?.os);

    // Hardware-summary fields (migration 012): dmi_vendor /
    // dmi_product / ipmi_sensors_count are denormalised onto the
    // servers row so the dashboard list response can return them
    // without an n+1 ClickHouse fetch per tile. Pre-0.8.0 agents
    // don't emit `snap.dmi`; in that case we leave the existing
    // values in place (NULL on a fresh server, last-known on a
    // downgrade). raw_vendor is stored verbatim; vendor
    // normalisation happens at render time so the canonical-name
    // table can change without a backfill.
    const dmiVendor = snap.dmi?.raw_vendor ?? null;
    const dmiProduct = snap.dmi?.product_name ?? null;
    const ipmiSensorsCount = Array.isArray(snap.ipmi?.sensors) ? snap.ipmi.sensors.length : 0;

    // GPU count (Crucible v0.13.0+): denormalised onto the servers row
    // so the fleet list can render a `GPU` badge without an n+1
    // ClickHouse fetch. 0 when the host has no NVIDIA GPUs or is on a
    // pre-0.13.0 agent. Migration 023.
    const gpuTier1 = snap.gpu && "tier1" in snap.gpu ? (snap.gpu as { tier1?: unknown }).tier1 : undefined;
    const gpuCount =
      gpuTier1 && typeof gpuTier1 === "object" && "available" in gpuTier1 && (gpuTier1 as { available: boolean }).available
        ? ((gpuTier1 as { gpus?: unknown[] }).gpus?.length ?? 0)
        : 0;

    // os_id / os_id_like / os_version_id added per migration 021 (2026-05-17)
    // so the FIX-workflow resolver can pick the right variant at fetch time.
    // COALESCE preserves prior values if a snapshot omits the field (older
    // Crucible builds may not populate all three).
    //
    // observed_interval_seconds (migration 028): the agent never reports its
    // configured interval, so measure it: the gap between consecutive
    // snapshots IS the cadence. Bounded to [10s, 1h] (agent config allows
    // 60..3600). SET expressions evaluate against the pre-UPDATE row, so
    // last_seen_at here is the previous snapshot's arrival time. The
    // watchdog uses this to scale server_unreachable to the host's real
    // cadence instead of assuming the 300s default.
    //
    // Clamped (2026-06-11 incident): a restarted agent collects immediately
    // on startup, so a routine restart produces ONE short gap; recording it
    // raw collapsed a 300s host's observed cadence to ~60s and fired a
    // false P0 server_unreachable inside its normal quiet period. A single
    // sample may now move the value by at most +50% / -25% (GREATEST/LEAST
    // around the stored value; first sample taken raw), so neither restart
    // blips nor sub-1h outage gaps can poison the threshold, while a
    // genuine cadence change converges within a few snapshots. (A host
    // genuinely slowing down, e.g. 60s -> 300s config change, may see 1-2
    // watchdog fires while the value converges upward; rare and operator-
    // initiated.) Migration 029 reset values recorded before the clamp.
    // The RETURNING clause yields measured_interval_seconds: the RAW gap since the
    // previous snapshot (captured in the `prev` CTE before this UPDATE overwrites
    // last_seen_at), unclamped, bounded to a sane [10s, 1h]. This is the interval
    // the CURRENT /proc/diskstats delta actually spans, so disk_latency_high's IOPS
    // conversion uses it instead of the SMOOTHED observed_interval_seconds. The
    // smoothed value is deliberately clamped (+50%/-25% per sample) for the
    // watchdog, which made it wrong for a per-sample rate on a cadence change:
    // a 300s->60s switch left it near 225s so a true 600 IOPS read as ~160,
    // misclassifying a saturated device as an unsaturated critical (Codex
    // 2026-07-18 #6). The watchdog keeps the smoothed value untouched.
    const serverUpdate = await query(
      `WITH prev AS (SELECT last_seen_at AS old_seen FROM servers WHERE id = $1)
       UPDATE servers SET last_seen_at = NOW(), hostname = $2, ip = $3,
       os_type = $4, os_version = $5, collector_version = $6,
       dmi_vendor = COALESCE($7, dmi_vendor),
       dmi_product = COALESCE($8, dmi_product),
       ipmi_sensors_count = $9,
       os_id = COALESCE($10, os_id),
       os_id_like = COALESCE($11, os_id_like),
       os_version_id = COALESCE($12, os_version_id),
       gpu_count = $13,
       observed_interval_seconds = CASE
         WHEN last_seen_at IS NOT NULL
          AND NOW() - last_seen_at BETWEEN INTERVAL '10 seconds' AND INTERVAL '1 hour'
         THEN GREATEST(
                LEAST(
                  EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int,
                  COALESCE((observed_interval_seconds * 3) / 2,
                           EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int)
                ),
                COALESCE((observed_interval_seconds * 3) / 4,
                         EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int)
              )
         ELSE observed_interval_seconds
       END
       FROM prev
       WHERE servers.id = $1
       RETURNING CASE
         WHEN prev.old_seen IS NOT NULL
          AND NOW() - prev.old_seen BETWEEN INTERVAL '10 seconds' AND INTERVAL '1 hour'
         THEN EXTRACT(EPOCH FROM (NOW() - prev.old_seen))::int
         ELSE NULL
       END AS measured_interval_seconds`,
      [
        server.id,
        snap.system?.hostname,
        snap.system?.ip,
        osType,
        osVersion,
        snap.collector_version || "unknown",
        dmiVendor,
        dmiProduct,
        ipmiSensorsCount,
        snap.system?.os_id ?? null,
        snap.system?.os_id_like ?? null,
        snap.system?.os_version_id ?? null,
        gpuCount,
      ]
    );

    // 2. Insert snapshot into ClickHouse
    const insertedTs = snap.timestamp ? new Date(snap.timestamp) : new Date();
    const insertedTsMs = insertedTs.getTime();
    await clickhouse.insert({
      table: "snapshots",
      values: [snapshotToClickhouseRow(server.id, snap, insertedTsMs)],
      format: "JSONEachRow",
    });

    // 3. Evaluate alerts
    const configResult = await query(`SELECT config_overrides, muted_rules, profile, observed_interval_seconds FROM servers WHERE id = $1`, [server.id]);
    const overrides = configResult.rows[0]?.config_overrides || {};
    // Effective collection interval for disk_latency_high's IOPS conversion, most
    // to least authoritative: an explicit operator override; else the RAW measured
    // gap for THIS snapshot (the interval the current diskstats delta spans, from
    // the UPDATE above); else the smoothed observed cadence; else the 300s default.
    // Using the raw per-sample gap ahead of the smoothed value is the #6 fix: the
    // smoothed value lags a cadence change and skews the per-second rate.
    const measuredIntervalSeconds: number | null =
      serverUpdate.rows[0]?.measured_interval_seconds ?? null;
    const collectionIntervalSeconds =
      overrides.interval_seconds || measuredIntervalSeconds || configResult.rows[0]?.observed_interval_seconds || 300;
    // Effective mute set = the operator's manual mutes UNION the rules a
    // host-type profile suppresses by design (e.g. a marketplace GPU host's
    // no_firewall / unattended_upgrades_disabled / gpu_power_cap_throttling),
    // deduped. Only evaluation sees this union; servers.muted_rules and the
    // GET /mutes endpoint stay the manual list. See host-profiles.ts.
    const manualMutes: string[] = configResult.rows[0]?.muted_rules || [];
    const mutedRules = Array.from(
      new Set([...manualMutes, ...profileSuppressedRules(configResult.rows[0]?.profile)]),
    );
    const suppressed: SuppressedAlert[] = [];

    // 3.pre. Cross-snapshot pre-pass. Inspects each rule's YAML
    // metadata for a `cross_snapshot` block; for matching rules,
    // loads the declared snapshot window and (optionally) cross-rule
    // correlation in parallel. The map is then threaded through
    // evaluateAlerts; rules without a cross_snapshot block see
    // ctx === undefined and behave exactly as today.
    // Per CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §2.2.
    const crossSnapshotData = await runPrePass(server.id, mutedRules, {
      pg: async (sql, params) => query(sql, params ?? []),
    });

    const alertResults = evaluateAlerts(
      snap,
      { ...overrides, muted_rules: mutedRules, collection_interval_seconds: collectionIntervalSeconds },
      suppressed,
      crossSnapshotData,
    );

    // 3a. Evaluate interface_errors (three-tier, needs previous snapshot's
    // network array for the sustained-2-intervals gate at the orange
    // absolute-count threshold). Dashboard re-computes the same tiers
    // client-side via the shared classifier so there's no snapshot schema
    // change; the evaluator just returns the alerts to fire.
    if (!mutedRules.includes("interface_errors")) {
      try {
        const prevNetResult = await clickhouse.query({
          query: `SELECT network FROM snapshots WHERE server_id = {serverId:String} AND timestamp < fromUnixTimestamp64Milli({currentTsMs:UInt64}) ORDER BY timestamp DESC LIMIT 1`,
          query_params: { serverId: server.id, currentTsMs: insertedTsMs },
          format: "JSONEachRow",
        });
        const prevNetRows = await prevNetResult.json<{ network: string | any[] }>();
        let prevNetwork: any[] | null = null;
        if (prevNetRows.length > 0) {
          const raw = prevNetRows[0].network;
          prevNetwork = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
          if (!Array.isArray(prevNetwork)) prevNetwork = null;
        }
        const res = evaluateInterfaceErrors(snap, prevNetwork);
        // Apply the boot-grace the interface_errors rule declares in the
        // central rule table. evaluateInterfaceErrors runs in its own
        // code path (needs previous-snapshot context) so the suppression
        // lives here rather than in evaluateAlerts. Read the canonical
        // value from the rule table so a tweak over there stays
        // consistent with this call site.
        const ifaceGrace = getRuleBootGrace("interface_errors");
        const uptime = snap.system?.uptime_seconds ?? Infinity;
        if (uptime < ifaceGrace) {
          for (const a of res.alerts) {
            suppressed.push({
              type: a.type, reason: "boot_grace",
              uptime_at_evaluation: uptime, grace_seconds: ifaceGrace,
              title: a.title, message: a.message, severity: a.severity,
              evidence: a.evidence,
            });
          }
        } else {
          alertResults.push(...res.alerts);
        }
      } catch (err: any) {
        console.error("[interface_errors] Evaluation error:", err.message);
      }
    }

    // 3a-2. Evaluate ecc_errors rate-based path (correctable side).
    // Lives in its own call site for the same reason interface_errors
    // does — needs cross-snapshot state. Uncorrectable is handled by
    // the synchronous rule above (any non-zero count fires critical
    // immediately). Boot-grace applies the same way: hardware rules
    // suppress alerts during the early-boot window because BMC
    // counters often haven't yet stabilised. glassmkr#24.
    if (!mutedRules.includes("ecc_errors")) {
      try {
        const eccAlerts = await evaluateEccErrors(
          snap,
          { ...overrides, muted_rules: mutedRules },
          server.id,
        );
        const eccGrace = getRuleBootGrace("ecc_errors");
        const uptime = snap.system?.uptime_seconds ?? Infinity;
        if (uptime < eccGrace) {
          for (const a of eccAlerts) {
            suppressed.push({
              type: a.type, reason: "boot_grace",
              uptime_at_evaluation: uptime, grace_seconds: eccGrace,
              title: a.title, message: a.message, severity: a.severity,
              evidence: a.evidence,
            });
          }
        } else {
          alertResults.push(...eccAlerts);
        }
      } catch (err: any) {
        console.error("[ecc_errors] Evaluation error:", err?.message ?? err);
      }
    }

    // 3b. Evaluate unexpected_reboot (needs previous snapshot from ClickHouse)
    // Use insertedTsMs (the exact timestamp we inserted) to exclude the current row
    if (!mutedRules.includes("unexpected_reboot")) {
      try {
        const prevResult = await clickhouse.query({
          query: `SELECT uptime_seconds, timestamp FROM snapshots WHERE server_id = {serverId:String} AND timestamp < fromUnixTimestamp64Milli({currentTsMs:UInt64}) ORDER BY timestamp DESC LIMIT 1`,
          query_params: { serverId: server.id, currentTsMs: insertedTsMs },
          format: "JSONEachRow",
        });
        const prevRows = await prevResult.json<{ uptime_seconds: number; timestamp: string }>();
        if (prevRows.length > 0) {
          // CH returns DateTime64 as "YYYY-MM-DD HH:MM:SS.mmm" without timezone.
          // Append "Z" so JS Date parses it as UTC, not local time.
          const prevTsRaw = prevRows[0].timestamp;
          const prevTsMs = new Date(prevTsRaw.includes("T") || prevTsRaw.includes("Z") ? prevTsRaw : prevTsRaw.replace(" ", "T") + "Z").getTime();
          const activeRebootAlertRow = await query(
            `SELECT id, evidence FROM active_alerts WHERE server_id = $1 AND alert_type = 'unexpected_reboot' AND resolved_at IS NULL LIMIT 1`,
            [server.id]
          );
          let hasActiveRebootAlert = activeRebootAlertRow.rows.length > 0;
          const storedCleanReboot = hasCleanRebootEvidence(activeRebootAlertRow.rows[0]?.evidence);
          const freshCleanReboot = isCleanIntentionalReboot(
            snap,
            prevRows[0].uptime_seconds,
            prevTsMs,
            insertedTsMs,
          );
          if (hasActiveRebootAlert && (storedCleanReboot || freshCleanReboot)) {
            const alertId = activeRebootAlertRow.rows[0].id;
            await query(
              `UPDATE active_alerts SET resolved_at = NOW(), resolution_reason = $2 WHERE id = $1`,
              [alertId, "auto_resolved_clean_reboot_evidence"]
            );
            hasActiveRebootAlert = false;
            console.log(
              `[unexpected_reboot] auto-resolved-clean server=${server.id} alert_id=${alertId}`,
            );
          }
          // Auto-decay: if a reboot alert is still active but the box has
          // been stable for >= decay_hours of uptime, resolve it. The
          // signal was useful at the moment of the reboot; it turns into
          // dashboard noise once the box has clearly recovered. Default
          // 24h, per-server override via config_overrides.unexpected_reboot_decay_hours.
          // The evaluator itself stays single-fire — this lives in the
          // ingest path so the rule logic stays pure.
          if (hasActiveRebootAlert) {
            const decay = evaluateUnexpectedRebootDecay(
              snap.system?.uptime_seconds ?? 0,
              overrides,
            );
            if (decay.shouldResolve) {
              const alertId = activeRebootAlertRow.rows[0].id;
              await query(
                `UPDATE active_alerts SET resolved_at = NOW(), resolution_reason = $2 WHERE id = $1`,
                [alertId, decay.resolution_reason]
              );
              hasActiveRebootAlert = false;
              console.log(
                `[unexpected_reboot] auto-decay server=${server.id} alert_id=${alertId} uptime=${snap.system?.uptime_seconds ?? 0}s threshold=${decay.decay_hours_used}h`,
              );
            }
          }
          const rebootAlert = evaluateUnexpectedReboot(
            snap,
            prevRows[0].uptime_seconds,
            prevTsMs,
            hasActiveRebootAlert,
            insertedTsMs,
            suppressed,
          );
          if (rebootAlert) alertResults.push(rebootAlert);
        }
      } catch (err: any) {
        console.error("[reboot] Previous snapshot query error:", err.message);
      }
    }

    // Disk health rollup (see CC_DISK_HEALTH_ROLLUP.md). Derive a per-drive
    // tier from this snapshot's SMART + io_errors state, persist it, and
    // log any transitions. Phase 1 is silent: no notifications fire from
    // transitions yet. Failures are isolated; this must not break ingest.
    try {
      const diskObs = deriveDiskHealth(snap.smart, snap.io_errors);
      const transitions = await persistDiskHealth(server.id, diskObs);
      for (const t of transitions) {
        if (t.class) {
          console.log(
            `[disk-health] server=${server.id} device=${t.device_id} ${t.prev ?? "new"} -> ${t.next} (${t.class.kind}${t.class.kind === "fire" ? ` p${t.class.priority}` : ""}) signals=[${t.signals.join(",")}]`,
          );
        }
      }
    } catch (err: any) {
      console.error("[disk-health] derivation/persist error:", err.message);
    }

    // Fix commands are no longer baked from the static FIX_COMMANDS table at
    // ingest (staged migration to the YAML library as the single source of
    // truth, 2026-06-02). The evaluator still attaches dynamic fix_commands for
    // rules that substitute real device/unit/iface names, and those continue to
    // win downstream; for every other rule the deepened YAML library is now the
    // source, resolved at fetch time (alerts GET endpoint) and at notification
    // time (dispatcher/email via resolveFix).

    // 4. Update active_alerts in PostgreSQL
    const currentTypes = new Set(alertResults.map((a) => a.type));
    const eventRuleTypes = [...currentTypes].filter(isEventRule);
    // Computed early (was: just before the resolver below) because the
    // routing prune (Codex F1 fix 2026-05-22) needs the same exclusion list
    // the resolver uses.
    const eventExclusions = [...new Set(["unexpected_reboot", ...eventRuleTypes])];
    let newAlertCount = 0;
    // B-1 (round 2): alert_history is a STATE-TRANSITION log, not a per-
    // snapshot dump. Append a "fired" event only when an alert genuinely
    // transitions into firing (a new active row) or an event rule records a
    // NEW occurrence, never on a snapshot where the alert merely stays active.
    // Pre-fix, a chronic alert wrote a "fired" row every snapshot (190x in
    // ~4h on an idle marketplace GPU), burying the real transitions and
    // capping the 200-event history window at a few hours.
    const firedEvents: typeof alertResults = [];

    // Subordination + incident grouping (CC_SPEC_RUNTIME_SUBORDINATION_2026-05-19).
    // Load active alerts for this host once, then route each emission
    // either as evidence on an existing parent or as a standalone row.
    // The list is updated inline as new rows are emitted within this
    // loop so subsequent same-snapshot emissions can attach to an
    // incident-group row that this loop just created.
    //
    // Codex F1 fix 2026-05-22: prune the loaded snapshot down to rows whose
    // alert_type will survive THIS snapshot's resolve pass (below). Without
    // this prune, a child rule firing this snapshot can route as evidence
    // onto a parent (or incident-group anchor) that this same snapshot is
    // about to auto-resolve — parent disappears, child never emits, the
    // operator sees nothing.
    const hostActiveAlertsRaw = await loadActiveAlertsForHost(query, server.id);
    const hostActiveAlerts: ActiveAlertRow[] = pruneToSurvivingActiveAlerts(
      hostActiveAlertsRaw,
      currentTypes,
      eventExclusions,
    );
    const now = new Date();

    for (const alert of alertResults) {
      const routing = routeAlertEmission(alert, server.id, hostActiveAlerts, now);
      if (routing.kind === "attach_to_parent") {
        const childEvidence = alert.evidence as Record<string, unknown>;
        await attachEvidenceToParent(
          query,
          routing.parent_alert_id,
          { rule_id: alert.type, severity: alert.severity },
          childEvidence,
          routing.relationship,
          now,
        );
        console.log(
          `[subordination] attached rule=${alert.type} parent_alert_id=${routing.parent_alert_id} relationship=${routing.relationship} reason=${routing.reason} server=${server.id}`,
        );
        continue;
      }
      // routing.kind === "emit_independent"
      const incidentGroupKey = routing.incident_group_key ?? null;
      if (isEventRule(alert.type)) {
        // Event-type alerts: stack occurrences into one card instead of overwriting.
        // If an unresolved alert exists, append the occurrence and un-acknowledge.
        const existing = await query(
          `SELECT id, evidence FROM active_alerts WHERE server_id = $1 AND alert_type = $2 AND resolved_at IS NULL`,
          [server.id, alert.type]
        );
        const occurrence = {
          timestamp: new Date().toISOString(),
          ...(alert.evidence as Record<string, unknown>),
        };

        if (existing.rows.length > 0) {
          const row = existing.rows[0];
          const prevEvidence = typeof row.evidence === "string" ? JSON.parse(row.evidence) : (row.evidence ?? {});
          const occurrences = Array.isArray(prevEvidence.occurrences) ? prevEvidence.occurrences : [];
          // SEL spam fix (2026-06-11): windowed event rules re-emit the same
          // events on every snapshot for as long as they stay inside the rule
          // window, so "an emission arrived" is not "a new event happened".
          // Only emissions carrying an event with no recorded occurrence
          // stack and re-notify; otherwise refresh evidence + last_seen
          // quietly and leave the occurrence count, "(N times)" title, ack
          // state, and notification flag untouched. Pre-fix, one SEL entry
          // produced a notification per 60s snapshot for its whole window.
          // freshEventKeys returns null for rules without an identity
          // extractor; those keep the legacy stack-on-every-emission path.
          const fresh = freshEventKeys(alert.type, alert.evidence as Record<string, unknown>, occurrences);
          if (fresh !== null && fresh.length === 0) {
            const refreshedEvidence = { ...alert.evidence, occurrences };
            await query(
              `UPDATE active_alerts SET evidence = $2, last_seen = NOW() WHERE id = $1`,
              [row.id, JSON.stringify(refreshedEvidence)]
            );
          } else {
            occurrences.push(occurrence);
            const count = occurrences.length;
            // Stacking canary (2026-06-11): with identity dedup in place, a
            // fast-growing occurrence count is either a real event storm or
            // a dedup regression; both deserve a loud journal line. The
            // pre-dedup SEL bug reached 102 occurrences in one afternoon.
            if (count === 25 || count === 100) {
              console.error(
                `[stacking-canary] ${alert.type} on server ${server.id} has stacked ${count} occurrences; verify these are genuinely distinct events (dedup regression check)`
              );
            }
            const updatedEvidence = { ...alert.evidence, occurrences };
            const stackedTitle = count > 1
              ? alert.title.replace(/\s*\(\d+ times?\)$/, "") + ` (${count} times)`
              : alert.title;
            await query(
              `UPDATE active_alerts SET severity = $2, title = $3, message = $4, evidence = $5,
               recommendation = $6, last_seen = NOW(), acknowledged = FALSE, acknowledged_at = NULL
               WHERE id = $1`,
              [row.id, alert.severity, stackedTitle, alert.message, JSON.stringify(updatedEvidence), alert.recommendation]
            );
            // Mark notification_sent = false so the new occurrence gets dispatched
            await query(`UPDATE active_alerts SET notification_sent = FALSE WHERE id = $1`, [row.id]);
            // A genuinely new event occurrence is a state transition worth a
            // history row (the quiet-refresh branch above is not).
            firedEvents.push(alert);
          }
        } else {
          // First occurrence: create with occurrences array
          const evidence = { ...alert.evidence, occurrences: [occurrence] };
          const result = await query(
            `INSERT INTO active_alerts (server_id, alert_type, severity, title, message, evidence, recommendation, incident_group_key, first_seen, last_seen)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
             ON CONFLICT (server_id, alert_type) WHERE resolved_at IS NULL
             DO UPDATE SET severity = $3, title = $4, message = $5, evidence = $6, recommendation = $7,
                           last_seen = NOW()
             RETURNING id, first_seen, (xmax = 0) AS is_new`,
            [server.id, alert.type, alert.severity, alert.title, alert.message, JSON.stringify(evidence), alert.recommendation, incidentGroupKey]
          );
          if (result.rows[0]?.is_new) {
            newAlertCount++;
            firedEvents.push(alert);
            // Make the newly-created row visible to subsequent routing
            // decisions in this same snapshot (incident-group siblings).
            if (incidentGroupKey) {
              hostActiveAlerts.push({
                id: result.rows[0].id,
                alert_type: alert.type,
                first_seen: result.rows[0].first_seen instanceof Date
                  ? result.rows[0].first_seen
                  : new Date(result.rows[0].first_seen),
                incident_group_key: incidentGroupKey,
                parent_alert_id: null,
                evidence: null,
              });
            }
          }
        }
      } else {
        // State-type alerts: standard upsert (overwrite on re-fire)
        const result = await query(
          `INSERT INTO active_alerts (server_id, alert_type, severity, title, message, evidence, recommendation, incident_group_key, first_seen, last_seen)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
           ON CONFLICT (server_id, alert_type) WHERE resolved_at IS NULL
           DO UPDATE SET severity = $3, title = $4, message = $5, evidence = $6, recommendation = $7,
                         last_seen = NOW()
           RETURNING id, first_seen, (xmax = 0) AS is_new`,
          [server.id, alert.type, alert.severity, alert.title, alert.message, JSON.stringify(alert.evidence), alert.recommendation, incidentGroupKey]
        );
        if (result.rows[0]?.is_new) {
          newAlertCount++;
          firedEvents.push(alert);
          if (incidentGroupKey) {
            hostActiveAlerts.push({
              id: result.rows[0].id,
              alert_type: alert.type,
              first_seen: result.rows[0].first_seen instanceof Date
                ? result.rows[0].first_seen
                : new Date(result.rows[0].first_seen),
              incident_group_key: incidentGroupKey,
              parent_alert_id: null,
              evidence: null,
            });
          }
        }
      }
    }

    // Resolve state-type alerts that are no longer active.
    // Event-type alerts are exempt: they resolve only via user action or 24h TTL.
    // (eventExclusions is computed above so the routing prune can reuse it.)
    await query(
      `UPDATE active_alerts SET resolved_at = NOW()
       WHERE server_id = $1 AND resolved_at IS NULL
       AND alert_type != ALL($2::text[])
       AND alert_type != ALL($3::text[])`,
      [server.id, Array.from(currentTypes), eventExclusions]
    );

    // Auto-resolve event-type alerts after 24 hours of no new occurrences.
    // This path pre-dates PR #66's uptime-based unexpected_reboot decay
    // and is a sibling resolver: when 24h have elapsed since the last
    // occurrence (last_seen), clear the alert. Two race outcomes are
    // possible for unexpected_reboot on a box that's been rebooted again
    // (uptime resets but last_seen does not): the uptime-based path
    // can't qualify, so this path wins and resolves the alert at 24h
    // since first_seen. Without the resolution_reason stamp the resolved
    // row was indistinguishable from a manual resolution; surfaced by
    // CC's 2026-05-14 overnight verification (3 of 6 fleet
    // unexpected_reboot resolves landed with NULL reason).
    for (const evType of eventExclusions) {
      await query(
        `UPDATE active_alerts
         SET resolved_at = NOW(),
             resolution_reason = 'auto_decay_24h_since_last_seen'
         WHERE server_id = $1 AND alert_type = $2
         AND resolved_at IS NULL AND last_seen < NOW() - INTERVAL '24 hours'`,
        [server.id, evType]
      );
    }

    // 5. Write new alert events to ClickHouse. State transitions only: see
    // firedEvents above. A chronic alert no longer re-logs a "fired" row
    // every snapshot; the active_alerts row's last_seen tracks ongoing state.
    for (const alert of firedEvents) {
      await clickhouse.insert({
        table: "alert_history",
        values: [{
          server_id: server.id,
          timestamp: Date.now(),
          event_type: "fired",
          alert_type: alert.type,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          evidence: JSON.stringify(alert.evidence),
          recommendation: alert.recommendation,
        }],
        format: "JSONEachRow",
      });
    }

    // 5a. Write suppressed-alert audit rows. These never create an
    // active_alerts row or dispatch a notification; they exist so "why
    // did this not fire?" is answerable from history. event_type:
    // suppressed_boot_grace for uptime < grace, suppressed_planned_reboot
    // when the operator ran `crucible-agent reboot`.
    for (const s of suppressed) {
      const eventType = s.reason === "boot_grace" ? "suppressed_boot_grace" : "suppressed_planned_reboot";
      await clickhouse.insert({
        table: "alert_history",
        values: [{
          server_id: server.id,
          timestamp: Date.now(),
          event_type: eventType,
          alert_type: s.type,
          severity: s.severity,
          title: s.title,
          message: s.message,
          evidence: JSON.stringify({
            ...s.evidence,
            suppression_reason: s.reason,
            uptime_at_evaluation: s.uptime_at_evaluation,
            ...(s.grace_seconds !== undefined ? { grace_seconds: s.grace_seconds } : {}),
            ...(s.planned_reboot_reason !== undefined ? { planned_reboot_reason: s.planned_reboot_reason } : {}),
          }),
          recommendation: "",
        }],
        format: "JSONEachRow",
      });
    }

    // Dispatch notifications for unsent alerts (non-blocking)
    const newAlertRows = await query(
      `SELECT id, alert_type, severity, title, message, evidence, recommendation FROM active_alerts
       WHERE server_id = $1 AND notification_sent = FALSE AND resolved_at IS NULL`,
      [server.id]
    );
    if (newAlertRows.rows.length > 0) {
      dispatchNotifications(server.id, newAlertRows.rows, []).catch((err: any) =>
        console.error("[notify] Dispatch error:", err.message)
      );
    }

    // Version update notification via alert channels.
    // Major releases (X.0.0, 0.X.0): sent to all channels (mandatory, cannot be unchecked).
    // Patch releases (0.0.X): sent only to channels with notify_minor_update=true.
    // Fires once per customer per latest version.
    //
    // releaseType is classified against the previously-notified version
    // (`crucible_version_notified` per customer) when one exists, falling
    // back to the agent's reported version on first notification. Without
    // this, two npm publishes within an hour (e.g. 0.8.0 then 0.8.1)
    // would both classify as "major" against an agent still running
    // 0.7.1, producing a Telegram message that labels the second patch
    // release as "Major update". Anchoring on `crucible_version_notified`
    // makes the label reflect "what changed since we last told you",
    // which is the only thing the user cares about.
    const collectorVersion = snap.collector_version || "0.1.0";
    const latestCrucible = await getLatestCrucible();
    const alreadyNotified = await query(
      `SELECT crucible_version_notified FROM customers WHERE id = $1`,
      [server.customerId]
    );
    const notifiedVersion = alreadyNotified.rows[0]?.crucible_version_notified;
    const baselineVersion = notifiedVersion || collectorVersion;
    const releaseType = classifyRelease(baselineVersion, latestCrucible);
    if (releaseType !== "none") {
      if (notifiedVersion !== latestCrucible) {
        await query(
          `UPDATE customers SET crucible_version_notified = $1 WHERE id = $2`,
          [latestCrucible, server.customerId]
        );

        const outdatedResult = await query(
          `SELECT name, hostname, collector_version FROM servers
           WHERE customer_id = $1 AND status = 'active' AND collector_version IS NOT NULL`,
          [server.customerId]
        );
        const outdatedServers = outdatedResult.rows.filter(
          (s: any) => s.collector_version && classifyRelease(s.collector_version, latestCrucible) !== "none"
        );
        const serverList = outdatedServers
          .map((s: any) => `  \u2022 <b>${s.hostname || s.name}</b> (${s.collector_version})`)
          .join("\n");
        const serverListSlack = outdatedServers
          .map((s: any) => `  * *${s.hostname || s.name}* (${s.collector_version})`)
          .join("\n");
        const countLabel = outdatedServers.length === 1
          ? `1 server needs updating`
          : `${outdatedServers.length} servers need updating`;
        const releaseLabel = releaseType === "major" ? "Major update" : "Patch update";

        const channelResult = await query(
          `SELECT id, channel_type, name, config FROM alert_channels WHERE customer_id = $1 AND enabled = TRUE`,
          [server.customerId]
        );
        const bot_token = process.env.TELEGRAM_BOT_TOKEN;
        for (const ch of channelResult.rows) {
          // Patch releases: skip channels that haven't opted in
          if (releaseType === "patch" && !ch.config?.notify_minor_update) continue;
          try {
            if (ch.channel_type === "telegram" && bot_token && ch.config?.chat_id) {
              await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: ch.config.chat_id,
                  text: `\u{2B06}\u{FE0F} <b>${releaseLabel}: Crucible ${latestCrucible}</b>\n\n${countLabel}:\n${serverList}\n\n<a href="https://github.com/glassmkr/crucible/releases/tag/v${latestCrucible}">Release notes</a>`,
                  parse_mode: "HTML",
                  disable_web_page_preview: true,
                }),
                signal: AbortSignal.timeout(10000),
              });
            } else if (ch.channel_type === "slack" && ch.config?.webhook_url) {
              await safeFetch(ch.config.webhook_url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  blocks: [
                    { type: "section", text: { type: "mrkdwn", text: `:arrow_up: *${releaseLabel}: Crucible ${latestCrucible}*\n\n${countLabel}:\n${serverListSlack}\n\n<https://github.com/glassmkr/crucible/releases/tag/v${latestCrucible}|Release notes>` } },
                  ],
                }),
                signal: AbortSignal.timeout(10000),
              });
            } else if (ch.channel_type === "email" && ch.config?.email) {
              // Email update notifications use the dispatcher's sendEmail
              // (import is already available via dispatchNotifications module)
              // For now, email channel version notifications use the same Resend path
              // as alert emails. Full implementation deferred to dispatcher refactor.
            }
          } catch { /* notification failure should not break ingest */ }
        }
        console.log(`[version] Notified customer ${server.customerId} about Crucible ${latestCrucible} (${releaseType}, ${outdatedServers.length} outdated servers)`);
      }
    }

    // Count active alerts
    const activeResult = await query(
      `SELECT COUNT(*) FROM active_alerts WHERE server_id = $1 AND resolved_at IS NULL`,
      [server.id]
    );

    return json({
      success: true,
      received_at: insertedTs.toISOString(),
      new_alerts: newAlertCount,
      active_alerts: parseInt(activeResult.rows[0].count, 10),
    });
  } catch (err: any) {
    console.error("Ingest error:", err.message);
    return json({ error: "Failed to process snapshot" }, { status: 500 });
  }
};
