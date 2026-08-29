<script>
  // Code samples are held as strings and interpolated into <pre><code>{...}</code></pre>
  // so Svelte does not try to parse the braces, arrows or angle brackets inside them.
  const dnfTest = `// crucible/src/collect/__tests__/security.test.ts
it("download-only timer => configured: false", async () => {
  // dnf-automatic.timer is enabled, but /etc/dnf/automatic.conf has
  // apply_updates = no: it fetches patches and never installs them.
  const r = await checkAutoUpdates(fakeRun({ downloadTimer: true, applyYes: false }));
  expect(r.auto_updates.mechanism).toBe("dnf-automatic");
  expect(r.auto_updates.configured).toBe(false); // un-suppresses pending_security_updates
});`;

  const cpuTest = `// apps/dashboard/.../alerts/__tests__/evaluator.test.ts
// warning = upper_critical - 15 ; critical = upper_critical - 5
it("81C with uc=85: critical (uc - 5 = 80)", () => {
  s.ipmi.sensors = [cpu(81, /* upper_critical */ 85)];
  expect(alertsOf("cpu_temperature_high", s)[0].severity).toBe("critical");
});
it("83C without upper_critical: warning (fallback 80C)", () => {
  s.ipmi.sensors = [cpu(83)];
  expect(alertsOf("cpu_temperature_high", s)[0].severity).toBe("warning");
});`;

  const bolaTest = `// apps/dashboard/.../servers/[id]/__tests__/security.test.ts
it("returns 404 (not 403) when the server belongs to another customer", async () => {
  setQueries([{ rows: [] }]); // ownership check finds nothing for this customer
  const err = await getServer("srv_belonging_to_someone_else");
  expect(err.status).toBe(404); // a 403 would confirm the row exists
});`;

  const psuTest = `// crucible/src/lib/__tests__/vendor-sensors.test.ts
it("matches PS<N> with space OR underscore, across vendors", () => {
  // Fleet data: Supermicro H12SST and Dell iDRAC emit "PS1 Status";
  // Gigabyte boards emit "PS1_Status".
  expect(isPsuSensor("PS1 Status", "supermicro")).toBe(true);
  expect(isPsuSensor("PS1_Status", "supermicro")).toBe(true); // Gigabyte BMC on a Supermicro-DMI box
  expect(isPsuSensor("PS Redundancy", "dell")).toBe(false);   // not an individual PSU
});`;
</script>

<svelte:head>
  <title>What our test suite looks like, and why - Glassmkr Blog</title>
  <meta name="description" content="Four tests from the code that runs Glassmkr, and the incident that put each one there: a suppressed security alert, a context-dependent temperature threshold, a 404-not-403 tenancy check, and a power-supply sensor name captured from a real BMC. A test suite as a map of what has hurt you." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/what-our-test-suite-looks-like" />
  <meta property="og:title" content="What our test suite looks like, and why" />
  <meta property="og:description" content="Four real tests, four real incidents. A suppressed security alert, a temperature threshold that means different things on different boards, a 404 that has to stay a 404, and a power-supply name captured from a lying BMC." />
  <meta property="og:image" content="https://glassmkr.com/og/what-our-test-suite-looks-like.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="What our test suite looks like, and why" />
  <meta name="twitter:description" content="The shape of a test suite is a map of what has hurt you. Four tests from Glassmkr, and the incidents that put them there." />
  <meta name="twitter:image" content="https://glassmkr.com/og/what-our-test-suite-looks-like.png?v=20260826" />
  <link rel="canonical" href="https://glassmkr.com/blog/what-our-test-suite-looks-like" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "What our test suite looks like, and why",
    description: "Four tests from the code that runs Glassmkr, and the incident that put each one there. A test suite as a map of what has hurt you.",
    image: "https://glassmkr.com/og/what-our-test-suite-looks-like.png?v=20260826",
    datePublished: "2026-06-03",
    dateModified: "2026-06-03",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/what-our-test-suite-looks-like.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/what-our-test-suite-looks-like",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "What our test suite looks like", item: "https://glassmkr.com/blog/what-our-test-suite-looks-like" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">June 2026 · Engineering · 8 min read</p>
      <h1>What our test suite looks like, and why.</h1>
      <p class="lede">
        Here are four tests from the code that runs Glassmkr, and the specific thing that went wrong to put each one there. None of them exist to hit a coverage number. Each is here because something broke, usually on our own hardware, and we did not want it to break the same way twice.
      </p>
    </header>

    <h2>1. The test that exists because we hid real security alerts</h2>

    <p>
      This one is short, and it exists because we shipped a bug.
    </p>

    <pre><code>{dnfTest}</code></pre>

    <p>
      For a while, the agent treated any enabled <code>dnf-automatic</code> timer as "automatic updates are configured". That sounds reasonable until you know that <code>dnf-automatic</code> ships timers that only ever <em>download</em> updates and never apply them. A RHEL-family box running one of those is not patching itself; it is filling a cache. We counted it as patched anyway, which means we suppressed the <code>pending_security_updates</code> alert on exactly the hosts that most needed it.
    </p>

    <p>
      A Rocky Linux 9.6 box on our own validation fleet sat with 26 pending security updates, one of them rated Critical, while our dashboard showed it as healthy. We found it by dogfooding, not because a customer complained, and we wrote the whole thing up in <a href="/blog/we-found-a-security-false-negative-in-our-own-monitoring">a separate post</a>. The fix shipped in agent 0.13.6. The test above is what is left of it: given a download-only timer, <code>configured</code> must be false, which un-suppresses the alert. It fails loudly if anyone ever reintroduces the original assumption.
    </p>

    <h2>2. The test where 81 °C is critical but 83 °C is fine</h2>

    <p>
      A monitoring rule is not just a threshold. It is a threshold and a severity, and both have to be right. This pair pins a case that looks, at first glance, like a contradiction:
    </p>

    <pre><code>{cpuTest}</code></pre>

    <p>
      81 °C trips critical; 83 °C, two degrees hotter, is only a warning. That is correct. The first board's BMC reports its own upper-critical limit at 85 °C, so 81 °C is five degrees from the edge and genuinely alarming. The second board does not report a limit at all, so we fall back to a fixed 80 °C threshold and a softer reading. A flat "alert at 85 °C everywhere" would have been wrong in both directions: too jumpy on the board that runs hot by design, too quiet on the one that stays silent about its limits.
    </p>

    <p>
      The rule derives its thresholds from each board's BMC-reported <code>upper_critical</code> (warning at the limit minus 15, critical at the limit minus 5). The tests exist because an earlier version did not do that, and worse, matched voltage rails by name, a rail like <code>CPU_VDDCR0</code> with an upper-critical of 1.6 V, and ran it through the temperature formula: it subtracted 5 and fired "critical" on essentially any reading. The fix both filtered sensors by type and made the thresholds relative; these cases lock the behavior in so neither half regresses.
    </p>

    <h2>3. The test that insists on 404, not 403</h2>

    <pre><code>{bolaTest}</code></pre>

    <p>
      The important character here is the status code. When customer A asks for customer B's server by ID, the obvious response is 403 Forbidden. We return 404 Not Found, and there is a test that fails if anyone "tidies" it into a 403. A 403 confirms the row exists; it tells a prober they have guessed a real server ID belonging to someone else. A 404 says nothing at all. On a multi-tenant boundary, the distance between "wrong" and "leaks" is one status code.
    </p>

    <p>
      An honest admission: this suite overlaps with our auth-middleware tests on purpose. The middleware is already supposed to enforce ownership, and we test the endpoints again anyway. On a boundary where a bug is a breach rather than a wrong number, we trust belt and braces over trusting ourselves.
    </p>

    <h2>4. The test that just writes down what a real BMC said</h2>

    <p>
      Most of our tests are not dramatic. The majority look like this:
    </p>

    <pre><code>{psuTest}</code></pre>

    <p>
      There is no clever logic here. It is a record of the exact strings real power-supply sensors emit on real boards, captured from the fleet. Supermicro and Dell write <code>PS1 Status</code> with a space; Gigabyte writes <code>PS1_Status</code> with an underscore. An earlier matcher only accepted the underscore form for Dell, which means we would have silently missed a failed PSU on the others.
    </p>

    <p>
      The comment on one line is the whole reason cross-vendor monitoring is hard: <code>Gigabyte BMC on a Supermicro-DMI box</code>. That machine's chassis reports its vendor as Supermicro, but the BMC firmware inside is Gigabyte, so the sensor names follow Gigabyte's convention while every other signal says Supermicro. We told that story at length in <a href="/blog/cross-vendor-ipmi-quirks">cross-vendor IPMI quirks</a>; this test is how we make sure we never regress on it.
    </p>

    <p>
      These are the ugly tests. There are dozens of them, each pinned to a literal string some board produced once, and they will never be finished, because every new motherboard generation invents a fresh way to format the same fact. We have made peace with that.
    </p>

    <h2>What the shape tells you</h2>

    <p>
      Step back from the individual tests and a structure appears. The dashboard has 79 test files and roughly 16,000 lines of test code; 21 of those files exist only for the alert evaluator. The agent has more than 400 tests across 26 files, and the large majority are parsers fed real captured output. Sorted by what they actually protect, almost everything falls into three piles:
    </p>

    <p>
      <strong>Parsing input we do not control.</strong> The agent reads <code>ipmitool</code>, <code>smartctl</code>, <code>nvidia-smi</code>, <code>/proc</code>, <code>dmesg</code> and <code>systemctl</code>, across vendors, firmware revisions and six Linux distributions. A wrong parse is a wrong reading is a wrong alert. This is the biggest pile by far.
    </p>

    <p>
      <strong>The correctness of a decision.</strong> Every alert rule is pinned to its threshold and its severity, because a false negative is a missed outage and a false positive is alert fatigue, and both quietly cost you the customer's trust.
    </p>

    <p>
      <strong>The security boundary.</strong> Multi-tenancy, where a bug is a breach rather than a glitch. Belt and braces, as above.
    </p>

    <p>
      And an admission to go with the count: some of these are slow. The integration tests stand up real Postgres and ClickHouse instances, and we have looked at deleting them more than once to speed up CI. We keep them, because the last few times we trusted a mocked query over a real one, the bug was hiding in the part the mock pretended away.
    </p>

    <h2>Where we have no tests at all</h2>

    <p>
      This website, the one you are reading, has zero tests. Around 17,000 lines of Svelte and not a single test file. That is also deliberate.
    </p>

    <p>
      The worst-case failure on the marketing site is that it looks wrong for an hour while we fix it. The worst-case failure on the alert engine is that a customer's outage does not fire, or one customer sees another's. Those are not the same kind of risk, so they do not get the same kind of investment. A test suite is a budget, and we spend it where being wrong is expensive.
    </p>

    <h2>Tests are scar tissue</h2>

    <p>
      Scar tissue is not decorative, and it is not a trophy. It is the body's way of making sure the same injury does no further damage the second time. That is exactly what a regression test is: the functional residue of something that already went wrong, left in place so it cannot go wrong the same way again.
    </p>

    <p>
      Which is why the shape of a test suite tells you more than the shape of the code. The code describes what a system is meant to do. The tests describe what has actually happened to it. You can read someone's test suite and tell what their incidents looked like.
    </p>

    <p>
      Here is ours. If you would rather see the result than the tests, the <a href="/docs">documentation</a> covers what we monitor, and there is a <a href="https://app.glassmkr.com/demo">live demo</a> running against an anonymised sample fleet.
    </p>

    <footer class="post-footer">
      <p>Published June 3, 2026. By Simon Rybisar.</p>
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
    /* Soft-wrap long lines (trailing comments, descriptive test names)
       instead of showing a horizontal scrollbar. pre-wrap keeps the
       leading indentation; wrapping happens at spaces. */
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  .post pre code {
    background: transparent;
    padding: 0;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .post strong {
    color: var(--text-primary);
    font-weight: 600;
  }
  .post em {
    color: var(--text-primary);
    font-style: italic;
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
