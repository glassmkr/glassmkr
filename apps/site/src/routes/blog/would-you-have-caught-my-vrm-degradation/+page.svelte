<script lang="ts">
  // Code/console blocks are rendered through string consts so Svelte does not
  // try to parse the braces inside them as expressions.
  const driftGate = `// triggers.ts: a fixed rail only warns when it has walked away from its
// OWN baseline by more than its own noise band, and by a real fraction.
for (const d of features.voltage_drift ?? []) {
  if (d.drift_pct < VDRIFT_PCT_FLOOR) continue; // < 1.5% of nominal: ignore
  if (d.z_score   < VDRIFT_Z_FLOOR)   continue; // < 3 baseline sigma: ignore
  // ... otherwise emit psu_rail_voltage_drift
}`;

  const varianceFixture = `// A 12V rail swinging 11.0-13.0V (baseline sigma ~1.0V), with its recent
// mean nudged up to 12.3V. The 2.5% mean shift clears the percent floor,
// but 0.3V is only ~0.3 sigma, so the variance gate keeps it silent.
{ name: "P_12V", baseline: (i) => (i % 2 ? 13.0 : 11.0),
                 recent:   (i) => (i % 2 ? 12.6 : 12.0) }

expect(v.drift_pct).toBeGreaterThanOrEqual(0.015); // clears the percent floor
expect(v.z_score).toBeLessThan(3);                 // fails the variance gate
expect(voltageDriftTriggers(...).length).toBe(0);  // result: no warning`;

  const evidence = `Host stopped reporting 2 times in the last 3 days (gaps over 50 min;
longest 960 min), versus 1 in the prior 8 days. Repeated unexplained
disappearances on a previously-stable host commonly precede a permanent
hardware failure (power delivery, PSU, RAM, or thermal).`;

  const uptimeTable = `gap (UTC)                    length    uptime before -> after    reboot?
May 14 21:28 - May 15 09:18  11.8 h    31.2 h  ->  43.1 h        no  (+11.8 h)
May 15 17:49 - May 15 20:04   2.25 h   51.6 h  ->  53.8 h        no  (+2.25 h)
May 17 18:47 - May 18 10:48  16.0 h   100.5 h  -> 116.6 h        no  (+16.0 h)`;
</script>

<svelte:head>
  <title>Would you have caught my VRM degradation? - Glassmkr Blog</title>
  <meta name="description" content="A customer's Ryzen 9 5950X lost its VRM and asked if Glassmkr would have caught it. The honest answer was no: in-band voltage telemetry cannot watch a DVFS core rail. Here is what we built instead, and the uptime check that kept us honest about what it actually caught." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/would-you-have-caught-my-vrm-degradation" />
  <meta property="og:title" content="Would you have caught my VRM degradation?" />
  <meta property="og:description" content="The honest answer was no: voltage alone cannot watch a DVFS core rail. Here is what we built instead, what happened when we backtested it on our own hardware, and the uptime check that kept us honest." />
  <meta property="og:image" content="https://glassmkr.com/og/would-you-have-caught-my-vrm-degradation.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Would you have caught my VRM degradation?" />
  <meta name="twitter:description" content="A hard customer question, an honest no, two signals we built because of it, and the backtest on our own box that taught us to check uptime before crying hardware." />
  <meta name="twitter:image" content="https://glassmkr.com/og/would-you-have-caught-my-vrm-degradation.png?v=20260826" />
  <link rel="canonical" href="https://glassmkr.com/blog/would-you-have-caught-my-vrm-degradation" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Would you have caught my VRM degradation?",
    description: "A customer's Ryzen 9 5950X lost its VRM and asked if Glassmkr would have caught it. The honest answer was no. What we built instead, the backtest on our own MC12-LE0, and the uptime check that kept us honest.",
    image: "https://glassmkr.com/og/would-you-have-caught-my-vrm-degradation.png?v=20260826",
    datePublished: "2026-06-09",
    dateModified: "2026-06-09",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/would-you-have-caught-my-vrm-degradation.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/would-you-have-caught-my-vrm-degradation",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Would you have caught my VRM degradation?", item: "https://glassmkr.com/blog/would-you-have-caught-my-vrm-degradation" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">June 2026 · Engineering · 9 min read</p>
      <h1>Would you have caught my VRM degradation?</h1>
      <p class="lede">
        A customer running a Ryzen 9 5950X on a Gigabyte MC12-LE0 watched the board's VRM degrade. They asked us a fair question: would Glassmkr have caught it? The honest answer was no, not from voltage. This is what that no actually means, what we built because of it, and the moment in the backtest where we had to stop ourselves from claiming a win we had not earned.
      </p>
    </header>

    <h2>The question</h2>

    <p>
      The board is an AM4 platform: a Gigabyte MC12-LE0 with a Ryzen 9 5950X. Its voltage regulator module degraded over time: the box would crash, come back, and crash again, until it could no longer power the server at all and the motherboard had to be replaced. The customer was not running us. They had collectd on the box: plenty of graphs, nothing actionable before it died. So they came to evaluate Crucible with a fair and direct question: would your tool have seen this coming?
    </p>

    <h2>The honest answer was no</h2>

    <p>
      Not from the voltage rails. There are two reasons, and neither is a bug we can patch away.
    </p>

    <p>
      First, the CPU core rail is DVFS. VCORE and VDDCR swing continuously with load and P-state, by design. A rail that is supposed to move cannot be watched with a fixed threshold, because "the voltage changed" is its normal, healthy state, not a fault. The signal you would most want to watch for a CPU VRM is the one rail you cannot threshold.
    </p>

    <p>
      Second, on many boards the core rail is not even a first-class sensor. It is reported as a bare value with no nominal, or it is not exposed to the BMC at all, which is the only thing an in-band agent can read. You cannot trend what the firmware will not show you.
    </p>

    <p>
      So we said no. Voltage telemetry alone would not have caught that specific VRM degradation. We would rather say that plainly than imply a capability we do not have.
    </p>

    <h2>What we did have, and why it was not enough</h2>

    <p>
      We already ship a rail signal called <code>psu_rail_out_of_spec</code>. It measures point-in-time deviation: how far a rail sits from its nominal right now, as <code>|current - nominal| / nominal</code>. It is useful, and it has scars. The thresholds are where they are because earlier, tighter ones drowned us in false positives: a 2% trip fired constantly, well inside both the ATX plus-or-minus 5% spec band and the plus-or-minus 1 to 2% accuracy floor of a typical BMC sensor. We widened it to tiers (8% high, 5 to 8% medium), carved out a looser band for the plus-5V standby rail (regulated loosely, idles high by design), and excluded CMOS coin-cell sensors entirely after a value-range heuristic once assigned a 3.3V nominal to a healthy 2.5V rail and paged a fake 24% drift.
    </p>

    <p>
      That is texture, not the main act. The main point is what this signal cannot do: it only speaks once a rail is already near or past spec. It says nothing about a healthy-looking rail that is slowly walking somewhere bad. The slow walk is exactly the shape of analog degradation, and it is exactly what we were missing.
    </p>

    <h2>Two signals, both self-baselined</h2>

    <p>
      Rather than build a board-specific MC12-LE0 detector, we built two general signals that catch the class of failure without per-board tuning. Each one judges a host or a rail against its own history, so there are no magic numbers to maintain per platform.
    </p>

    <p>
      The first is <strong>host_instability</strong>, a purely behavioral signal that needs no sensors at all. It reads the snapshot stream itself. A "gap" is a stretch where a host stops reporting for much longer than its own median cadence (ten times the median, floored at 15 minutes, so a quick planned reboot is not a gap). It fires only when a previously-stable host shows two or more gaps clustered in the recent window at a rate well above its own baseline. The reasoning: a board whose power delivery is failing tends to crash, get power-cycled, recover, and repeat before it dies for good. You can see that pattern in the availability timeline even when you cannot see it in the voltage.
    </p>

    <p>
      The second is <strong>psu_rail_voltage_drift</strong>, and it is the one worth slowing down for.
    </p>

    <h2>The technical centerpiece: you cannot alert on "the rail moved"</h2>

    <p>
      The naive version of a drift detector says "warn me when a rail's average moves." On a DVFS rail that fires every time the workload changes. The fix is to measure the move in units of the rail's own noise. <code>psu_rail_voltage_drift</code> compares a rail's mean over the recent window to its mean over its own baseline, expressed in standard deviations of that baseline. A fixed rail that has quietly walked three sigma away from where it has always sat is interesting. A rail that wobbles a volt either way all day, nudged a little, is not.
    </p>

    <p>
      So the trigger has two gates, and a finding has to clear both:
    </p>

    <pre><code>{driftGate}</code></pre>

    <p>
      A rail that swings by design carries a large baseline sigma, so a mean nudge can never clear the three-sigma gate. That is the property that lets the same code watch a flat 12V rail closely while ignoring a busy core rail, with no list of which rails are which. We pinned it with a deliberately nasty test:
    </p>

    <pre><code>{varianceFixture}</code></pre>

    <p>
      A 2.5% mean shift would trip a naive percent threshold. Against the rail's own one-volt noise band it is a third of a sigma, and the signal stays quiet. That is the whole idea in one fixture.
    </p>

    <h2>The backtest, and the part where we had to be honest</h2>

    <p>
      A signal you have not run against real failure data is a hypothesis. We still had the snapshot history for our own validation MC12-LE0, the same board family as the customer's, so we ran the real <code>host_instability</code> code against its real 27-day tape to see what it would have done.
    </p>

    <p>
      It fired. At <code>medium</code>, continuously from May 16 through May 18, on a genuine cluster of multi-hour disappearances (an 11.8-hour gap, a 2.25-hour gap, and a 16-hour gap inside four days). This is the exact text the shipped code produced:
    </p>

    <pre><code>{evidence}</code></pre>

    <p>
      It held quiet on a single 40-minute blip (below the cadence-derived 50-minute gap threshold), only escalated once a second long gap clustered into the trailing three days, and cleared on its own after the box settled. The behavioral mechanics worked exactly as designed. It would have been very easy to stop writing here and call it a receipt.
    </p>

    <p>
      So we checked one more column: <code>uptime_seconds</code>. If those gaps were the VRM crashing and power-cycling the box, uptime would reset to near zero on each recovery. Here is what it actually did across the three gaps:
    </p>

    <pre><code>{uptimeTable}</code></pre>

    <p>
      Uptime climbed by exactly the length of each gap. The box never rebooted. It stayed powered and running the whole time; only the agent or the network stopped reporting. Those gaps were a loss of visibility, not a hardware crash, and definitely not the VRM. Our own MC12-LE0 has zero reboot-gaps in its entire history.
    </p>

    <p>
      So the honest verdict is split. The signal fired on real clustered outages, with real code, on real data. But on this box those outages were the agent or the network dropping out, not the failure we were chasing. We do not have a VRM crash in our own tape, and dressing a reporting outage up as a caught hardware failure would be the same dishonesty as the silent false-negative we wrote about <a href="/blog/we-found-a-security-false-negative-in-our-own-monitoring">last time</a>, just pointed the other way.
    </p>

    <h2>What the backtest actually taught us</h2>

    <p>
      The finding's own wording gave it away: it claimed the gaps "commonly precede a permanent hardware failure." Here the hardware was fine. <code>host_instability</code> does not detect failing hardware; it detects <em>loss of visibility</em>, which is hardware-down or agent-down or network-down. Those are different incidents with different fixes, and the signal as written conflated them.
    </p>

    <p>
      The discriminator is sitting right there in the data, which is the whole point of this post: <code>uptime_seconds</code>. If it resets across the gaps, the box rebooted, and a cluster of reboots on a previously-stable host is the crash-loop that really does precede a dead board. If it climbs straight through, the box stayed up and you have lost a monitoring path, not a machine. Correlating uptime lets the signal say which, instead of guessing the scary one. That is the improvement this backtest surfaced, and it is the next change going into <code>host_instability</code>. And it is not hypothetical: the customer's board did exactly that, crash-looping until the VRM could no longer power it and the motherboard was replaced. We could not watch it happen, because they ran collectd and not us, but a host rebooting its way to a dead board is the case the uptime check is built to confirm, and the opposite of what our own MC12-LE0's reporting gaps turned out to be.
    </p>

    <h2>How these route</h2>

    <p>
      Neither signal pages on a hunch. Both flow through the same pipeline as every other trend warning: severity drives urgency (high notifies, medium is a dashboard signal), and a finding has to persist across two evaluation batches before it can notify at all. A slow voltage drift is the opposite of urgent, so it is deliberately not in the immediate-notify set. The point is graduated confidence, not a louder alarm.
    </p>

    <h2>The honest close</h2>

    <p>
      Voltage alone would not have caught that VCORE VRM, because the rail you need to watch is the one that is supposed to move and is often not even exposed. The behavioral signal catches the consequences of a dying board, the crash-and-recover loop, and once we wire in the uptime check it will be able to tell that loop apart from a host that merely went quiet. The drift signal closes the gap for every fixed rail we can read reliably, by watching each one against its own noise instead of a spec sheet. Two complementary, self-baselined signals beat one board-specific hack.
    </p>

    <p>
      And the part we are proudest of is the part where the backtest fired and we did not take the win. A vendor that checks its own receipts, and tells you when one does not hold, is the only kind you should trust to watch your hardware. The alert rules are public at <a href="/docs/rules">/docs/rules</a>, and if you want more of how the sensors themselves lie to us, that is <a href="/blog/cross-vendor-ipmi-quirks">a whole other post</a>.
    </p>

    <footer class="post-footer">
      <p>Published June 9, 2026. By Simon Rybisar.</p>
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
    font-size: clamp(22px, 2.4vw, 26px);
    font-weight: 600;
    color: var(--text-primary);
    margin: 44px 0 18px;
    letter-spacing: -0.005em;
  }
  .post p {
    font-size: 16px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 18px;
  }
  .post a {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .post a:hover {
    border-bottom-color: var(--accent);
  }
  .post code {
    font-family: var(--font-mono, monospace);
    font-size: 14px;
    background: var(--surface-subtle);
    padding: 2px 6px;
    border-radius: var(--radius-md);
    color: var(--text-primary);
  }
  .post pre {
    margin: 18px 0;
    padding: 16px 20px;
    background: var(--surface-subtle);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    overflow-x: auto;
  }
  .post pre code {
    background: transparent;
    padding: 0;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .post em {
    font-style: italic;
    color: var(--text-primary);
  }
  .post strong {
    color: var(--text-primary);
    font-weight: 600;
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
