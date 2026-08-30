<svelte:head>
  <title>Introducing Furnace: the AI assistant that helps you fix alerts - Glassmkr Blog</title>
  <meta name="description" content="Furnace is the AI assistant we built for Glassmkr. It reads alerts, looks at the evidence, suggests remediation. Self-hosted Gemma 4 26B in Amsterdam. Conservative, hedging, willing to say 'I don't know'." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/introducing-furnace" />
  <meta property="og:title" content="Introducing Furnace: the AI assistant that helps you fix alerts" />
  <meta property="og:description" content="Furnace reads alerts, looks at evidence, suggests fixes. Self-hosted Gemma 4 26B, no third-party LLM APIs, conservative + hedging + willing to say 'I don't know'." />
  <meta property="og:image" content="https://glassmkr.com/og/introducing-furnace.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Introducing Furnace: the AI assistant that helps you fix alerts" />
  <meta name="twitter:description" content="The AI assistant we built for Glassmkr. Conservative, hedging, willing to say 'I don't know'. Self-hosted Gemma 4 26B." />
  <meta name="twitter:image" content="https://glassmkr.com/og/introducing-furnace.png?v=20260826" />
  <link rel="canonical" href="https://glassmkr.com/blog/introducing-furnace" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Introducing Furnace: the AI assistant that helps you fix alerts",
    description: "Furnace is the AI assistant we built for Glassmkr. It reads alerts, looks at evidence, suggests remediation. Self-hosted Gemma 4 26B, no third-party LLM APIs.",
    image: "https://glassmkr.com/og/introducing-furnace.png?v=20260826",
    datePublished: "2026-05-17",
    dateModified: "2026-05-17",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/introducing-furnace.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/introducing-furnace",
    articleSection: "AI"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Introducing Furnace", item: "https://glassmkr.com/blog/introducing-furnace" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">May 2026 · AI · 5 min read</p>
      <h1>Introducing Furnace: the AI assistant that helps you fix alerts.</h1>
      <p class="lede">
        Furnace is the AI assistant we built for Glassmkr. It reads your alerts, looks at the evidence, and suggests remediation steps. It’s been the most-skipped feature of every monitoring tool we’ve used. We think we’ve made it useful enough to keep on.
      </p>
    </header>

    <aside class="editorial-note">
      <strong>Update (August 2026):</strong> Glassmkr is now fully open source and free, both self-hosted and hosted. Pricing described below is historical. See <a href="/blog">/blog</a> for the announcement.
    </aside>

    <h2>Why AI in monitoring is hard</h2>

    <p>
      Most monitoring tools that have shipped AI features in the last two years have made a similar mistake: they treat AI as the headline. Every alert page suddenly has a chatbot. Every threshold gets an “AI-powered” sticker. Marketing pages promise that AI will solve the alert-fatigue problem.
    </p>

    <p>
      The problem is that AI in monitoring is most useful in exactly the cases where overconfident AI is the most dangerous. Real alerts on real infrastructure require careful, hedged thinking. Is the disk SMART degradation a soft error that’s reversible, or a sign that this drive needs to be replaced tonight? Is the OOM kill a one-time event from a misbehaving cron job, or evidence of a memory leak that will recur?
    </p>

    <p>
      When an AI tool autocompletes a confident shell command at you and gets it wrong, you’ve turned a routine alert into an incident. The worst version of AI in monitoring isn’t an unhelpful AI; it’s a helpful-seeming AI that’s confidently wrong.
    </p>

    <p>So we built Furnace with a different bias: conservative, hedging, willing to say “I don’t know.”</p>

    <h2>What Furnace does</h2>

    <p>
      Furnace appears on every alert detail page. When an alert fires, Furnace reads the alert state, the evidence the rule collected, and the FIX workflow defined for that rule. It then produces context-specific notes.
    </p>

    <p>For example, on a <code>nvme_wear_high</code> alert (NVMe drive wear percentage trending high):</p>

    <blockquote>
      Drive <code>/dev/nvme0n1</code> shows 92% wear. This is in the “schedule replacement” band, not the “replace immediately” band. The rule’s FIX workflow recommends planning a maintenance window in the next 4-8 weeks. I notice the drive’s <code>lifetime_writes</code> metric has been increasing at ~2% per week over the past 90 days, which is consistent with sustained heavy write workload. If you want to confirm whether this rate is unusual for this drive model, you could compare against the manufacturer’s endurance spec (typically published in TBW). I don’t have the specific spec for your drive model loaded; you’d find it on the manufacturer’s product page.
    </blockquote>

    <p>Three things to notice:</p>

    <p><strong>It’s specific.</strong> Not “this drive is wearing out, replace it.” Specific drive, specific percentage, specific wear band from the FIX workflow.</p>

    <p><strong>It explains its reasoning.</strong> “92% wear is in the schedule-replacement band, not the replace-immediately band” tells you why it’s suggesting maintenance window vs immediate replacement.</p>

    <p><strong>It hedges where it should.</strong> “If you want to confirm whether this rate is unusual…” not “this rate is unusual.” “I don’t have the specific spec for your drive model loaded” instead of guessing the TBW from training data.</p>

    <h2>What Furnace doesn’t do</h2>

    <p>
      Furnace doesn’t autocomplete shell commands. When the FIX workflow has a command, Furnace can explain what it does, but Furnace doesn’t generate new commands for you to run. The commands shown are the ones we’ve tested and documented.
    </p>

    <p>
      Furnace doesn’t make claims about your business. It won’t tell you what the alert “really means for your customers” or recommend a “communication strategy” for your team. It does technical context. That’s it.
    </p>

    <p>
      Furnace doesn’t try to be friendly. It’s not a chatbot. There’s no “Hey there!” or “Great question!” It writes the way a senior engineer writes during an incident: terse, factual, useful.
    </p>

    <p>
      Furnace says “I don’t know” when it doesn’t know. If you ask it about something outside the alert context, it doesn’t hallucinate. If the evidence is inconclusive, it tells you the evidence is inconclusive.
    </p>

    <h2>How Furnace is built</h2>

    <p>
      We considered using a commercial LLM API (OpenAI, Anthropic, Google) for Furnace and decided against it.
    </p>

    <p>Three reasons:</p>

    <p>
      <strong>Data residency.</strong> Glassmkr customers’ alert data should not leave EU jurisdiction. Routing alert evidence to a US-based commercial API does not match our trust posture.
    </p>

    <p>
      <strong>Cost predictability.</strong> Per-token API pricing scales with usage in ways we couldn’t pass on transparently at the $3/node/month we charged at the time (pricing since retired; the stack is open source now). Self-hosted inference is fixed-cost.
    </p>

    <p>
      <strong>Behavioral control.</strong> Commercial LLMs have safety filtering, refusal patterns, and system-prompt overrides that we don’t control. For a monitoring tool, we want full control of the behavior.
    </p>

    <p>
      So Furnace runs on self-hosted Gemma 4 26B (a quantised variant) on a single NVIDIA L4 GPU in Amsterdam, served via llama.cpp. Inference latency is ~2-5 seconds for typical alert annotations.
    </p>

    <p>
      We picked Gemma 4 for three reasons: it’s an open-weight model from a credible source (Google DeepMind), the 26B parameter size is large enough to be useful while small enough to run on a single L4 GPU, and the licensing terms allow commercial use without per-API-call fees.
    </p>

    <h2>The truthfulness scope</h2>

    <p>We wrote a scope document for what Furnace will and won’t do. Highlights:</p>

    <ul>
      <li>Furnace hedges interpretive claims and states mechanical facts directly.</li>
      <li>Furnace says “I don’t know” when it doesn’t know.</li>
      <li>Furnace doesn’t autocomplete fix commands.</li>
      <li>Furnace stays in scope: technical context for alerts and infrastructure questions, nothing else.</li>
    </ul>

    <p>
      We treat the scope as a living document that we update when we find Furnace doing something we don’t want.
    </p>

    <h2>What’s next</h2>

    <p>This is the introduction of Furnace as a feature. The bigger product investments around Furnace are in the queue:</p>

    <p>
      <strong>Richer remediation grounding.</strong> Furnace will read more of the structured remediation data attached to each rule and use it to ground its suggestions. The deepening work on our rule library brought the remediation content from prose-only descriptions to structured fields the dashboard renders inline. Furnace gets richer context as that data flows into the prompt.
    </p>

    <p>
      <strong>Customer-specific patterns.</strong> As your fleet accumulates alert history, Furnace can reference “this rule has fired twice before on this server; both times it resolved within an hour without action” instead of treating each alert as isolated.
    </p>

    <p>
      <strong>Better refusal patterns.</strong> We’re tracking cases where Furnace should have refused to answer or should have said “I don’t know” but didn’t. Each one is a training signal for the next iteration.
    </p>

    <h2>Try it</h2>

    <p>
      If you have a Glassmkr account, Furnace is enabled by default on all alert detail pages. No setup, no API key required.
    </p>

    <p>
      If you don’t have a Glassmkr account, <a href="https://glassmkr.com">sign up</a> is free (the hosted service has a 10-node per-account cap), or self-host the whole stack. Install Crucible on a server you care about. If anything is degraded on that server (and on bare metal, something usually is), an alert will fire within minutes. Click into the alert detail page and you’ll see Furnace’s notes.
    </p>

    <p>
      If Furnace’s notes are useful, tell us. If they’re not, tell us harder. Email <a href="mailto:simon@glassmkr.com">simon@glassmkr.com</a>.
    </p>

    <h2>One more thing</h2>

    <p>
      We chose the name Furnace deliberately. A furnace is a tool that works hot, transforms input under pressure, and is fundamentally about controlled process. The metaphor maps to alert remediation in ways we think are honest: alerts are pressure, the response is process, the goal is controlled work not theatre.
    </p>

    <p>
      If the name strikes you as overwrought, that’s fair. Names are arbitrary. The product is what matters.
    </p>

    <p>
      Read more about how Glassmkr handles AI honestly: <a href="/trust#agent">the trust posture</a>, the <a href="/docs">documentation</a>.
    </p>

    <footer class="post-footer">
      <p>Published May 17, 2026. By Simon Rybisar.</p>
      <p>
        <a href="/blog">&larr; All posts</a>
      </p>
    </footer>
  </article>
</div>

<style>
  .post {
    padding: 56px 0 80px;
  }
  .post-header {
    margin-bottom: 40px;
  }
  .post-meta {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 18px;
  }

  .editorial-note {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-left: 3px solid rgba(255, 107, 53, 0.5);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    margin: 0 0 28px;
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-tertiary);
  }
  .editorial-note strong {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .editorial-note a {
    color: var(--accent);
    text-decoration: none;
  }
  .post h1 {
    font-size: clamp(30px, 4.6vw, 44px);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.15;
    color: var(--text-primary);
    margin: 0 0 20px;
  }
  .lede {
    font-size: clamp(16px, 1.8vw, 19px);
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
  }

  .post h2 {
    font-size: clamp(20px, 2.4vw, 26px);
    font-weight: 600;
    color: var(--text-primary);
    margin: 40px 0 16px;
    line-height: 1.3;
  }
  .post p {
    font-size: 16px;
    line-height: 1.75;
    color: var(--text-secondary);
    margin: 0 0 16px;
  }
  .post a {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
  .post a:hover { text-decoration-thickness: 2px; }
  .post code {
    font-family: var(--font-mono, monospace);
    font-size: 14px;
    color: var(--accent);
    background: rgba(255, 107, 53, 0.06);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
  }
  .post strong {
    color: var(--text-primary);
    font-weight: 600;
  }
  .post ul {
    margin: 0 0 16px;
    padding-left: 24px;
  }
  .post li {
    font-size: 16px;
    line-height: 1.75;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }
  .post blockquote {
    margin: 20px 0;
    padding: 18px 22px;
    border-left: 2px solid var(--accent);
    background: rgba(255, 107, 53, 0.04);
    border-radius: 0 6px 6px 0;
  }
  .post blockquote p {
    margin: 0;
    font-size: 15.5px;
    line-height: 1.7;
    color: var(--text-secondary);
  }
  .post blockquote code {
    font-size: 13px;
  }

  .post-footer {
    margin-top: 56px;
    padding-top: 28px;
    border-top: 1px solid var(--surface-border);
    font-size: 13.5px;
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
  }
  .post-footer p { font-size: 13.5px; line-height: 1.7; margin: 0 0 8px; }
</style>
