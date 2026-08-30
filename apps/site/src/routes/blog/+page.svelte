<svelte:head>
  <title>Blog - Glassmkr</title>
  <meta name="description" content="Field notes, guides, and operational evidence on bare metal monitoring: SMART, IPMI, RAID, ECC and what actually breaks in a rack." />
  <link rel="canonical" href="https://glassmkr.com/blog" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/blog" />
  <meta property="og:title" content="Glassmkr blog" />
  <meta property="og:description" content="Field notes on bare-metal monitoring: server operations, infrastructure tooling, and self-hosted AI for alert remediation." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr blog" />
  <meta name="twitter:description" content="Updates and technical posts on bare-metal monitoring and infrastructure tooling." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />
</svelte:head>

<script lang="ts">
  type Post = {
    slug: string;
    image: string; // /og/... path
    date: string;
    tag: string;
    title: string;
    excerpt: string;
    imageAlt: string;
    readTime?: string;
    // A real evidence image from the post itself, used only for the
    // lead entry. The OG card is headline art: showing it above the same
    // headline repeats the title twice, which is the pattern this index
    // was rebuilt to remove.
    evidence?: string;
    evidenceAlt?: string;
  };

  // Single source of truth for the index. Newest first. Image paths match
  // the files committed at apps/site/static/og/. If a post doesn't have a
  // dedicated image yet, point `image` at /og/default.png?v=20260830.
  const posts: Post[] = [
    {
      slug: "smart-said-passed",
      evidence: "/blog/smart-said-passed-trajectory.png?v=3",
      evidenceAlt: "Chart of one drive across 140 readings. A green band across the top shows overall health reporting PASSED in every reading. A flat dashed line marks reallocated sectors at 477, unchanged throughout. Below, the pending sector count opens at its maximum of 96, drains to zero over about two days, and after a 5.17 day gap in monitoring rises from zero three more times, peaking at 16, 32 and 16.",
      readTime: "7 min read",
      image: "/og/smart-said-passed.png?v=20260830",
      date: "August 2026",
      tag: "Engineering",
      title: "SMART said PASSED. The drive had 477 dead sectors.",
      excerpt: "We ran a drive-health campaign across thirteen boxes to find out whether early warning actually works. One drive was carrying 477 reallocated sectors and reported its own health as PASSED in all 140 readings we took, a full write-and-verify pass over it came back clean, and the four healthy drives we tried hardest to destroy refused to break. Including the part we cannot yet answer.",
      imageAlt: "Glassmkr blog card with the hexagon logo, an Engineering tag, and the title SMART said PASSED. The drive had 477 dead sectors.",
    },
    {
      slug: "manage-your-fleet-by-talking-to-it",
      readTime: "5 min read",
      image: "/og/manage-your-fleet-by-talking-to-it.png?v=20260830",
      date: "July 2026",
      tag: "Engineering",
      title: "Manage your fleet by talking to it",
      excerpt: "Glassmkr now speaks the Model Context Protocol: an AI client connects to your fleet with a browser sign-in and can query it, and with the scopes you grant, manage it. The interesting part was making a delete safe to hand an LLM: a scope you grant, a two-step confirmation, and a soft delete you can undo.",
      imageAlt: "Glassmkr blog card with the hexagon logo, an Engineering tag, and the title Manage your fleet by talking to it.",
    },
    {
      slug: "monitoring-your-customers-can-automate",
      readTime: "4 min read",
      image: "/og/monitoring-your-customers-can-automate.png?v=20260830",
      date: "July 2026",
      tag: "Product",
      title: "Monitoring your customers can automate",
      excerpt: "Dedicated servers ship with console access and traffic graphs; the layer that predicts hardware failure is usually the customer's problem to assemble. Every step of that layer, registering servers, installing the agent, routing and testing alert channels, is an API call, and that changes who can offer it.",
      imageAlt: "Glassmkr blog card with the hexagon logo, a Product tag, and the title Monitoring your customers can automate.",
    },
    {
      slug: "one-account-key-zero-per-host-secrets",
      readTime: "5 min read",
      image: "/og/one-account-key-zero-per-host-secrets.png?v=20260830",
      date: "July 2026",
      tag: "Engineering",
      title: "One account key, zero per-host secrets",
      excerpt: "Most fleets onboard into monitoring by copying one powerful credential onto every box. glassmkr-crucible enroll does the opposite: one account key stays in your control plane, each host self-registers by a stable machine ID and holds only its own collector key, and running the automation twice does nothing.",
      imageAlt: "Glassmkr blog card with the hexagon logo, an Engineering tag, and the title One account key, zero per-host secrets.",
    },
    {
      slug: "open-model-ladder-blind-remediation",
      readTime: "8 min read",
      image: "/og/open-model-ladder-blind-remediation.png?v=20260830",
      date: "July 2026",
      tag: "Engineering",
      title: "Same model, same server, opposite result: the half of agent testing everyone forgets",
      excerpt: "We gave nine open-weight models root on real broken servers and graded every claim against the machine, not the model's own report. The thing that most decided success was not model size. It was whether our harness spoke the language the model was trained in: North scores 0 in plain text and 7 with tools, Phi-4 is the mirror.",
      imageAlt: "Glassmkr blog card with the hexagon logo, an Engineering tag, and the title Same model, same server, opposite result.",
    },
    {
      slug: "haiku-blind-remediation",
      readTime: "5 min read",
      image: "/og/haiku-blind-remediation.png?v=20260830",
      date: "July 2026",
      tag: "Engineering",
      title: "We gave Claude Haiku root on a broken server",
      excerpt: "We ran our standing validation exercise with Claude Haiku 4.5, the smallest model in the family, on a real bare-metal server with four firing alerts. It fixed what it should, correctly declined to touch healthy hardware, and surfaced a false-positive bug in our own monitoring.",
      imageAlt: "Glassmkr blog card with the Glassmkr logo, an Engineering tag, and the title We gave Claude Haiku root on a broken server.",
    },
    {
      slug: "monitoring-a-host-you-dont-fully-control",
      readTime: "5 min read",
      image: "/og/monitoring-a-host-you-dont-fully-control.png?v=20260830",
      date: "July 2026",
      tag: "Product",
      title: "Half the \"problems\" on a marketplace GPU host are required config",
      excerpt: "Three alert rules fired on every box in our GPU fleet, and all three were correct readings of config a marketplace GPU host is supposed to have. The same signal is a finding on one host and required config on another, so we taught Glassmkr the difference with host-type profiles.",
      imageAlt: "A dashboard showing a Marketplace GPU host profile suppressing the firewall, auto-update, and power-cap rules while keeping the failing-drive and driver-reboot checks loud.",
    },
    {
      slug: "the-reboot-that-delists-your-gpu-host",
      readTime: "6 min read",
      image: "/og/the-reboot-that-delists-your-gpu-host.png?v=20260830",
      date: "June 2026",
      tag: "GPU",
      title: "A single reboot would have de-listed our entire GPU fleet",
      excerpt: "On these NVIDIA boxes nouveau was never blacklisted, so the next routine reboot would have stopped every GPU verifying and silently dropped the host off the Vast marketplace. The failure mode, the one-line fix, and why monitoring should catch the latent fault before the reboot.",
      imageAlt: "A terminal showing the nouveau-versus-nvidia driver conflict: nouveau holds the device and the nvidia module fails to probe with error -16.",
    },
    {
      slug: "20-box-gpu-fleet-88-to-11-alerts",
      readTime: "7 min read",
      image: "/og/20-box-gpu-fleet-88-to-11-alerts.png?v=20260830",
      date: "June 2026",
      tag: "GPU",
      title: "We pointed Glassmkr at a 20-box GPU fleet. It went from 88 alerts to 11.",
      excerpt: "A field report from twenty GPU boxes on Vast: the honest breakdown of 88 alerts down to 11. What was real hardware, what was noise we muted on purpose, what was self-inflicted, and the false positives we then fixed in the product.",
      imageAlt: "A monitoring dashboard for a 20-box GPU fleet showing the active-alert count falling from 88 to 11, annotated by category.",
    },
    {
      slug: "the-most-honest-ai-feature-we-shipped-has-no-ai-in-it",
      readTime: "6 min read",
      image: "/og/the-most-honest-ai-feature-we-shipped-has-no-ai-in-it.png?v=20260830",
      date: "June 2026",
      tag: "Engineering",
      title: "The most honest AI feature we shipped has no AI in it",
      excerpt: "We built the self-hosted-Gemma path for our ticket-draft feature, A/B'd it against a plain template on a live degraded-array alert, and shipped the template. The model was fine. Fine did not justify 22 seconds and a hallucination surface. What we kept, what we cut, and why the value was never the prose.",
      imageAlt: "A terminal A/B of two ticket drafts for the same alert: the template returns in 3 milliseconds, names the fault and keeps the remote-hands option; Gemma returns in 22 seconds, opens with a generic 'a likely hardware fault' and drops a line. Shipped: template; Gemma left off behind a flag.",
    },
    {
      slug: "would-you-have-caught-my-vrm-degradation",
      readTime: "9 min read",
      image: "/og/would-you-have-caught-my-vrm-degradation.png?v=20260830",
      date: "June 2026",
      tag: "Engineering",
      title: "Would you have caught my VRM degradation?",
      excerpt: "A customer's Ryzen 9 5950X lost its VRM and asked if Glassmkr would have caught it. The honest answer was no: voltage alone cannot watch a DVFS core rail. What we built instead (a behavioral signal and a variance-aware voltage-drift signal), what happened when we backtested it on our own MC12-LE0, and the uptime check that stopped us claiming a win we had not earned.",
      imageAlt: "A monitoring timeline for a Gigabyte MC12-LE0 showing a cluster of multi-hour reporting gaps in mid-May beside an uptime counter that keeps climbing through every gap, proving the box never rebooted.",
    },
    {
      slug: "what-our-test-suite-looks-like",
      readTime: "8 min read",
      image: "/og/what-our-test-suite-looks-like.png?v=20260830",
      date: "June 2026",
      tag: "Engineering",
      title: "What our test suite looks like, and why",
      excerpt: "Four tests from the code that runs Glassmkr, and the incident that put each one there: a suppressed security alert, a temperature threshold that means different things on different boards, a 404 that has to stay a 404, and a power-supply name captured from a lying BMC. A test suite as a map of what has hurt you.",
      imageAlt: "A vitest run showing four passing tests tagged by cluster (security, evaluator, tenancy, parser), the agent and dashboard test counts, and a marketing-site line reading zero tests on purpose.",
    },
    {
      slug: "validating-gpu-monitoring-across-three-nvidia-cards",
      readTime: "7 min read",
      image: "/og/validating-gpu-monitoring-across-three-nvidia-cards.png?v=20260830",
      date: "May 2026",
      tag: "Engineering",
      title: "Validating GPU monitoring across three NVIDIA cards: L4, RTX A4000, A16",
      excerpt: "Three cards, eight rules. We tested three live on real hardware (power-cap throttling on a multi-die A16, thermal load on an L4, driver drift across all three) and deliberately did not induce the other five, because a real uncorrected-ECC or XID fault needs a power cycle to clear. The honest map of what 'GPU monitoring, tested' means.",
      imageAlt: "A terminal table validating GPU rules across NVIDIA L4, RTX A4000 and A16: L4 stayed quiet at 67C of 90C under load, the A16 reported 8 dies with correct per-die dedup, and ECC/XID/NVLink were fixture-tested rather than induced.",
    },
    {
      slug: "we-found-a-security-false-negative-in-our-own-monitoring",
      readTime: "5 min read",
      image: "/og/we-found-a-security-false-negative-in-our-own-monitoring.png?v=20260830",
      date: "May 2026",
      tag: "Security",
      title: "We found a security false-negative in our own monitoring",
      excerpt: "On RHEL-family hosts, download-only dnf-automatic timers were treated as 'auto-updates configured,' silently suppressing the pending_security_updates alert while Critical patches sat unapplied. What the bug was, how dogfooding caught it, and the fix in Crucible 0.13.6.",
      imageAlt: "A monitoring dashboard showing a RHEL host marked healthy while security patches sit pending and unapplied behind a download-only dnf-automatic timer.",
    },
    {
      slug: "cross-vendor-ipmi-quirks",
      readTime: "7 min read",
      image: "/og/cross-vendor-ipmi-quirks.png?v=20260830",
      date: "May 2026",
      tag: "Operations",
      title: "Cross-vendor IPMI quirks we learned the hard way",
      excerpt: "Six specific footguns from running monitoring across Supermicro, Gigabyte, ASUS and ASRockRack on Debian, Ubuntu, Rocky, Alma and Proxmox. SEL timestamp shapes, BMC firmware that lies about vendor, distro-specific package gaps, and the Gigabyte DTS +30 °C offset.",
      imageAlt: "Multi-vendor IPMI compatibility matrix showing Supermicro, Gigabyte, ASUS, and ASRockRack boards alongside their SEL timestamp formats, sensor quirks, and required workarounds.",
    },
    {
      slug: "when-monitoring-punishes-customers",
      image: "/og/when-monitoring-punishes-customers.png?v=20260830",
      date: "May 2026",
      tag: "Engineering",
      title: "When your monitoring tool punishes customers for doing the right thing",
      excerpt: "60 minutes of stale alerts after a legitimate fix. A kernel reboot that fired its own critical alert. Two distinct bugs surfaced when we actually applied our own remediation guidance end to end on the validation fleet.",
      imageAlt: "Timeline of a stale no_firewall alert: customer enables ufw at 21:35, dashboard still shows the alert through 21:45, finally clears at 21:54. Post-fix the latency is 5 minutes.",
    },
    {
      slug: "when-phase-1-audit-changed-our-hypothesis",
      readTime: "6 min read",
      image: "/og/when-phase-1-audit-changed-our-hypothesis.png?v=20260830",
      date: "May 2026",
      tag: "Engineering",
      title: "When a Phase 1 audit changed our hypothesis",
      excerpt: "A server reported 'IPMI: Not detected' while showing ECC counts on the same screen. The spec said our vendor detection was wrong. An hour-long audit said detection was correct and three other things were broken. Map the problem before you write the code.",
      imageAlt: "A two-column terminal table comparing HYPOTHESIS against ACTUAL: vendor allowlist vs no allowlist exists, detection is wrong vs detection is correct, fix the detection vs fix the rendering and emission.",
    },
    {
      slug: "introducing-furnace",
      readTime: "5 min read",
      image: "/og/introducing-furnace.png?v=20260830",
      date: "May 2026",
      tag: "AI",
      title: "Introducing Furnace: the AI assistant that helps you fix alerts",
      excerpt: "Furnace reads your alerts, looks at the evidence, and suggests remediation. Self-hosted Gemma 4 26B in Amsterdam. Conservative, hedging, willing to say 'I don't know'. The AI in your monitoring shouldn't be the headline.",
      imageAlt: "Furnace AI assistant: reads alert, looks at evidence, suggests fix. Self-hosted Gemma 4 26B, no third-party LLM APIs.",
    },
    {
      slug: "ai-controlled-probe-of-alert-docs",
      image: "/og/ai-controlled-probe-of-alert-docs.png?v=20260830",
      date: "May 2026",
      tag: "Engineering",
      title: "We used an AI as a controlled probe of our alert documentation",
      excerpt: "We forbade an AI from using its training data and made it resolve real infrastructure alerts using only the guidance our own dashboard produces. Three gap patterns surfaced. All three fixed in the same week.",
      imageAlt: "Terminal probe output highlighting three alert-docs gap patterns surfaced by a constrained AI run",
    },
    {
      slug: "training-drive-failure-model-on-l4",
      image: "/og/training-drive-failure-model-on-l4.png?v=20260830",
      date: "April 2026",
      tag: "Engineering",
      title: "Training a drive-failure model on a GPU server's CPU",
      excerpt: "We retrained our drive-failure predictor on 2 years of Backblaze data (222M drive-days) on the CPU of our L4 inference server. Gemma stayed resident in VRAM. 59 minutes, no new compute, 5.8% inference overhead. Plus the feature-importance surprise: SMART 197 beat SMART 187.",
      imageAlt: "Training next to Gemma: top output showing python train.py at 2200% CPU alongside llama-server at 9% CPU on l4-ams-01",
    },
    {
      slug: "introducing-glassmkr",
      image: "/og/introducing-glassmkr.png?v=20260830",
      date: "April 2026",
      tag: "Launch",
      title: "Introducing Glassmkr: bare metal monitoring built by operators",
      excerpt: "The original launch post. Two pieces, one philosophy: the Crucible agent plus Dashboard. The plans it describes were retired in August 2026 when the whole stack went open source.",
      imageAlt: "Glassmkr terminal preview: crucible fleet --status showing 3 servers, 68 rules evaluated, all healthy",
    },
    {
      slug: "qwen3-6-vs-gemma-4-infrastructure-narration",
      image: "/og/qwen3-6-vs-gemma-4-infrastructure-narration.png?v=20260830",
      date: "April 2026",
      tag: "Engineering",
      title: "We benchmarked Qwen3.6 against our production Gemma 4 on an L4. Here's what actually mattered.",
      excerpt: "Three-way benchmark of Gemma 4 26B-A4B, Qwen3.6 35B-A3B no-think, and Qwen3.6 35B-A3B thinking on a production infrastructure health analysis prompt. Real wall-clock numbers, VRAM footprints, and the quality-latency tradeoff that matters for narration.",
      imageAlt: "Qwen3.6 vs Gemma 4 benchmark: thinking mode cost 7x latency for no material quality gain",
    },
    {
      slug: "ipmi-diagnostics-bare-metal",
      image: "/og/ipmi-diagnostics-bare-metal.png?v=20260830",
      date: "April 2026",
      tag: "Operations",
      title: "IPMI diagnostics for bare metal: what to monitor and how to read it",
      excerpt: "A practical guide to monitoring IPMI sensors, SEL logs, and BMC health on Dell, Supermicro, and HPE servers. Covers kipmi0 CPU issues, vendor quirks, and what to alert on.",
      imageAlt: "ipmitool sensor output showing CPU2 at 89C critical, FAN1 at 0 RPM, mixed PSU status",
    },
    {
      slug: "gemma-4-l4-gpu-server-analysis",
      image: "/og/gemma-4-l4-gpu-server-analysis.png?v=20260830",
      date: "April 2026",
      tag: "Engineering",
      title: "What We Learned Running Gemma 4 on an L4 GPU for Production Server Analysis",
      excerpt: "How we deployed Gemma 4 26B on an NVIDIA L4 for AI health analysis of bare metal servers. Covers model selection, why vLLM failed, quantization choices, and prompting for structured infrastructure output.",
      imageAlt: "Gemma 4 26B-A4B (3.8B active) shipped; dense models 8B, 32B, and 70B did not make it",
    },
    {
      slug: "ipmi-smart-raid-hardware-monitoring",
      image: "/og/ipmi-smart-raid-hardware-monitoring.png?v=20260830",
      date: "April 2026",
      tag: "Operations",
      title: "IPMI, SMART, and RAID: The Hardware Layer Your Cloud Monitoring Tool Ignores",
      excerpt: "Most monitoring tools stop at the OS. Below it sits an entire hardware layer: disk firmware predicting its own failure, fans at 0 RPM, ECC memory correcting silent errors. Here is what to monitor and why.",
      imageAlt: "Priority-ordered hardware alerts: P1 SMART failing, P2 RAID degraded, P3 reallocated sectors rising, P4 ECC errors",
    },
    {
      slug: "why-bare-metal-monitoring-is-different",
      image: "/og/why-bare-metal-monitoring-is-different.png?v=20260830",
      date: "April 2026",
      tag: "Operations",
      title: "Why bare metal monitoring is different",
      excerpt: "Cloud monitoring tools were built for ephemeral workloads. They track HTTP latency and container restarts. But when you run physical servers, the failure modes are fundamentally different: drives wear out, DIMM slots develop bit errors, fans fail silently, and RAID arrays degrade without anyone noticing.",
      imageAlt: "Bare metal failure modes across storage, hardware, network, OS - none of which a cloud APM sees",
    },
  ];
</script>

<div class="blog-shell site-grid">
  <div class="blog-rail">
    <h1>Blog</h1>
    <p class="rail-desc">Field notes, guides, and operational evidence from Glassmkr.</p>
    <p class="rail-note">Real captures, real failures, real numbers. Every chart on these pages comes from a machine we ran.</p>
  </div>

  <div class="blog-main">
    {#if posts.length}
      {@const features = posts.slice(0, 2)}
      <div class="feature-row">
        {#each features as post, i (post.slug)}
          <a href="/blog/{post.slug}" class="feature">
            <!-- The feature row carries the post's card, consistently: the
                 in-article evidence charts predate the redesign palette and
                 read as a different system next to the cards. Intrinsic size
                 stated so the row reserves space before the image arrives. -->
            <img class="feature-art" src={post.image} alt={post.imageAlt} width="1200" height="630" loading="eager" decoding="async" />
            <p class="row-meta">
              <span>{post.date}</span><span class="sep">·</span><span>{post.tag}</span>
              {#if post.readTime}<span class="sep">·</span><span>{post.readTime}</span>{/if}
            </p>
            <h2 class="feature-title">{post.title}</h2>
            <p class="feature-dek">{post.excerpt}</p>
          </a>
        {/each}
      </div>

      <ol class="journal">
        {#each posts.slice(2) as post (post.slug)}
          <li>
            <a href="/blog/{post.slug}">
              <p class="row-meta">
                <span>{post.date}</span><span class="sep">·</span><span>{post.tag}</span>
                {#if post.readTime}<span class="sep">·</span><span>{post.readTime}</span>{/if}
              </p>
              <h3>{post.title}</h3>
              <p class="row-dek">{post.excerpt}</p>
            </a>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</div>

<style>
  /* Blog index on the wide grid (redesign spec 13.1): editorial rail left,
     a two-post feature row carrying real art, compact chronological rows
     below. No category filters: no category routes exist, and a dead
     control is worse than none. */
  .blog-shell {
    padding-top: clamp(40px, 6vh, 72px);
    padding-bottom: 80px;
    row-gap: 0;
  }
  .blog-rail {
    grid-column: 1 / 4;
    align-self: start;
    position: sticky;
    top: 88px;
  }
  .blog-rail h1 {
    font-size: var(--type-h1);
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.02;
    margin: 0 0 14px;
  }
  .rail-desc {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 14px;
    max-width: 30ch;
  }
  .rail-note {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-tertiary);
    margin: 0;
    max-width: 30ch;
    border-top: 1px solid var(--g-border-subtle);
    padding-top: 12px;
  }
  .blog-main {
    grid-column: 4 / 13;
    min-width: 0;
  }

  .feature-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--grid-gap);
    margin-bottom: 40px;
  }
  .feature {
    display: block;
    text-decoration: none;
    color: inherit;
    min-width: 0;
  }
  .feature:hover {
    text-decoration: none;
  }
  .feature-art {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--g-radius-3);
    border: 1px solid var(--g-border);
    background: var(--g-surface-1);
    margin-bottom: 14px;
  }
  .feature:hover .feature-art {
    border-color: var(--g-brand-edge);
  }
  .feature-title {
    font-size: var(--type-h3);
    font-weight: 500;
    letter-spacing: -0.015em;
    line-height: 1.2;
    color: var(--text-primary);
    margin: 6px 0 8px;
  }
  .feature:hover .feature-title {
    color: var(--g-brand);
  }
  .feature-dek {
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .row-meta {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .row-meta .sep {
    color: var(--g-border-strong);
  }

  .journal {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--g-border-strong);
  }
  .journal li {
    border-bottom: 1px solid var(--g-border-subtle);
  }
  .journal a {
    display: block;
    padding: 18px 0;
    text-decoration: none;
    color: inherit;
  }
  .journal a:hover {
    text-decoration: none;
  }
  .journal h3 {
    font-size: 17px;
    font-weight: 500;
    letter-spacing: -0.01em;
    line-height: 1.3;
    color: var(--text-primary);
    margin: 6px 0 6px;
  }
  .journal a:hover h3 {
    color: var(--g-brand);
  }
  .row-dek {
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text-tertiary);
    margin: 0;
    max-width: 90ch;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  @media (max-width: 1023px) {
    .blog-rail {
      grid-column: 1 / 13;
      position: static;
      margin-bottom: 32px;
    }
    .blog-main {
      grid-column: 1 / 13;
    }
  }
  @media (max-width: 640px) {
    .feature-row {
      grid-template-columns: 1fr;
    }
  }
</style>
