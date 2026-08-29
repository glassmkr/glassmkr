# /vs comparison-page fairness audit: 2026-06

**Scope:** the eight `glassmkr.com/vs/<slug>` pages (datadog, prometheus, netdata, checkmk, zabbix, librenms, cloudwatch, newrelic). Claims only; no restructuring, slug, or anchor changes.

**Method:** every competitor-referencing statement and every Glassmkr self-claim was extracted and verified against a PRIMARY source only (the competitor's own current docs / pricing / changelog, or the local repo for Glassmkr facts). Access date for all web checks: **2026-06-25**. Classification: FACTUAL-ERROR (wrong/stale/untrue), UNVERIFIABLE (no primary source), FAIR (verified + not misleading).

**Posture (per the brief):** objective factual corrections applied directly in branch `vs-fairness-audit`; judgement/unverifiable items were first listed as **HELD** with a proposed change. A pre-merge verification pass (below) then re-checked every held item that only changed a citation or that Simon green-lit, against the competitor's own page, and promoted the confirmed ones to **APPLIED**. The remaining HELD items are pure judgement/wording calls left for Simon.

**Glassmkr ground-truth (held to across all pages):** 62 alert rules (verified: 62 YAMLs in `apps/dashboard/src/lib/server/alerts/rules/`): every page already says 62, none say 38; Crucible **0.13.11** (`FALLBACK_LATEST`); Bench / probe MCP servers are **not** referenced on any /vs page (good); `$3/node, 3 free` matches the live pricing page. Crucible agent MIT confirmed (`crucible/LICENSE`).

---

## Pre-merge primary-source verification pass (2026-06-25)

A wrong "correction" re-introduces the exact unfairness the audit exists to remove, so before merge every checkable change was re-fetched from the competitor's own page. Results:

- **LibreNMS license (CAUGHT + REVERTED).** An earlier edit changed the license tag from `GPL-3.0-or-later` to `GPL-3.0`, reasoning from GitHub's plain `GPL-3.0` badge. That was backwards: `LICENSE.txt` and the README read "version 3 of the License, or (at your option) any later version", which is precisely **GPL-3.0-or-later (GPLv3+)**. Reverted to `GPL-3.0-or-later`. The separate 404 fix (`/blob/master/LICENSE` → `/blob/master/LICENSE.txt`) was correct and **kept**.
- **Netdata $540 → $54 (CONFIRMED, applied).** netdata.cloud/pricing: Business is "$4.50 /node/month", `= $54/node/year` billed annually; **$540 is the 10-node annual example, not the per-node figure.** The page's "(annual, $540/node/year)" was a 10x overstatement of a competitor's price. Corrected to $54/node/year.
- **Checkmk RBAC/LDAP/SAML tiering (SOURCED, applied).** checkmk.com/product/editions: role management is in **all editions incl. free Community**; **LDAP/AD starts at Pro**; **SAML SSO is Ultimate/Cloud only** (not Pro). The page's bundled "(Pro and above)" both understated free RBAC and overstated Pro (which has no SAML). Re-tiered and cited to the editions page (new fn9).
- **Checkmk "2,000+ integrations" (RE-SOURCED, applied).** The catalog page (checkmk.com/integrations) lists plugins but states no total, so it is NOT a valid source for the round number. checkmk.com/product/checkmk-raw states verbatim "2,000+ built-in integrations": fn8 repointed there (off Wikipedia), and the now-unclaimed "founded 2008" dropped from the footnote.
- **CloudWatch EC2 `.metal` Nitro (CONFIRMED accurate, citation strengthened).** aws.amazon.com/ec2/nitro: bare metal instances "have no hypervisor"; the fn4 blog title is literally "Direct Access to Hardware". Both halves of the claim hold; fn4 now also cites the Nitro System page so a hostile reader finds the "no hypervisor" wording at source.
- **LibreNMS discovery protocols (CONFIRMED verbatim, applied).** librenms.org homepage carries the exact string "CDP, FDP, LLDP, OSPF, BGP, SNMP and ARP"; fn3 now cites the homepage (for the protocol list) plus the Features doc (for vendor breadth).
- **LibreNMS extend scripts (CONFIRMED, applied).** github.com/librenms/librenms-agent confirmed to be the LibreNMS Agent & Scripts repo with an `snmp/` script dir; fn5 now cites the repo (source of the scripts) plus the SNMP-config-examples doc (setup reference).
- **New Relic FedRAMP/HIPAA (CONFIRMED, applied).** newrelic.com/pricing: "FedRAMP Moderate and HIPAA eligibility with Data Plus": gated on **Enterprise + the Data Plus option**, not the standard Original tier. The page's "New Relic Enterprise covers these" was incomplete; corrected to name the Data Plus requirement.

Net effect: **four material competitor-fairness corrections** (Prometheus node_exporter RAID/ECC absence; Checkmk distributed-monitoring framed as paid-only; Netdata price overstated 10x; Checkmk SAML mis-tiered to Pro), the LibreNMS license self-correction, plus a set of citation-precision fixes. No Glassmkr-side overstatement survived (the two found were softened). Remaining HELD items are wording/judgement calls only.

**Sitewide (APPLIED):** every page carried a stale **"Last verified: 2026-05-17"** (VsHead description, visible `.vs-verified` line, footer note, and footnote `(verified ...)` dates). All competitor figures were re-checked today and still hold, so the visible/verified dates were refreshed to **2026-06-25** on all eight pages, and VsHead's `dateModified` default bumped (datePublished kept).

**Glassmkr free-tier descriptor (APPLIED, 3 pages):** /vs/datadog, /vs/cloudwatch, and /vs/newrelic described the Glassmkr free tier as "3 nodes, full/all features", which overstates it (unlimited AI is Pro; retention is 7-day). Softened consistently to "3 nodes, all 62 rules + all channels (7-day history; AI is Pro)".

**License-column precision (APPLIED, 3 pages):** the Glassmkr cell in a license-comparison row read "Agent MIT; dashboard SaaS" on /vs/zabbix, /vs/librenms, and /vs/checkmk. "SaaS" is a delivery model, not a license; normalized to "Agent MIT; dashboard proprietary (SaaS)" on all three for accuracy and cross-page consistency.

---

## datadog: verdict: costbench citation re-pointed; 1 wording item held
| claim | class | primary source (acc. 2026-06-25) | action |
|---|---|---|---|
| Glassmkr free tier "3 nodes, full features" | FACTUAL-ERROR (Glassmkr-side overstatement) | glassmkr.com/pricing: free = all 62 rules + full API + all 6 channels + trends, BUT 7-day history and AI is Pro | **APPLIED**: → "3 nodes, all 62 rules + all channels (7-day history; AI is Pro)" |
| fn4 hidden costs sourced to costbench.com (3rd-party) | UNVERIFIABLE (citation) | the hidden costs (log retention, span ingestion, container scaling $0.002/hr, custom events) are all on datadoghq.com/pricing | **APPLIED**: hidden-costs row re-pointed to Datadog's own pricing (fn1); the costbench footnote removed |
| "Infrastructure is one of ~30 product modules" (×2) | UNVERIFIABLE | datadoghq.com/pricing lists ~11 product categories; no "~30 modules" figure published | **HELD**: soften to "one of many separately-priced product modules" |

FAIR (verified, kept): Pro $15/host annual / $18 on-demand; Enterprise $23/$27; DevSecOps Enterprise on-demand $41; Free "5 hosts, 1-day retention"; custom metrics 100/200; containers 5/10 + $0.002/hr; APM +$31; Logs $0.10/GB + $1.70/M (15-day); Agent Apache-2.0; "5-13x cheaper" math; all pricing-table rows.

## prometheus: verdict: material understatement of the competitor (fixed)
| claim | class | primary source (acc. 2026-06-25) | action |
|---|---|---|---|
| node_exporter "does not include SMART, IPMI, RAID, or ECC collectors out of the box" (3 spots) | **FACTUAL-ERROR** | github.com/prometheus/node_exporter README: `mdadm` (RAID) and `edac` (ECC) are **enabled-by-default** collectors | **APPLIED**: node_exporter ships `mdadm` (RAID) + `edac` (ECC) by default; only SMART and IPMI need separate exporters. Kept the true distinction: no unified opinionated rule set. |
| smartctl_exporter and ipmi_exporter "each Apache 2.0" | FACTUAL-ERROR (license) | github.com/prometheus-community/ipmi_exporter: **MIT** | **APPLIED**: smartctl_exporter Apache-2.0, ipmi_exporter MIT |
| "no bundled UI; assemble Grafana" | UNVERIFIABLE (imprecise) | prometheus.io overview: a built-in expression browser ships | **APPLIED**: "no bundled **dashboarding** UI (a basic expression browser ships; Grafana for dashboards)" |
| "What's the same" lists 4 channels but body lists 6 | FAIR (internal nit) | n/a | **HELD** (optional consistency) |

FAIR: Apache-2.0; pull/PromQL/Alertmanager; 15-day default TSDB retention; Pushgateway SPOF; Grafana Cloud Free/Pro tiers; AWS Managed Prometheus rates.

## netdata: verdict: 10x price overstatement (fixed) + version (fixed) + 1 wording held
| claim | class | primary source (acc. 2026-06-25) | action |
|---|---|---|---|
| Netdata Business "$540/node/year" | **FACTUAL-ERROR (10x, competitor-unfair)** | netdata.cloud/pricing: $4.50/node/mo = **$54/node/yr**; $540 is the 10-node example | **APPLIED**: → "$54/node/year" (confirmed against Netdata's own pricing) |
| "median 108 MB ... on Crucible **0.13.6**" | FACTUAL-ERROR (stale version) | repo `FALLBACK_LATEST = 0.13.11` | **APPLIED**: → Crucible 0.13.11 |
| "process count anomalies, container restart counts" as Netdata defaults | UNVERIFIABLE | no primary doc enumerates these as shipped defaults | **HELD**: soften to "e.g. process/container-level signals" |

FAIR: Agent GPL-3.0-or-later; Community ≤5 nodes; Business $4.50/node/mo; Enterprise on-prem ≥200 licenses; per-second resolution; 800+ collectors; ML default-on, 18 consensus models; SMART/IPMI/RAID/ECC collectors exist; port 19999 local UI.

## checkmk: verdict: 2 factual errors (fixed) + RBAC/SSO re-tiered + citation re-sourced
| claim | class | primary source (acc. 2026-06-25) | action |
|---|---|---|---|
| "Distributed monitoring is a Checkmk Pro/Ultimate feature" (table gates it to paid) | **FACTUAL-ERROR** | docs.checkmk.com distributed_monitoring: basic distributed monitoring (Livestatus) works in all editions incl. free; only the optimized Livestatus proxy is commercial | **APPLIED**: basic distributed monitoring is in all editions; optimized Livestatus proxy is commercial-only |
| Checkmk "founded 2008" (cited to Wikipedia) | FACTUAL-ERROR (unsourced) | no "2008" on any Checkmk primary source | **APPLIED**: dropped the contested year; "Munich-based, Nagios lineage" |
| RBAC/audit/LDAP/SAML "Yes (Pro and above)" | **FACTUAL-ERROR (mis-tiered)** | checkmk.com/product/editions: RBAC all editions; LDAP/AD from Pro; **SAML SSO Ultimate/Cloud only** | **APPLIED**: table + "when Checkmk" prose re-tiered ("RBAC in all editions; LDAP/AD from Pro; SAML SSO Ultimate/Cloud only"), cited to editions page (new fn9) |
| "2000+ plugins" cited to Wikipedia | UNVERIFIABLE (citation) | checkmk.com/product/checkmk-raw: verbatim "2,000+ built-in integrations" | **APPLIED**: fn8 re-pointed Wikipedia → checkmk.com/product/checkmk-raw |

FAIR: editions (Community/Pro/Ultimate/Cloud + multi-tenancy); Community free/GPL/~100 hosts; Pro €190/mo, Ultimate €275/mo (annual); service-based pricing ~30 svc/host; auto-discovery; SMART via `smart` + IPMI via `freeipmi`; six-step install.

## zabbix: verdict: clean (sitewide date + license-cell precision)
| claim | class | primary source (acc. 2026-06-25) | action |
|---|---|---|---|
| License column shows "Agent MIT; dashboard SaaS" | UNVERIFIABLE (imprecise label) | n/a (internal) | **APPLIED**: → "Agent MIT; dashboard proprietary (SaaS)" (and matched on librenms + checkmk) |

FAIR (all Zabbix claims verified): 7.0+ AGPL-3.0 / ≤6.4 GPL-2.0; free/no paid edition; Zabbix LLC est. 2001; Silver €245/mo, Gold from €660/mo; agent + agentless SNMP/IPMI/JMX; proxy buffering; SMART via agent2 (smartmontools 7.1+); IPMI native item type; PHP 8.0-8.5 stack; min 2 cores/8 GiB.

## librenms: verdict: license self-corrected + 404 fixed + citations re-pointed
| claim | class | primary source (acc. 2026-06-25) | action |
|---|---|---|---|
| fn1 license link `/blob/master/LICENSE` | FACTUAL-ERROR (404) | actual file is `LICENSE.txt` | **APPLIED**: → `/blob/master/LICENSE.txt` |
| License tag "GPL-3.0-or-later" | (no error: earlier mis-edit reverted) | LICENSE.txt: "version 3 ... or (at your option) any later version" = GPLv3+ | **REVERTED to GPL-3.0-or-later** (an earlier change to "GPL-3.0" was wrong; it reasoned from GitHub's badge, not the licence text) |
| Discovery protocols (CDP/FDP/LLDP/OSPF/BGP/ARP) cited to fn3 (Features doc) | FAIR claim, mis-sourced | the verbatim list is on librenms.org homepage | **APPLIED**: fn3 now cites the homepage (protocol list) + Features doc (vendor breadth) |
| "originally an Observium fork in October 2013" (fn4) | UNVERIFIABLE (cited source has no date) | docs confirm the fork; the cited page gives no month | **APPLIED**: dropped "October" → "2013" (×3: TL;DR, table, fn4) |
| SMART/IPMI via `librenms-agent` (fn5) | FAIR (citation thin) | scripts live in github.com/librenms/librenms-agent | **APPLIED**: fn5 now cites the librenms-agent repo + the SNMP-examples doc |

FAIR: GPLv3-or-later / fully free / no commercial edition / no SaaS; "LibreNMS" casing; SNMP-first; ~500+ vendor families; traffic billing / BGP-OSPF / distributed polling / alerting; install stack (PHP 8.2+, NGINX/Apache, MariaDB, rrdtool, snmpd, fping, mtr, nmap, py3).

## cloudwatch: verdict: 1 unverified price (fixed) + Nitro citation strengthened
| claim | class | primary source (acc. 2026-06-25) | action |
|---|---|---|---|
| Logs "$0.005/GB scanned" | FACTUAL-ERROR (unverified value) | aws.amazon.com/cloudwatch/pricing: ingest $0.50/GB + storage $0.03/GB confirmed; Logs Insights scan is structured differently, not $0.005/GB | **APPLIED**: dropped the "$0.005" figure → "Logs Insights queries billed per GB scanned"; kept verified ingest/storage rates |
| EC2 `.metal` = "Nitro System ... no hypervisor" (fn4) | FAIR (citation thin) | aws.amazon.com/ec2/nitro: bare metal "have no hypervisor"; fn4 blog title is "Direct Access to Hardware" | **APPLIED**: claim verified accurate; fn4 strengthened to also cite the Nitro System page for the "no hypervisor" wording |

FAIR: custom metrics $0.30/$0.10/$0.05 tiers; alarms $0.10; logs ingest $0.50/storage $0.03; free tier 10 metrics/10 alarms/5 GB; CloudWatch Agent MIT; agent metric set; OTel/X-Ray (v1.300025.0+); SMART/IPMI/RAID/ECC verified absent from the agent metric set.

## newrelic: verdict: 2 fixed + FedRAMP/HIPAA nuance added
| claim | class | primary source (acc. 2026-06-25) | action |
|---|---|---|---|
| Glassmkr "Single tier: $3/node after 3 free" | FACTUAL-ERROR (inconsistent with own site) | glassmkr.com/pricing: Free, Pro AND Enterprise | **APPLIED**: → "Free up to 3 nodes, then $3/node/mo (Enterprise custom)" |
| New Relic free tier "~8-day retention" | FACTUAL-ERROR (understates) | newrelic.com/pricing: "Default data retention of at least 8 days" | **APPLIED**: → "8-day default retention (minimum)" |
| FedRAMP/HIPAA on "New Relic Enterprise" (fn1) | FACTUAL-ERROR (incomplete) | newrelic.com/pricing: "FedRAMP Moderate and HIPAA eligibility with Data Plus": needs Enterprise + Data Plus, not the standard tier | **APPLIED**: → "FedRAMP Moderate and HIPAA eligibility, but only on the Enterprise edition with the Data Plus data option (not the standard Original tier)" |

FAIR: Free 100 GB/mo ingest + 1 full user; overage $0.40/$0.60 per GB; Standard ≤5 users; Pro ~$349/user/yr; Enterprise custom; APM-first; APM agent languages; NRQL; AIOps; 780+ integrations; infra default samples; SMART/IPMI/RAID/ECC not in default metric inventory.

---

## Remaining HELD items (judgement/wording only: no edit applied)

These three are not factual errors; they are optional softenings or internal-consistency nits with no competitor-fairness risk either way. Left for Simon:

1. **datadog**: "~30 product modules" → soften to "one of many separately-priced product modules" (Datadog publishes ~11 categories, not a "30" figure).
2. **netdata**: soften "process count anomalies, container restart counts" → "e.g. process/container-level signals" (no primary doc enumerates them as shipped defaults).
3. **prometheus**: align the "what's the same" 4-channel list with the body's 6 channels (internal consistency).

Everything that touched a competitor number or citation has been verified against that competitor's own page and applied. A hostile reader following the cited primary sources would now find no misrepresentation in the page set. Merge of the `vs-fairness-audit` branch (PR #376) is cleared per Simon's sign-off (LibreNMS reverted, sourcing-only items applied, Netdata price resolved).
