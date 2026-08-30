# Glassmkr Redesign and OSS Launch Specification

> **SUPERSEDED on 2026-08-30. Historical design input, not current product
> truth.** The Axiom-led execution brief replaced this document as the visual
> authority, and the license model described below is retired: Crucible is
> AGPL-3.0-only from v1.1.0 (v1.0.1 and earlier remain MIT).

**Status:** Superseded (was: Final decision spec)  
**Date:** 2026-08-23  
**Audience:** Claude Code and maintainers implementing the OSS pivot  
**Purpose:** Merge the prior redesign brief and Claude's direction into one implementation-ready specification, with all material divergences resolved.

## 1. Final decisions

These decisions are locked for the launch redesign unless Simon explicitly changes them.

1. **Re-architecture, not demolition.** Keep the existing near-black ground, amber brand equity, wordmark unless a concrete legibility problem is found, and the established chart house style. Replace the page rhythm, typography system, generic card layouts, repetitive copy cadence, and SaaS-first positioning.
2. **Position Glassmkr as an open-source product first.** Crucible is MIT. The dashboard and backend are AGPL. The hosted service is a convenient managed deployment of the same open-source product, not the product itself.
3. **Use evidence exhibits as the signature design element.** Major claims are anchored by genuine validation-fleet evidence with visible provenance.
4. **Use an editorial serif, but narrowly.** Source Serif 4 is approved for the blog and field-note surfaces. It is not used in the dashboard, documentation UI, navigation, buttons, tables, or normal marketing body copy.
5. **Use open fonts only.** IBM Plex Sans is the interface and body sans. Commit Mono is the technical mono. Source Serif 4 is the editorial face. All are self-hosted. Berkeley Mono and other proprietary fonts are rejected because font redistribution should not complicate an AGPL self-hosting project.
6. **Lead the hero with the Compose self-hosting quickstart.** The block must be byte-identical to the canonical quickstart in `SELF_HOSTING.md` or its actual source-of-truth successor. Do not type or maintain a second copy by hand.
7. **Dashboard scope at launch is token alignment only.** Apply the shared fonts, colors, borders, radii, focus states, chart palette, and semantic status treatment. Do not couple the OSS launch to a full dashboard information architecture rebuild.
8. **The full utilitarian dashboard redesign is a named post-launch phase.** Preserve its target direction in this document, but do not make it a launch dependency.
9. **Launch in dark mode only.** A second theme adds scope without improving the OSS launch story. Light mode can be considered later.
10. **Keep existing public URLs stable.** Redesign routes in place. Do not rename or remove indexed URLs merely to make the new navigation cleaner.
11. **No invented product data anywhere.** Versions, rule counts, node caps, commands, alert values, locations, hardware identities, and terminal output come from machine-readable sources or genuine captures.
12. **Primary hero action:** `View on GitHub`. Secondary action: `Self-host Glassmkr`. A quiet text link may offer `Use hosted`.
13. **Primary navigation:** `Docs`, `Blog`, `Trust`, `Pricing`, `GitHub`. Right side: `Log in` and `Self-host`. Do not add a launch-day mega menu.

## 2. Positioning

Glassmkr is open-source monitoring for bare-metal infrastructure.

The site must communicate this hierarchy within the first screen:

1. Glassmkr monitors physical-server failure modes.
2. The complete stack can be self-hosted.
3. Crucible is MIT and the dashboard/backend are AGPL.
4. Glassmkr also operates a hosted version for users who do not want to run the stack.

The old mental model must disappear:

> SaaS monitoring product with an open-source agent

The new mental model is:

> Open-source bare-metal monitoring with an optional hosted service

Do not let hosted signup, pricing, AI, MCP, or generic feature marketing outrank this message.

## 3. Scope

### 3.1 Launch-gating scope

The following surfaces must use the approved system before the OSS flip:

- Global navigation and footer
- Homepage
- `/docs/self-hosting`
- Agent installation pages and relevant getting-started pages
- `/pricing`
- `/trust`
- Blog article template and blog index shell
- GitHub organization assets and launch-facing repository README files
- One architecture diagram in the house style
- Social preview and OG card templates
- Shared tokens applied to the dashboard
- Launch checklist, runbook ledger, and screenshot ledger updates

### 3.2 Post-launch scope

These surfaces may trail after launch, provided their current content remains accurate and functional:

- `/vs/*` comparison pages
- `/for-*` use-case pages
- Rules catalog visual redesign, if its generated template cannot be safely migrated before launch
- `/vs/collectd` and migration material that depends on the parity matrix
- Full dashboard information architecture and workflow rebuild
- A light theme
- Broad icon or logo exploration

### 3.3 Explicit non-goals

Do not include any of the following in the launch redesign:

- Re-platforming the application or marketing stack
- Rewriting working backend behavior
- Changing routes solely for design preference
- Reauthoring every existing blog post
- A new logo project without a demonstrated need
- New AI features
- A general-purpose component library unrelated to the launch surfaces
- WebGL, 3D scenes, decorative animation systems, or a heavy motion framework
- A full dashboard rebuild

## 4. Priority order when sources conflict

Use this priority order:

1. Canonical product configuration, release manifests, package metadata, generated catalogs, and license files
2. `CC_OSS_PIVOT_SITE`, `SELF_HOSTING.md`, `LAUNCH_CHECKLIST`, and the active OSS runbook
3. This design specification
4. Existing public-site copy and old screenshots

This specification supersedes any older instruction that says the current design system is locked. It does not supersede product facts already locked in the OSS runbook.

When a required value is unknown, do not guess. Bind the component to a required source value and fail the build or leave the surface visibly blocked until that value exists.

## 5. What to preserve

The existing identity is not discarded. Preserve:

- Near-black background
- Warm amber brand accent
- Existing chart visual language, unless contrast or legibility fails
- Technical specificity and willingness to show real commands
- Current wordmark, unless the prototype exposes a concrete problem
- Existing URL structure
- Existing blog chart assets and their visual continuity
- The product's restrained, operator-oriented personality

The redesign changes how those ingredients are organized and expressed.

## 6. Design principles

### 6.1 Evidence before claims

Show the alert, metric, rule, command, architecture, or configuration instead of drawing an abstract illustration of it.

Prefer:

- Actual SMART attributes
- Actual IPMI sensor readings
- Actual ECC events
- Actual RAID or ZFS state
- Actual interface counters
- Actual alert evidence
- Exact remediation commands from the rule catalog
- Exact Compose configuration from the canonical self-hosting guide
- Real hardware models from the validation fleet
- Real version metadata

Avoid decorative representations of monitoring.

### 6.2 Quiet density

The site should feel information-rich without feeling crowded. Density is produced by useful data, tables, code, labels, and structure, not by squeezing generic feature cards together.

Marketing pages may have more air than the product, but never use giant empty sections to imply premium design.

### 6.3 Product and documentation are the brand

The homepage, docs, repository README, and dashboard should look like parts of one system. Documentation is not a secondary template and GitHub is not an outbound afterthought.

### 6.4 One idea once

State each core value proposition once on the homepage. Link to detail instead of repeating the same promise in new words.

In particular, do not repeat:

- Pricing or hosted limits
- Open-source licensing
- No telemetry lock-in
- Data handling
- Installation speed
- AI privacy
- No inbound ports

### 6.5 Technical, not terminal cosplay

Monospace, code blocks, tables, and terminal output must have a semantic reason. Do not use random ASCII, fake terminal chrome, or code-like labels as decoration.

## 7. Signature system: evidence exhibits

### 7.1 Definition

An evidence exhibit is a genuine product surface, terminal capture, chart, alert, or configuration artifact presented inside a quiet hairline frame with a visible provenance line.

Every major homepage section and every major launch marketing page should be anchored by one strong exhibit. Do not fill pages with many small exhibits. One decisive piece of evidence is better than a collage.

### 7.2 Allowed exhibit forms

Only two forms are allowed:

1. **Browser or terminal capture:** A genuine capture from the validation fleet or hosted validation instance.
2. **Recorded-data render:** The actual production component rendered from immutable data captured from the validation fleet.

A recorded-data render is allowed because it preserves responsive HTML, accessibility, and product fidelity. It must use captured source data without changing values, ordering evidence to imply a different conclusion, or inventing missing fields.

### 7.3 Provenance line

Each exhibit includes a visible mono provenance line, for example:

```text
captured <UTC date> · host <public-safe validation hostname> · Crucible <release version> · scenario <scenario id>
```

Use actual values at capture time. Do not ship placeholders.

The provenance line is real HTML text inside `<figcaption>`, never baked into the image.

### 7.4 Capture manifest

Every exhibit must have a machine-readable manifest entry with at least:

```yaml
id: <stable-capture-id>
captured_at: <ISO-8601 UTC timestamp>
host_alias: <public-safe validation hostname>
scenario_id: <validation scenario id>
crucible_version: <released version>
dashboard_commit: <git commit>
source_environment: <validation fleet or hosted validation>
viewport: <width>x<height>
artifact_path: <path>
source_data_path: <path or null>
sha256: <artifact hash>
notes: <optional factual note>
```

CI must verify that the artifact exists, the manifest is complete, and the recorded hash matches.

### 7.5 Capture safety

Use dedicated public-safe validation hosts. Configure safe hostnames before capture.

Never expose:

- Customer data
- Real customer hostnames
- Public or private IP addresses unless deliberately approved
- MAC addresses
- Serial numbers
- API keys
- Internal URLs
- Personal usernames
- Unreviewed journal contents

If sensitive data appears, fix the validation environment and recapture. Do not blur or paint over the image as the normal process.

### 7.6 Capture integrity

Allowed post-processing:

- Format conversion
- Compression
- Resizing that preserves legibility
- Cropping that does not remove relevant context

Not allowed:

- Retyping values
- Moving UI elements
- Combining multiple captures into a fake state
- Recoloring individual metrics
- Changing timestamps
- Adding alerts that did not fire
- Inventing successful terminal output
- Altering evidence to make the product look cleaner

### 7.7 Exhibit component anatomy

Create one shared `EvidenceExhibit` component or equivalent with:

- `<figure>` wrapper
- Hairline frame
- Optional factual title
- Artifact or actual product render
- Plain-language caption
- Provenance line
- Optional `View full evidence` action
- Correct alt text or an accessible text equivalent

Variants may include `product`, `terminal`, `chart`, `architecture`, and `table`, but they must share the same framing and provenance treatment.

## 8. Product facts and source-of-truth machinery

The redesign must solve content drift, not just restyle it.

### 8.1 Generated product facts

Create or extend one generated machine-readable product facts artifact. Adapt the path to the actual repository structure. A representative shape is:

```json
{
  "crucibleVersion": "<generated>",
  "ruleCount": "<generated>",
  "hostedNodeCap": "<configured>",
  "crucibleLicense": "MIT",
  "dashboardLicense": "<generated>",
  "notificationChannels": "<generated>",
  "selfHostingGuidePath": "<canonical path>",
  "releaseDate": "<generated>"
}
```

Do not fetch these values in the browser.

Do not make normal production builds depend on a live npm response. Prefer a release pipeline that generates or verifies a committed release manifest from canonical package metadata. CI should fail when the displayed release and the released package diverge.

### 8.2 Facts that must never be hand-maintained in templates

- Crucible version
- Alert rule count
- Hosted node cap
- Notification channel count
- License labels
- Release date
- Compose command
- Binary install command
- Data-retention values
- Hosting or processing locations
- Model identity
- Hardware identity in exhibits

### 8.3 README and Markdown generation

README files cannot import runtime data. Use generator-owned marker blocks for dynamic facts and quickstarts. The same generator should update any Markdown twins and launch-facing documentation copies.

Do not edit generated blocks by hand.

### 8.4 Stale-copy checks

Add a launch-specific check for retired commercial copy and old product facts across active product surfaces. It should catch stale strings such as old per-node prices, old free-node language, old licensing descriptions, or old version labels.

Historical blog posts may retain historically accurate statements. Exclude them deliberately rather than weakening the check globally.

### 8.5 Location and infrastructure claims

No hosting, jurisdiction, model, or infrastructure-location statement may appear unless it is verified by the active trust source and approved for public use.

If the fact is not locked, omit it.

## 9. Design system

### 9.1 Shared token source

Use one canonical token source for marketing, docs, and dashboard. If these live in separate packages or repositories, generate platform-specific outputs from one reviewed token file.

Do not maintain three near-identical token sets.

### 9.2 Starting color tokens

Use these as the approved starting system. Small tuning is allowed during the homepage taste gate, but semantic roles must not change.

```css
:root {
  --g-bg: #0a0a09;
  --g-surface-1: #10110f;
  --g-surface-2: #151612;

  --g-text: #f2f0e9;
  --g-text-muted: #a8a49a;
  --g-text-subtle: #77746c;

  --g-border: rgba(242, 240, 233, 0.12);
  --g-border-strong: rgba(242, 240, 233, 0.22);

  --g-brand: #e1843b;
  --g-brand-hover: #f19a54;

  --g-healthy: #69c28e;
  --g-warning: #e2b94b;
  --g-critical: #e36b6b;
  --g-info: #7ea3d8;

  --g-focus: #f2f0e9;

  --g-radius-1: 2px;
  --g-radius-2: 4px;
}
```

The brand orange and warning yellow must remain visibly distinct. Green, warning yellow, red, and blue are reserved for system semantics. Never use them as decoration.

### 9.3 Contrast

The starting primary, muted, brand, and semantic colors have adequate contrast on the base background for normal text. Still verify final combinations after any tuning.

Muted text must pass WCAG AA at its rendered size. Do not reduce opacity until it becomes decorative grey noise.

### 9.4 Typography

#### IBM Plex Sans

Use for:

- Navigation
- Buttons
- Marketing body copy
- Documentation body and navigation
- Dashboard UI
- Forms
- Short explanatory text

#### Commit Mono

Use for:

- Code and commands
- Metrics
- Timestamps
- Provenance
- Hostnames
- Versions
- Rule IDs
- Hardware identifiers
- Technical labels
- Table cells that represent machine data

Do not use mono for ordinary body paragraphs or every heading.

#### Source Serif 4

Use only for:

- Blog article titles
- Blog dek or standfirst
- Long-form article body copy
- Long-form article section headings
- Optional field-note post titles on the homepage

Do not use it in the product, docs UI, navigation, buttons, pricing, or general homepage headlines.

### 9.5 Font delivery

- Self-host official WOFF2 files.
- Include the relevant font license files and attribution notices in the repository.
- Do not load fonts from Google Fonts or another third-party CDN.
- Load Source Serif 4 only on routes that need it.
- Preload no more than the essential sans and mono files on the homepage.
- Prefer official variable files or a minimal set of official cuts. Do not create modified subsets without reviewing the font license and reserved-name requirements.

### 9.6 Type scale

Use a restrained scale. Starting values:

- Marketing H1: 56 to 64px desktop, 38 to 44px mobile
- Marketing H2: 34 to 42px desktop, 28 to 34px mobile
- Marketing body: 17 to 18px, line-height 1.55 to 1.65
- Documentation body: 16 to 17px, line-height 1.6
- Product UI: 13 to 15px depending on density
- Technical metadata and provenance: 12 to 13px
- Minimum rendered text size: 12px

Do not use 90px or larger display type merely to create impact.

### 9.7 Layout

- Maximum marketing content width: approximately 1280px
- Long-form reading width: 680 to 760px
- Desktop grid: 12 columns
- Standard page gutters: 24px mobile, 32 to 48px desktop
- Standard section spacing: 64px mobile, 80 to 104px desktop
- Paragraph line length: approximately 55 to 72 characters
- Use section rules and grid lines to create structure
- Use full-width exhibits selectively, not on every section

### 9.8 Corners, borders, and shadows

- Radius: 2px or 4px
- Primary structural device: 1px hairline borders
- No decorative drop shadows on dark surfaces
- Avoid floating panels
- Buttons are rectangular or lightly rounded, never oversized pills

### 9.9 Motion

Motion is limited to:

- Real state transitions
- Terminal command completion when driven by a genuine sequence
- Metric updates
- Alert state changes
- Expansion or disclosure controlled by the user

Do not use:

- Scroll-triggered reveals
- Typewriter hero text
- Parallax
- Floating elements
- Mouse-following effects
- Spinning gradients
- Decorative loading loops

Respect `prefers-reduced-motion`. The page must remain complete with animation disabled.

## 10. Shared component set

Build the smallest component set that can express the system consistently:

- `PageShell`
- `SiteHeader`
- `SiteFooter`
- `Section`
- `EvidenceExhibit`
- `ProvenanceLine`
- `CodeBlock`
- `TechnicalTable`
- `FactTable`
- `StatusLabel`
- `ArchitectureDiagram`
- `AlertEvidence`
- `MetricValue`
- `InlineCallout`
- `ArticleLayout`

Names may change to match the codebase. Do not build generic components without a concrete launch use.

A panel is acceptable when it represents a real product boundary, alert, terminal, configuration, or table. A generic icon-title-paragraph card is not.

## 11. Copy system

Copy is design material and receives the same review priority as typography and layout.

### 11.1 Voice

The voice is:

- Factual
- Direct
- Operator-written
- Precise
- Calm
- Willing to state limits
- Occasionally personal when first-person context is useful

It is not:

- Corporate
- Over-polished
- Self-congratulatory
- Full of slogans
- Written as fragments for artificial punch
- Trying to sound like an engineer through jargon

### 11.2 Sentence rhythm

Avoid the patterns that make technical SaaS copy read as machine-generated:

- Repeated rule-of-three sentences
- A punchline or aphorism at the end of every section
- Repeated `Not X. Y.` constructions
- Stacks of one-line fragments
- Every paragraph beginning with a product name
- Repeated symmetrical feature phrasing
- Identical headline, paragraph, bullets, card cadence in each section

Allow normal paragraphs, unequal section lengths, first-person explanations, and occasional rough edges where they improve authenticity.

### 11.3 Facts over adjectives

Prefer:

> Crucible opens no inbound ports.

Instead of:

> Security you can finally trust.

Prefer:

> The rule catalog is generated from the evaluator registry.

Instead of:

> Powerful monitoring without compromise.

Prefer:

> Crucible is MIT. The dashboard and backend are AGPL.

Instead of:

> Built open from day one.

### 11.4 Words and phrases to avoid

Do not use these unless a specific factual context requires them:

- seamless
- powerful
- revolutionary
- effortless
- supercharge
- unlock
- game-changing
- next-generation
- built for engineers by engineers
- single pane of glass
- observability without compromise
- finally
- magic
- intelligent monitoring
- AI-powered as a headline

Do not repeatedly call Glassmkr honest. Prove it through evidence, provenance, open code, and precise caveats.

### 11.5 Copy constraints

- State each value proposition once per page.
- Replace an adjective with a number or artifact when possible.
- Pull dynamic values from product facts.
- Use the product's exact vocabulary.
- Do not write hardcoded version or rule-count claims.
- Do not make unverified location claims.
- Do not use an em dash. CI must enforce this across source and generated output.
- Do not claim an installer verifies signatures unless the shipped installer does so in that release.
- Do not claim an operation is rootless if a reviewed privileged boundary is involved. Describe the actual boundary.

### 11.6 Copy review questions

Before accepting a section, ask:

1. Is every factual claim sourced?
2. Is this idea already stated elsewhere on the page?
3. Can an adjective be replaced by evidence?
4. Does the sentence pattern repeat the prior section?
5. Is any dynamic value hardcoded?
6. Does the copy imply a capability or security property that the code does not guarantee?
7. Would a maintainer plausibly write this without trying to sound impressive?

## 12. Banned visual patterns

Do not use:

- Gradient headline text
- Glowing blobs
- Blurred neon backgrounds
- Generic 3D objects
- Floating cubes
- Floating product cards
- Oversized pill-shaped buttons
- Endless rounded cards
- Generic icon, title, paragraph feature grids
- Fake terminal windows
- Random ASCII decoration
- Excessive glassmorphism
- Stock illustrations
- Abstract AI imagery
- Arbitrary bento grids
- Huge empty hero sections
- Decorative animation
- Repeated alternating left-right marketing bands
- Decorative status colors
- Chatbot bubbles for Furnace
- Sparkle icons for AI
- A Vercel-like black-and-white clone with Geist and excessive grid theater

If a section could be dropped into a generic AI-generated Framer template without changing its meaning, redesign it.

## 13. Navigation and information architecture

### 13.1 Desktop navigation

Left:

- Glassmkr wordmark, linking to `/`

Primary links:

- Docs
- Blog
- Trust
- Pricing
- GitHub

Right:

- Log in
- Self-host

`Self-host` is the primary navigation action. GitHub may show a star count only after it is meaningful and only if it can be fetched without delaying rendering. Do not display a low or stale vanity count.

### 13.2 Mobile navigation

Use a plain accessible menu. Preserve the same hierarchy. Do not convert every link into a large card.

### 13.3 Existing routes

Routes removed from the top navigation remain accessible and indexed. Do not delete use-case, comparison, or other established routes during this phase.

### 13.4 Footer

Keep the footer dense and useful:

- Product
- Docs
- Self-hosting
- GitHub
- Blog
- Trust
- Security
- Privacy
- Terms
- Licenses
- Status, if a real status page exists

Include exact license wording generated from the source-of-truth facts. Do not add a marketing paragraph that repeats the hero.

## 14. Homepage specification

The homepage is not a sequence of feature cards. It is a technical narrative built from evidence.

### 14.1 Hero

Approved copy direction:

**Eyebrow**

```text
OPEN SOURCE · CRUCIBLE MIT · GLASSMKR AGPL
```

Generate the license labels from the canonical product facts.

**H1**

```text
Open-source monitoring for bare metal.
```

**Supporting copy**

```text
Glassmkr watches SMART, IPMI, ECC, RAID, ZFS, and network hardware, then shows the evidence and the next command to run. Self-host the full stack or use the hosted service.
```

This wording may receive a final copy edit, but its factual hierarchy must remain.

**Actions**

1. `View on GitHub`
2. `Self-host Glassmkr`
3. Quiet text link: `Use hosted`

**Quickstart**

Show the canonical Compose self-hosting quickstart. It must be imported, generated, or verified against the source guide. It must not be a separately maintained string.

Do not use the `curl | sudo bash` installer as the hero command.

**Layout**

Desktop may place copy and the Compose block in an asymmetric grid, followed immediately by one large product evidence exhibit. Mobile stacks copy, actions, quickstart, and exhibit in that order.

The first product exhibit should show one real hardware or network alert with evidence and a remediation command. It must come from the validation fleet.

### 14.2 Architecture and licensing

Within approximately the next screen, explain the system with a clean technical diagram:

```text
server sources
SMART · IPMI · ECC · RAID · ZFS · network · OS
        |
        v
Crucible agent
MIT
        |
        v
Glassmkr dashboard and backend
AGPL
        |
        +--> self-hosted deployment
        |
        +--> Glassmkr hosted service
```

Build this as accessible SVG or HTML, not a raster cartoon.

Beside or below it, show a factual table:

| Component | License | Can self-host | Required hosted dependency |
|---|---|---:|---:|
| Crucible | generated fact | Yes | No |
| Dashboard and backend | generated fact | Yes | No |
| Hosted service | managed deployment | Not applicable | Optional |

Use the exact component names and license identifiers from the repositories.

### 14.3 Detection surface

Show a generated technical table from the real rule catalog. Use a representative subset without manually typing the count or statuses.

Suggested columns:

- Rule ID
- Source
- Evidence
- Severity
- State

Example categories may include SMART, NVMe, RAID, ZFS, ECC, IPMI, network, and OS, but the displayed rows must come from the generated catalog.

Headline direction:

```text
Rules for failures that physical servers actually have.
```

Do not create a generic icon grid for monitoring categories.

### 14.4 Alert-to-action surface

Use one real alert evidence exhibit to explain the workflow:

1. What fired
2. Evidence
3. Consequence
4. Recommended check
5. Remediation command
6. Resolution state

Furnace may appear inside this existing alert context as a subordinate diagnostic annotation. It must not become a separate AI section with a chat UI.

The message is monitoring first, AI second.

### 14.5 Self-hosting explanation

Do not repeat the hero quickstart verbatim lower on the page.

Instead explain what the quickstart starts, where state lives, how updates work, and where the full guide is. Use an architecture or configuration exhibit sourced from the canonical Compose files.

Primary action:

`Read the self-hosting guide`

The agent-only binary install is a separate path and belongs in the installation docs.

### 14.6 Self-hosted versus hosted

This is the only detailed pricing or hosted comparison on the homepage.

Use a restrained two-column comparison, not pricing cards.

| Self-hosted | Glassmkr hosted |
|---|---|
| Complete AGPL stack | Same product operated by Glassmkr |
| No software license charge | Free up to the configured per-account node cap |
| Your infrastructure and operations | Managed updates, backups, and operation only where verified |
| Your retention and storage policy | Hosted limits from canonical product configuration |

Do not type the node cap directly into the template. Use the configured value.

Do not resurrect old per-node prices, old free-node language, feature-tier copy, or a calculator designed for the retired model.

### 14.7 Trust handoff

End the product narrative with a compact facts row and link to `/trust`.

Possible facts, only when verified:

- Inbound ports
- Service user and privilege boundary
- Data leaving the host
- Third-party model APIs
- Self-hosted data boundary

Do not repeat the full trust manifesto on the homepage.

### 14.8 Field notes

A small latest-posts section may appear near the end. Use Source Serif 4 for post titles and the existing chart visual language for thumbnails where relevant.

Keep this section editorial, not a three-card SaaS grid.

## 15. Page-specific launch requirements

### 15.1 Self-hosting and install documentation

`/docs/self-hosting` is a primary product page, not buried support material.

The top of the page must contain:

- What is deployed
- Supported deployment path
- Canonical Compose quickstart
- Prerequisites
- Required secrets and where they are stored
- Network ports and ingress expectations
- Persistent volumes
- Upgrade path
- Backup and restore path
- Version compatibility
- Uninstall or teardown path
- Links to troubleshooting and security boundaries

The quickstart must be byte-identical to the canonical source.

Where `install.sh` is shown:

- Do not make it the self-hosting hero.
- Put a download, inspect, run path beside it.
- Describe exactly what it does.
- Do not claim signature verification unless the released script performs it.
- Do not hide privilege changes.

### 15.2 Pricing

Keep `/pricing` for URL continuity, even if the hosted product is free.

Use the two-column self-hosted versus hosted structure locked in `CC_OSS_PIVOT_SITE`. Restyle it using this system without changing product decisions.

Requirements:

- Node cap comes from configuration.
- No old dollar price remains on active product surfaces.
- No feature-tier maze.
- No calculator unless the active model genuinely needs one.
- Explain the operational difference, not just the price difference.
- Link to self-hosting and hosted signup.

### 15.3 Trust

The trust page should read like an engineering boundary document.

Use tables and exact statements for:

- Process privileges
- Root or privileged helper boundaries
- Inbound and outbound network behavior
- Data collected
- Data not collected
- Log or journal excerpts
- Redaction behavior and its limits
- Storage and retention
- Third-party services
- AI model processing
- Self-hosted behavior
- Update mechanism
- Security reporting

State known gaps. Do not use a security badge wall or vague assurance language.

No location claim appears without verification from the active infrastructure source.

### 15.4 Blog

Existing posts inherit the new article template without being rewritten.

Use:

- Source Serif 4 for article title, dek, prose, and long-form headings
- IBM Plex Sans for navigation, metadata controls, captions, and supporting UI
- Commit Mono for code, data, chart labels, and technical metadata
- Existing chart house style, updated only for token and legibility consistency
- Reading width between 680 and 760px
- Real footnotes, citations, code blocks, and figure captions

Never render chart or figure labels below approximately 12px.

Do not add decorative editorial flourishes that compete with the evidence.

### 15.5 GitHub organization and repository READMEs

The README is a launch surface and must be treated like one.

The first screen of the primary repository README should include:

1. Product name and one-line description
2. One strong evidence exhibit or terminal capture
3. Canonical Compose quickstart where appropriate
4. A concise facts table
5. Minimal status badges

The facts table should cover:

- What is open source
- License
- Self-hosting
- Hosted option
- Telemetry dependency
- Documentation
- Security reporting

Use no more than four meaningful badges. Avoid a badge wall.

Each repository must display its own correct license. Do not present MIT as the license for an AGPL repository or vice versa.

README dynamic sections are generator-owned. Quickstarts and product facts must share their source with the site.

Add or update:

- GitHub organization avatar
- Social preview image
- Repository social cards
- One architecture diagram in the site house style
- Contributing link
- Security link
- Support or discussion path

### 15.6 OG and social cards

Regenerate the OG system using the approved tokens and typography.

Rules:

- No gradient blobs
- No fake product UI
- One strong headline
- One small technical identifier or provenance detail where relevant
- Legible at social-card size
- Version referenced assets so Cloudflare and other caches do not serve stale cards
- Update all `?v=` references or equivalent cache-busting mechanisms consistently

## 16. Dashboard scope

### 16.1 Launch phase: token alignment only

Allowed before launch:

- Apply shared colors
- Apply IBM Plex Sans and Commit Mono
- Apply 2px to 4px radii
- Replace decorative shadows with borders
- Align semantic health colors
- Align chart colors, grid lines, labels, and typography
- Improve visible keyboard focus
- Fix contrast failures
- Make small spacing corrections required for the new fonts
- Remove decorative use of warning or healthy colors

Not allowed before launch unless required to fix a regression:

- New navigation architecture
- Fleet card-to-table conversion
- Host page restructuring
- Alert workflow redesign
- Route changes
- New chart types
- Major component rewrites
- Backend or data-contract changes
- New filters or keyboard systems
- Product feature scope changes

Take final marketing captures only after token alignment is complete.

### 16.2 Post-launch phase: utilitarian dashboard rebuild

Create a separate tracked phase for the full product redesign. Its target direction is:

#### Fleet view

Default to a dense table with columns such as:

- Host
- State
- Location, only if appropriate
- CPU
- Memory
- Storage
- Temperature
- Alerts
- Last seen

Support keyboard search and filters.

#### Host view

Lead with identity and state, then use structured sections for hardware, storage, network, sensors, and history. Avoid one card per metric.

#### Alerts

Order information by:

1. What broke
2. Evidence
3. Severity
4. Likely consequence
5. Recommended action
6. Command
7. History
8. Furnace annotation

#### Charts

Use charts only when history or distribution matters. A current value should normally be a number, not a donut.

This phase is explicitly not required for the OSS launch.

## 17. Documentation system

Docs must feel native to Glassmkr.

Required structure:

- Persistent left navigation
- Strong search
- Right-side table of contents on wide screens
- Stable heading anchors
- Copyable code blocks
- Version and last-updated metadata
- Edit-on-GitHub links where appropriate
- Explicit related pages
- Mobile navigation that does not obscure content

Preserve existing machine-readable metadata, `llms.txt`, `llms-full.txt`, and stable deep links.

Do not use Source Serif 4 for normal docs. Documentation uses IBM Plex Sans and Commit Mono.

## 18. Mobile behavior

Mobile must preserve technical density without becoming a pile of cards.

- Wide technical tables may scroll horizontally inside a clearly bounded region.
- Code blocks scroll horizontally and retain copy controls.
- Do not truncate commands that users need to copy.
- Provenance lines may wrap.
- Status always includes text, not color alone.
- Product exhibits must remain legible or provide a focused mobile capture.
- Hero order is copy, actions, quickstart, evidence exhibit.
- No critical text below 12px.
- Avoid accidental page-level horizontal overflow.
- Do not collapse every table row into an oversized card.

## 19. Accessibility

Meet WCAG 2.2 AA for launch surfaces.

Required checks:

- Visible keyboard focus
- Logical heading order
- Semantic landmarks
- Accessible menu behavior
- Sufficient contrast for muted text and borders
- Status not encoded by color alone
- Captions and provenance as real text
- Descriptive alt text
- Accessible text equivalent for complex charts
- Copy buttons with clear labels and feedback
- Reduced-motion support
- Form errors connected to fields
- Touch targets large enough without turning every control into a pill

Run automated checks, then perform keyboard-only and screen-reader spot checks on the homepage, self-hosting guide, pricing, trust, blog article, and dashboard login or first authenticated surface.

## 20. Performance budget

The HN and OSS audience will punish a slow marketing site. Keep content pages mostly static.

Launch targets for marketing and docs:

- Content is readable without client-side JavaScript
- Initial route JavaScript under approximately 100KB gzip unless the existing framework makes a documented exception necessary
- No blocking third-party JavaScript
- No WebGL
- No heavy animation framework
- Above-the-fold images sized and compressed, with dimensions declared
- Maximum two font preloads on the homepage
- Source Serif 4 loaded only where used
- LCP under 2.5 seconds in the agreed mobile test profile
- CLS under 0.05
- INP under 200ms where interaction exists
- No layout shift caused by fonts or exhibits

Record the test profile and results in the redesign ledger so later runs are comparable.

## 21. Regression and machinery requirements

The redesign must preserve the existing content and release machinery.

Check each affected surface for:

- Generator-owned files edited through generators only
- Markdown twins regenerated
- Existing URLs unchanged
- Sitemap entries intact
- `llms.txt` and `llms-full.txt` regenerated correctly
- JSON-LD preserved and validated
- Blog fact-check pipeline unchanged
- Stable heading anchors preserved
- OG cards regenerated
- Cache-busting references updated
- No em dash CI passing
- No stale pricing or license copy
- No hardcoded rule count or version
- No broken canonical links
- No broken edit-on-GitHub links
- No unexpected mobile overflow
- Chart labels legible
- Keyboard focus visible
- Screenshots recorded in the ledger

Do not replace a generated artifact with a hand-maintained duplicate because redesigning the generator is inconvenient.

## 22. Implementation process

### Phase 0: audit and source map

Before changing design:

1. Locate the actual files named or implied by this spec.
2. Inventory launch-gating routes and their generators.
3. Identify all dynamic product facts and their canonical sources.
4. Find all old pricing, licensing, version, and SaaS-first copy.
5. Inventory current chart styles and reusable UI components.
6. Record which repository owns site, docs, dashboard, README, and OG assets.
7. Add the redesign phase to the OSS runbook ledger.

Do not invent repository paths in order to move faster.

### Phase 1: tokens and fonts

1. Add the canonical token source.
2. Add self-hosted font files and license notices.
3. Generate or wire outputs for site, docs, and dashboard.
4. Commit this phase alone.
5. Confirm no visible behavior changes beyond foundational tokens.

### Phase 2: homepage taste gate

Build a single homepage prototype using the tokens.

Requirements for the prototype:

- Header
- Hero copy
- Canonical Compose block
- One genuine temporary validation capture
- Evidence-exhibit frame and provenance
- Architecture section
- One representative technical table
- Self-hosted versus hosted comparison
- Desktop and mobile renders

A maximum of two coherent explorations is allowed. Do not produce six minor variations.

Capture at least:

- Desktop wide viewport
- Desktop or tablet intermediate viewport
- Mobile narrow viewport

Stop for Simon's approval. This is the one mandatory visual taste gate.

The prototype may use a genuine pre-alignment validation capture marked as non-shipping. Final evidence assets are recaptured after dashboard token alignment.

### Phase 3: systematize the approved direction

1. Build shared shell and components.
2. Implement navigation and footer.
3. Implement evidence-exhibit machinery and manifest validation.
4. Apply the approved homepage system without visual drift.
5. Record any deviation in the decision ledger.

### Phase 4: launch-gating content surfaces

Implement in this order:

1. Self-hosting and installation docs
2. Pricing
3. Trust
4. Blog template and index shell
5. README and GitHub assets
6. OG card system

This order prioritizes the surfaces launch visitors will use to verify the OSS claim.

### Phase 5: dashboard token alignment

Apply only the allowed launch changes in section 16.1.

Run product regression tests before taking final evidence captures.

### Phase 6: final evidence capture

1. Run the validation scenarios.
2. Capture final product and terminal evidence using the launch tokens.
3. Generate manifests and hashes.
4. Replace prototype-only assets.
5. Verify every displayed value against its source.
6. Add captures to the screenshot ledger.

### Phase 7: regression, accessibility, and performance

Run the complete checks in sections 18 through 21.

Add the launch-gating redesign checks to gate 5 of `LAUNCH_CHECKLIST` or its active successor.

### Phase 8: launch

Launch only when all definition-of-done items pass.

## 23. Acceptance checklist

### Positioning and copy

- [ ] The first screen identifies Glassmkr as open-source bare-metal monitoring.
- [ ] Self-hosting appears before the hosted-service sales story.
- [ ] Crucible and dashboard/backend licenses are correct and generated.
- [ ] AI is subordinate to monitoring and remediation.
- [ ] Each core idea appears once on the homepage.
- [ ] No old per-node price or old free-node wording remains on active product surfaces.
- [ ] No unverified location claim remains.
- [ ] No hardcoded rule count remains.
- [ ] No hardcoded Crucible version remains.
- [ ] No em dash appears in source or generated output.
- [ ] Copy avoids repetitive fragment and rule-of-three cadence.

### Design

- [ ] Existing dark and amber equity is preserved.
- [ ] IBM Plex Sans, Commit Mono, and Source Serif 4 are self-hosted.
- [ ] Source Serif 4 is restricted to editorial surfaces.
- [ ] Semantic health colors are not used decoratively.
- [ ] Borders, not shadows, provide structure.
- [ ] Buttons are not oversized pills.
- [ ] No gradient text, glowing blobs, fake terminals, generic 3D, or bento filler remains.
- [ ] Homepage section rhythm varies according to content.
- [ ] The design does not resemble a Vercel clone.

### Evidence

- [ ] Every major homepage claim has an evidence exhibit or factual table.
- [ ] Every exhibit comes from the validation fleet or immutable captured data.
- [ ] Every exhibit has a visible provenance line.
- [ ] Every exhibit has a complete manifest and valid hash.
- [ ] No customer or secret data appears.
- [ ] No alert, metric, command, or terminal result was invented.
- [ ] Final captures use the launch dashboard tokens.

### OSS and repository surfaces

- [ ] Hero Compose block matches the canonical self-hosting guide byte-for-byte.
- [ ] README quickstart matches the same source.
- [ ] Repository licenses are displayed correctly.
- [ ] README first screen explains self-hosting and hosted use.
- [ ] README uses no more than four meaningful badges.
- [ ] Architecture diagram matches the site system.
- [ ] GitHub social previews and organization assets are updated.

### Dashboard scope

- [ ] Shared tokens are applied to the dashboard.
- [ ] Dashboard semantic status colors match the site.
- [ ] Product regression tests pass.
- [ ] No full information architecture rebuild slipped into launch scope.
- [ ] The post-launch dashboard rebuild is tracked separately.

### Technical quality

- [ ] Generated files were changed through generators.
- [ ] Markdown twins are current.
- [ ] URLs and canonical links remain valid.
- [ ] JSON-LD validates.
- [ ] Sitemap and LLM files are current.
- [ ] OG cache-busting is updated.
- [ ] Mobile has no accidental page-level overflow.
- [ ] Technical tables remain usable on mobile.
- [ ] All critical text is at least 12px.
- [ ] Keyboard navigation works.
- [ ] Automated accessibility checks pass.
- [ ] Manual accessibility spot checks pass.
- [ ] Performance budgets pass or have an explicit approved exception.

## 24. Definition of done

The launch redesign is done when:

1. Simon has approved the homepage direction.
2. Every launch-gating surface uses the approved tokens and layout language.
3. The site clearly presents Glassmkr as an open-source product with optional hosting.
4. Product facts are generated or verified from canonical sources.
5. Genuine evidence exhibits replace decorative product marketing.
6. The dashboard is visually aligned without having been rebuilt.
7. GitHub README and social surfaces are ready for launch traffic.
8. All regression, accessibility, mobile, performance, generator, and stale-copy checks pass.
9. The redesign is recorded in the OSS runbook and launch checklist.
10. The full dashboard rebuild remains a separate post-launch workstream.

## 25. Final design test

A successful result should feel like this:

- Oxide-level respect for hardware and evidence
- Axiom-level information density
- Railway-level interaction polish
- Neon-level clarity around an open-source and hosted split
- Modal-level technical confidence

It must not look like a collage of those brands.

The most important test is simpler:

> An infrastructure engineer should be able to tell, within seconds, what Glassmkr monitors, what is open source, how to run it, and why the screenshots can be trusted.
