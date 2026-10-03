# Submission checklist: Glassmkr hardware triage in ChatGPT and Claude

Step by step, in order, for listing the anonymous triage MCP server in
OpenAI's plugin directory (shared by ChatGPT and Codex) and Anthropic's
Connectors Directory. Every step names the doc it comes from (keys in
[Sources](#sources); all read 2026-10-03). **UNCERTAIN** marks anything the docs
did not settle.

| Fact | Value |
|---|---|
| MCP server | `https://app.glassmkr.com/api/triage/mcp` (stateless Streamable HTTP, no auth) |
| Tools | `analyze_server_output`, `get_capture_command`, `get_monitoring_setup` (all read-only) |
| OpenAI package | `openai-plugin/` (`plugin.json`, `mcp.json`, `assets/`) |
| Build + validate | `bash integrations/ai-assistants/scripts/build-openai-plugin-zip.sh` |
| Review cases | `REVIEW_TEST_CASES.md` (mirrored in `plugin.json`) |

The MCP server **origin** (`https://app.glassmkr.com`) can never change for this
OpenAI plugin; changing it means a new plugin. A path change needs a new version,
and changing the URL of a published server means contacting support. Any future
authenticated fleet tools must therefore live on `app.glassmkr.com` to stay in
this listing, since a plugin connects only one MCP server. [app-review "Other
changes"; submission "Connect and scan your MCP server", "Update your published
plugin"]

---

## 0. Blockers (both directories)

- [ ] **B1. Deploy the endpoint and the challenge route.** Both
  `https://app.glassmkr.com/api/triage/mcp` and
  `https://app.glassmkr.com/.well-known/openai-apps-challenge` must answer from
  the production deployment before submitting. Reviewers reject a plugin whose
  server they cannot connect to; the server must be public and production, not
  a test endpoint. [app-review "Remote MCP server requirements", "common
  rejection reasons"]
- [ ] **B2. Support URL must resolve and offer support.** The manifest's
  `supportURL` is `https://glassmkr.com/docs/ai-assistants`, which returns 404 on
  the live site today. The page exists on this branch
  (`apps/site/src/routes/docs/ai-assistants/+page.svelte`) and now has a Support
  section (`#support`: `support@glassmkr.com` and the GitHub issues link).
  What is left is deploying the site so the URL resolves. All four
  listing URLs are required for MCP review, must be HTTPS, "must be accessible
  and identify the same publisher as the submission". [submission "Check
  metadata", "Listing metadata"; plugin-guidelines "Support contact details"]
- [ ] **B3. Privacy policy must cover the triage endpoint.** `/privacy` today
  describes the dashboard and agent only, and its "AI processing" paragraph says
  no data goes to third-party AI providers. It says nothing about text that
  arrives through ChatGPT or Claude. Add a section stating: what the endpoint
  receives (the pasted text, sent by the user's AI assistant), that it is
  processed in memory and not stored or logged; what is logged per call (tool
  name, detected formats, byte count, matched rule ids, duration, a hashed
  per-user id when OpenAI sends `openai/subject`) and the IP address used for
  rate limiting, with retention; recipients; and that the conversation itself is
  handled by OpenAI or Anthropic under their own terms. Reasons: guidelines
  require categories, purposes, recipients, retention and controls, and metadata
  such as "timestamps, IP addresses, or query patterns" must be disclosed; an
  undisclosed returned or collected data type is a listed rejection reason.
  [plugin-guidelines "Privacy", "Transparency and user control"; app-review
  "common rejection reasons"]. The policy must match what the code actually logs:
  check the route's log line before publishing the text.
- [ ] **B4. Publisher identity decided** (A1). The manifest uses
  `developerName` and `author.name` "Simon Rybisar", matching the operator named
  on `/terms` and `/privacy`.
- [ ] **B5. Test cases verified** against production (`REVIEW_TEST_CASES.md`,
  every "TO VERIFY" turned into "verified <date>").
- [ ] **B6. Cloudflare rule extended** for the challenge path (section C).
- [ ] **B7. Demo video recorded** (A7).

---

## A. OpenAI plugin directory (ChatGPT and Codex)

### A1. Organization, permissions, identity

- [ ] Pick the organization that will own the plugin. Owners can submit; other
  members need **Apps Management Write** (`api.apps.write`); viewing drafts needs
  `api.apps.read`. [submission "Confirm access and publishing identity";
  app-review "Plugin submission permissions"]
- [ ] Complete **individual** verification (publish under your own name) or
  **business** verification (publish under a business name) at
  `platform.openai.com/settings/organization/general`. "Publishing under an
  unverified individual or business name will result in rejection." [app-review
  "Organization verification"]
- [ ] The directory shows the name of the verified identity you pick at upload,
  "regardless of the name in your ZIP". [submission-errors
  `developer_name_defaulted`; submission "Create the draft"] If you verify under
  a name other than "Simon Rybisar", change `developerName` and `author.name` in
  `plugin.json` to match and rebuild, so the package, the listing URLs and the
  identity all name the same publisher.

### A2. Project with global data residency

- [ ] Submit from a project with **global** data residency. "For now, projects
  with EU data residency cannot submit plugins with MCP servers for review." If
  the org has none, create a new project in the org. [app-review "Start the
  review process"]

### A3. Test in ChatGPT developer mode before submitting

- [ ] ChatGPT: **Settings, Security and login, Developer mode** on.
  Availability "can depend on account and workspace policy". [connect-chatgpt
  "Enable developer mode"]
- [ ] `chatgpt.com/plugins`, plus button, enter name "Glassmkr" and a
  description, **Connection**: MCP server URL
  `https://app.glassmkr.com/api/triage/mcp`, no authentication; create, then
  review the discovered tools and metadata. [connect-chatgpt "Add the MCP
  server"; quickstart]
- [ ] Install it from your personal plugins, switch the homepage tab from
  **Chat** to **Work**, start a Work chat, type `@` and pick the plugin.
  [quickstart "Test the plugin"]
- [ ] Run all eight cases and the three starter prompts from
  `REVIEW_TEST_CASES.md`; record the tool chosen, its arguments, the result and
  errors. Starter prompts must "represent workflows it can complete".
  [connect-chatgpt "Check tool selection", final checklist]
- [ ] Optional raw view: MCP Inspector (`npx @modelcontextprotocol/inspector@latest`)
  or the API Playground (Tools, Add, MCP Server). [connect-chatgpt]
- [ ] Test cases must pass "on the supported ChatGPT and Codex surfaces where the
  plugin will be available". Plugins must work in ChatGPT on desktop and mobile.
  [app-review "common rejection reasons"; plugin-guidelines "Testing"]
  **UNCERTAIN:** whether a developer-mode plugin is usable from the mobile apps;
  if not, repeat on mobile with the approved draft before publishing.

### A4. Build and validate the ZIP

- [ ] `bash integrations/ai-assistants/scripts/build-openai-plugin-zip.sh`
  (writes `integrations/ai-assistants/dist/glassmkr-openai-plugin-<version>.zip`,
  gitignored). It runs `validate-openai-plugin.mjs` first and stops on any
  finding.
- [ ] What the validator checks, transcribed from the docs' field tables: final
  submission limits (display name and subtitle 30, long description 4000,
  developer name 80, package `description` 1024, starter prompts at most 3 x 128
  chars, one line, unique, no `@mention`), the category list, HTTPS listing URLs,
  brand colors at 2:1 contrast (`#FF6B35` measures 2.84:1 on white and 5.68:1 on
  `#212121`), square PNG icons from 48 to 4096 px, `./` asset paths inside the
  package, no screenshots, no `apps` or `hooks`, exactly 5 positive and 3
  negative cases with known tool names, no credentials in the ZIP, one
  `streamable-http` server at the expected URL, no em or en dashes, no pricing,
  plan, trial or node-cap words in listing copy, and that the manifest's review
  prompts match this folder's `REVIEW_TEST_CASES.md`. Its own known-bad tests:
  `node integrations/ai-assistants/scripts/validate-openai-plugin.test.mjs`.
  [submission "Manifest fields"; submission-errors]
- [ ] **Could not confirm:** the published JSON Schemas at
  `agent-plugins.org/schemas/1.0.0/plugin.schema.json` and `mcp.schema.json`
  were not fetched; the package was checked by hand and by the validator against
  the documented fields only. The portal's upload validation is the real
  authority; fix whatever it reports.
- Layout used: portable Agent Plugins format, root `plugin.json` with
  OpenAI settings under `extensions.com.openai`, root `mcp.json`, `assets/`.
  No `.codex-plugin/` overlay (ignored when `extensions.com.openai` exists), no
  skills (optional; an MCP server cannot be added later to a skills-only plugin,
  but skills can be added to this one), no `.app.json` or hooks (not submittable).
  [build-plugins "Plugin structure", "Add OpenAI-specific metadata"; submission
  "Create the draft", "Automatically provide submission and review information"]

### A5. Upload the draft

- [ ] `platform.openai.com/plugins`, **Upload new or existing plugin**, choose the
  verified **Developer identity**, **Upload plugin**, pick the ZIP. The plugin
  detail page opens with the draft. [submission "Create the draft"]
  **UNCERTAIN:** the Claude-migration guide words this as **Create plugin**,
  then **With MCP**; follow whichever the portal shows. [submit-claude-plugin]
- [ ] **Metadata & Skills**: wait for checks, read **Issues**, **Copy issues**,
  fix the package, **Upload plugin to fix issues**. [submission "Check metadata"]

### A6. Connect the MCP server, verify the domain, scan tools

- [ ] **MCPs**, select `glassmkr-triage`, **Connect**. Check the URL and set
  **Authentication** to none. **UNCERTAIN:** the exact label of the no-auth
  option; the package cannot declare auth, it is chosen here. [submission
  "Connect and scan your MCP server"]
- [ ] **Domain verification.** The portal shows a token and the URL
  `https://<challenge-base-host>/.well-known/openai-apps-challenge`. The base must
  be an HTTPS origin on the MCP hostname or an eligible parent; return only the
  exact token as plain text, not JSON. [submission "Domain verification details";
  submission-errors `domain_verification_required`]
  1. Use `app.glassmkr.com` as the base (the MCP host; the route lives in the
     dashboard).
  2. Do section C first so Cloudflare does not challenge the verifier.
  3. On the services host add `OPENAI_APPS_CHALLENGE=<token>` to
     `/etc/glassmkr/dashboard.env` (the file `scripts/deploy.sh` sources) and
     restart `glassmkr-dashboard`. Production change: yours to make.
     **UNCERTAIN:** the systemd unit is not in this repo; confirm it loads that
     file (`systemctl cat glassmkr-dashboard`, look for `EnvironmentFile`). The
     route reads `process.env.OPENAI_APPS_CHALLENGE` at request time and returns
     404 while it is unset.
  4. Check: `curl -s https://app.glassmkr.com/.well-known/openai-apps-challenge`
     prints exactly the token; `curl -sI` on the same URL shows
     `content-type: text/plain` and `cache-control: no-store`; and
     `curl -s -o /dev/null -w '%{http_code}\n' -A 'Python-urllib/3.11' <same URL>`
     prints 200, not 403.
  5. Press **Verify Domain** in the portal.
- [ ] **Scan Tools** and wait. The scan imports tool names, titles,
  descriptions, input and output schemas, security schemes, `_meta`,
  annotations and the server `instructions` into the draft. Annotations shown
  are the server's; justifications do not override them. [app-review "Start the
  review process", "Metadata stored during tool scanning"]
- [ ] Expect 3 tools, each with `readOnlyHint: true`, `destructiveHint: false`,
  `openWorldHint: false`. Fix any finding on the server, deploy, **Rescan**.
  [submission "Find and resolve tool issues"]
- [ ] **Annotation justifications.** The guidelines say "Annotation
  justifications are no longer required", but the submission error reference
  still lists `justification_required` ("a justification for each value on
  every MCP tool"). Have them ready; paste from [D2](#d2-annotation-justifications).
  [plugin-guidelines "Correct annotation"; submission-errors "MCP and review errors"]

### A7. Review information

- [ ] **Imported from the ZIP (read-only in the portal):** 5 positive and 3
  negative test cases, `commerce: false`, release notes, countries. To change
  them, edit the package and upload again. [submission "Complete review
  information", "Configure onboarding, review, and publication"]
- [ ] **Demo video URL** (required for MCP review): enter it in **Review
  information, Review details**. It is deliberately not in the ZIP so it stays
  editable there. It must be reviewer-accessible, "demonstrate the test cases and
  plugin functionality", and show "the main use cases and tools across supported
  platforms". Suggested recording (3 to 4 minutes, ChatGPT web, then mobile if
  possible): P1, P2, P3 pastes with results; P4 capture commands; P5 setup; N1
  showing no tool call. Upload as an unlisted video that opens without sign-in.
  [submission "Complete review information"; submission-errors "Final directory
  submission"]
- [ ] **Reviewer credentials:** none; the server is anonymous. Credentials are only
  required "if sign-in is required". Never put credentials or reviewer
  instructions in the ZIP (`test_credentials` and `reviewer_instructions` are
  rejected). [submission "Complete review information", field notes]
- [ ] **Screenshots: none.** Allowed only when the scan reports a UI output
  template; "Don't provide screenshots when the plugin has no UI." Screenshots are
  also no longer shown in the directory. [submission-errors
  `screenshots_not_allowed`; app-review "Start the review process";
  plugin-guidelines "Plugin name, description, and prompts"]
- [ ] **Countries:** the package sets `publication.countries: []`, which "removes
  country restrictions". "Only submit the plugin if you intend for it to be
  publicly available in the countries you define." To restrict, list uppercase
  codes such as `["US", "GB"]` and rebuild. [submission field table; app-review
  intro] **UNCERTAIN:** whether consumer accounts in the EEA, UK and Switzerland
  can install plugins at all; that is OpenAI's gating, not this setting.
- [ ] Translations: none supplied (optional). [submission "Translate listing text"]

### A8. Submit

- [ ] Select the draft, **Submit for review**, complete the policy attestations.
  Track **Review status**; feedback arrives by email. [submission "Submit the
  draft"]
- [ ] Only one review can be active per plugin. To change something under
  review, **Cancel Review**, fix, resubmit. Rejection: fix and resubmit, or
  appeal by replying to the rejection email. [submission "Submit the draft";
  app-review "Approval, rejection, and appeals"]
- [ ] Do not ask support to expedite: "these requests cannot be accommodated".
  [app-review FAQ]

### A9. How long it takes

- OpenAI publishes no estimate. [app-review FAQ]
- Crowdsourced only, not OpenAI: the reviewtimes.fyi ChatGPT tracker (n=15, as of
  2026-09-29) showed a median of about 11 days to approval and 3 days to
  rejection; forum threads report 6 weeks or more. With one active review at a
  time, budget for at least one rejection cycle.

### A10. Publish and after

- [ ] After approval, open the approved version and **Publish plugin**; you pick
  the timing. [submission "Publish your approved plugin"]
- [ ] **Before any press release or public announcement** (a LinkedIn or HN
  launch post counts), email `press@openai.com`. [app-review "Publication and
  Distribution FAQs"]
- [ ] Confirm it is live by searching the directory for the exact name, or open
  its directory URL from the portal. Users find a new plugin by direct link or
  name search; directory placement and proactive suggestions are chosen by
  OpenAI and "Developers cannot request enhanced distribution". [app-review
  "Discovery", FAQs]
- After publication OpenAI scans the server daily. Changed tools keep their old
  definition until the update passes automated checks; new tools stay
  unavailable until approved; removals apply at once. Keep the server compatible
  with the approved schemas, and use **Rescan** after a deploy.
  [submission "Update to your MCP server"; app-review "Continuous review and tool
  updates"]
- Metadata, icon or listing changes need a new ZIP with a bumped `version` and a
  new review. [submission "Update your published plugin"; submission-errors
  `plugin_version_unchanged`]

---

## B. Anthropic Connectors Directory (Claude)

### B1. Who can submit

- [ ] A claude.ai account on Pro, Max, Team or Enterprise (Free cannot submit).
  On Team and Enterprise, an Owner, or a member with the **Directory**
  permission. The listing belongs to the organization you submit from.
  [publish "Confirm you can submit to the directory"]

### B2. Pre-submission checks

- [ ] Remote server over HTTPS. [connectors-submission checklist]
- [ ] Authentication "none" (authless) is "Supported by default".
  [connectors-auth "Supported authentication types"]
- [ ] Every tool has a `title` and a `readOnlyHint` or `destructiveHint`; the
  portal flags tools missing them. The spec sets titles and all hints on all three
  tools; confirm after deploy. [connectors-submission "Requirements for every
  connector"]
- [ ] Tested as a custom connector in Claude, every tool called from a
  conversation; the **Test & launch** step asks you to confirm this.
  claude.ai: **Settings, Connectors, Add custom connector**, paste the URL, leave
  the OAuth fields empty (**UNCERTAIN:** menu labels as of writing). Claude Code:
  `claude mcp add --transport http glassmkr-triage https://app.glassmkr.com/api/triage/mcp`.
  [connectors-submission checklist]
- [ ] Listing materials: documentation URL, privacy policy URL, support contact,
  icon. [connectors-submission checklist] Use `openai-plugin/assets/logo.png`
  (512 x 512 PNG). **UNCERTAIN:** Anthropic's icon size and format rules were not
  in the docs read.
- [ ] Directory terms: Anthropic Software Directory Terms and Software Directory
  Policy (support.claude.com articles 13145338 and 13145358). [connectors-submission
  "Directory terms"]

### B3. Portal steps

`claude.ai/directory/manage`, **Submit new**, **MCP connector**. Progress saves in
the browser. [publish "Start a submission"; connectors-submission "Submit through
the developer portal"]

- [ ] **Connection:** `https://app.glassmkr.com/api/triage/mcp`; users connect to
  one URL (do not pick "Users connect to different URLs").
- [ ] **Tools:** synced from the server; all three should be grouped as read-only.
  Fix any missing title or annotation on the server first.
- [ ] **Listing:** name (100 max), one-liner (200 max), description (2,000 max),
  1 to 5 categories, documentation URL, privacy policy URL, support contact,
  icon, URL slug. **The slug is permanent once published.** Paste from
  [D3](#d3-claude-listing-copy).
- [ ] **Use cases:** primary use cases; prerequisites: none (no account, no
  install); reads or writes: reads only the text the user passes, writes nothing.
- [ ] **Company:** name, website `https://glassmkr.com`, primary contact for
  review updates.
- [ ] **Authentication:** no authentication.
- [ ] **Data handling:** the API is your own (not proxied, not third party); no
  personal health data; no sponsored content.
- [ ] **Test & launch:** reviewer instructions (paste from D3); confirm you ran
  every tool via MCP Inspector or as a custom connector.
- [ ] **Compliance:** seven acknowledgments, all required.
- [ ] **Review and submit:** quality warnings (such as very short answers) are
  shown here and shared with the review team.

### B4. After submitting

- Submissions are scanned automatically and by default listed as a **Community**
  connector "with no action from you"; some also get a person's review, with
  queue-dependent timing. Anthropic decides the **Verified** label and placement;
  there is no application for either. Status and feedback appear in the portal.
  Escalations: `mcp-review@anthropic.com`. [connectors-submission "After you
  submit"; publish "Prepare for review"]
- Optional later: a **plugin bundle** (a public GitHub repository folder) that
  references the same server URL, paired with this connector listing. Not needed
  for v1. [publish "Submit your plugin, and your MCP server as a connector"]

---

## C. Cloudflare: the challenge path is not covered by the API rule

- The Configuration Rule that turns **Browser Integrity Check** off matches
  `(http.host eq "app.glassmkr.com" and starts_with(http.request.uri.path, "/api/"))`.
  The MCP endpoint (`/api/triage/mcp`) is inside it, so OpenAI's and Anthropic's
  server-side calls are not blocked with error 1010.
- `/.well-known/openai-apps-challenge` is **not** under `/api/`, so Browser
  Integrity Check still applies there and can answer a non-browser client with
  Cloudflare's 403 instead of reaching the app. The user agent of OpenAI's domain
  verifier is not documented
  (**UNCERTAIN** whether it would be challenged); the OpenAI bots page lists
  ChatGPT-User and the crawlers, not the verifier. [bots]
- [ ] Before **Verify Domain**, change the rule's expression to:

  ```
  (http.host eq "app.glassmkr.com" and (starts_with(http.request.uri.path, "/api/") or http.request.uri.path eq "/.well-known/openai-apps-challenge"))
  ```

  In the rule builder, click **Edit expression** so the Field / Operator / Value
  row collapses into one raw text box, paste the expression, and check that the
  Expression Preview equals it exactly; otherwise the builder wraps it as a
  `full_uri wildcard` match that matches nothing.
- [ ] Re-run the step A6.4 `curl` checks: 200 (or the app's 404 while the env var
  is unset), never Cloudflare's 403.
- Exposure is one exact path that serves a public token; BIC stays on for the
  dashboard UI and the marketing site.
- **UNCERTAIN:** if Bot Fight Mode is enabled on the zone it applies domain-wide;
  check it if the verifier still fails after the rule change.

---

## D. Paste-ready copy

### D1. OpenAI listing (already in `plugin.json`)

| Field | Value |
|---|---|
| displayName | Glassmkr |
| shortDescription | Server hardware fault triage |
| developerName | Simon Rybisar (overridden by the verified identity) |
| category | Developer Tools |
| websiteURL | https://glassmkr.com |
| supportURL | https://glassmkr.com/docs/ai-assistants (see B2) |
| privacyPolicyURL | https://glassmkr.com/privacy |
| termsOfServiceURL | https://glassmkr.com/terms |
| starter prompts | see `REVIEW_TEST_CASES.md`, "Starter prompts" |
| brandColor / brandColorDark | #FF6B35 / #FF6B35 |
| icons | `assets/logo.png` 512 x 512, `assets/icon.png` 128 x 128, rendered from `apps/site/static/favicon.svg` |

Alternative display name: "Glassmkr Hardware Triage" (24 chars) puts two search
terms in the name, but the listing will carry fleet tools later; the subtitle and
keywords already carry "hardware" and "triage". Directory search matches name,
subtitle, description and keywords. Copy rules applied: no pricing,
subscriptions, trials or promotions; no comparisons or unverifiable claims; no
"MCP" or "Plugin" suffix. [plugin-guidelines "Plugin name, description, and
prompts"; optimize-metadata]

### D2. Annotation justifications

Same three values on all three tools. Paste per tool and per hint.

| Tool | readOnlyHint: true | destructiveHint: false | openWorldHint: false |
|---|---|---|---|
| analyze_server_output | Parses the text passed in the call and evaluates it in memory against Glassmkr's alert rules, then returns the result. It creates, changes, sends and deletes nothing, and runs no commands on any server. The pasted text is not stored. | The tool has no write path in any mode: it cannot delete, overwrite, revoke or send anything. | It reads only the text in the request and the rule set bundled with the server. It makes no outbound requests and does not reach the public internet or any third-party service. |
| get_capture_command | Returns fixed command text for the requested goal and Linux distribution. It does not run the commands; the user decides whether to run them on their own server. | No write path; it returns text only. | Returns built-in text; no outbound requests. |
| get_monitoring_setup | Returns install, enrollment and verification steps as text. It does not create accounts, enroll servers or issue keys, and never asks for a key; every step is performed by the user. | No write path; it returns text only. | Returns built-in text and documentation links; it does not fetch them or contact any other service. |

The justifications leave out server-side request logging on purpose: it is the
same for all three tools, and app-review lists "write logs" among the actions
that make readOnlyHint false, so naming it here invites a misreading. The
per-call log line is disclosed in the privacy policy instead (B3).

### D3. Claude listing copy

- **Name:** Glassmkr
- **One-liner (161 chars):** Paste smartctl, zpool status, mdadm, dmesg, ipmitool SEL or nvidia-smi output and get a verdict from Glassmkr's open-source hardware alert rules, with fix steps.
- **Description (1,980 chars, under 2,000):** the `longDescription` from
  `openai-plugin/plugin.json`, unchanged.
- **Categories:** pick from the portal's list (developer tools or IT
  infrastructure if offered). **UNCERTAIN:** the category list is not in the
  docs read.
- **Documentation URL:** https://glassmkr.com/docs/ai-assistants
- **Privacy policy URL:** https://glassmkr.com/privacy
- **Support contact:** support@glassmkr.com
- **Slug:** `glassmkr` (permanent)
- **Use cases:** (1) check whether pasted smartctl, ZFS, mdadm, kernel log, IPMI
  SEL or nvidia-smi output shows a hardware fault; (2) get the exact commands to
  capture that output; (3) get the steps to run the open-source agent for
  continuous monitoring.
- **Test & launch instructions:** "No account or credentials are needed; the
  server is authless. Add https://app.glassmkr.com/api/triage/mcp as a custom
  connector, then paste each prompt from cases P1 to P5 in
  https://github.com/glassmkr/glassmkr/blob/main/integrations/ai-assistants/REVIEW_TEST_CASES.md
  and compare with the expected behavior listed there." (**UNCERTAIN:** that link
  works only once this folder is merged to `main` in the public repo; otherwise
  paste the P1 to P3 prompts inline.)

### D4. Release notes (in `plugin.json`)

Initial release: analyze pasted smartctl, zpool status, /proc/mdstat and mdadm
--detail, kernel log, ipmitool SEL and nvidia-smi output with Glassmkr's alert
rules; capture commands for each goal; monitoring setup steps for the Crucible
agent.

---

## Sources

All read on 2026-10-03 as Markdown copies.

| Key | Page |
|---|---|
| submission | https://developers.openai.com/plugins/deploy/submission |
| submission-errors | https://developers.openai.com/plugins/deploy/submission-errors |
| app-review | https://developers.openai.com/plugins/deploy/app-review |
| plugin-guidelines | https://developers.openai.com/plugins/plugin-guidelines |
| build-plugins | https://developers.openai.com/plugins/build/plugins |
| connect-chatgpt | https://developers.openai.com/plugins/deploy/connect-chatgpt |
| quickstart | https://developers.openai.com/plugins/quickstart |
| optimize-metadata | https://developers.openai.com/plugins/guides/optimize-metadata |
| submit-claude-plugin | https://developers.openai.com/plugins/guides/submit-claude-plugin |
| bots | https://developers.openai.com/api/docs/bots |
| publish | https://claude.com/docs/directory/publish |
| connectors-submission | https://claude.com/docs/connectors/building/submission |
| connectors-auth | https://claude.com/docs/connectors/building/authentication |

Non-doc evidence: review-time figures from the reviewtimes.fyi ChatGPT tracker
(crowdsourced); the Cloudflare rule expression from the 2026-06-27 BIC fix.
