<svelte:head>
  <title>SMART said PASSED. The drive had 477 dead sectors. - Glassmkr Blog</title>
  <meta name="description" content="We ran a drive-health campaign across thirteen boxes to find out whether early warning actually works. One drive had 477 reallocated sectors and reported its own health as PASSED in every single reading. Here is what we measured, including the parts that argue against us." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/smart-said-passed" />
  <meta property="og:title" content="SMART said PASSED. The drive had 477 dead sectors." />
  <meta property="og:description" content="A drive with 477 reallocated sectors reported its own health as PASSED in all 140 readings we took. A full write-and-verify pass over that same drive came back clean. Here is what a monitoring product can see that the drive will not tell you." />
  <meta property="og:image" content="https://glassmkr.com/og/smart-said-passed.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="SMART said PASSED. The drive had 477 dead sectors." />
  <meta name="twitter:description" content="The drive's own self-assessment said it was healthy. It had 477 reallocated sectors. We spent two weeks measuring exactly how far apart those two facts can sit." />
  <meta name="twitter:image" content="https://glassmkr.com/og/smart-said-passed.png?v=20260830" />
  <link rel="canonical" href="https://glassmkr.com/blog/smart-said-passed" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "SMART said PASSED. The drive had 477 dead sectors.",
    description: "A drive-health campaign across thirteen boxes: one drive with 477 reallocated sectors reported PASSED in all 140 readings, a full write-and-verify pass over it came back clean, and pending sectors oscillated while reallocated stayed flat.",
    image: "https://glassmkr.com/og/smart-said-passed.png?v=20260830",
    datePublished: "2026-08-02",
    dateModified: "2026-08-02",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/smart-said-passed.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/smart-said-passed",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "SMART said PASSED. The drive had 477 dead sectors.", item: "https://glassmkr.com/blog/smart-said-passed" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
  <img class="post-hero" src="/og/smart-said-passed.png?v=20260830" alt="Glassmkr blog card with the hexagon logo and the title SMART said PASSED. The drive had 477 dead sectors." width="1200" height="630" loading="eager" decoding="async" />
    <header class="post-header">
      <p class="post-meta">August 2026 · Engineering · 7 min read</p>
      <h1>SMART said PASSED. The drive had 477 dead sectors.</h1>
      <p class="lede">
        Every hard drive carries a self-assessment: one bit that says healthy or failing. It is the field most monitoring
        setups check, because it is the one the drive volunteers. We spent two weeks measuring how far that bit can sit
        from the raw counters underneath it. On one drive the answer was 477 retired sectors and a pending count swinging
        up to 96, with the bit reading PASSED throughout.
      </p>
    </header>

    <h2>What we set out to test</h2>
    <p>
      Glassmkr exists on a claim: that we can tell you a drive is going before it takes your data with it. That is an easy
      claim to make and an uncomfortable one to check, because checking it honestly means finding out whether your own
      product is mostly theatre.
    </p>
    <p>
      So we built a fleet to find out. Thirteen boxes of real spinning rust, most of them years into service. Three of
      them we designated as expendable and abused deliberately. The rest we left alone as a control group, because a
      detector that fires on everything is not a detector.
    </p>

    <h2>The catch</h2>
    <p>
      One drive, a 4 TB HGST at just over 38,000 power-on hours, was carrying 477 reallocated sectors. A reallocated
      sector is one the drive has given up on and silently swapped for a spare from a small reserve pool. Four hundred and
      seventy-seven of them is not a rough patch. It is a drive working through its reserve.
    </p>
    <p>
      Glassmkr raised a critical alert on it. What makes that worth writing about is what the drive itself was saying at
      the same moment:
    </p>
    <pre><code>serial V6G97HRR   reallocated 477   health PASSED</code></pre>
    <p>
      <strong>PASSED.</strong> Not in one unlucky reading: in <strong>all 140 readings</strong> we logged for that drive.
      Not once, across the entire campaign, did its own self-assessment admit anything was wrong. As of publication it is
      still saying PASSED, still at 477, some eleven days after we first looked.
    </p>
    <p>
      The other twelve campaign boxes produced no drive alert at all, and that negative result matters as much as the
      positive one. Widen the lens to the whole fleet we monitor, 21 hosts and 87 drives at the time of writing, and this
      is still the only drive raising a SMART failure. One true positive, everything else quiet. A detector that finds
      the bad drive and stays silent about the other 86 is the only kind worth running.
    </p>

    <h2>Why the health bit is like this</h2>
    <p>
      This is not a bug in the drive, and the drive is not lying. The overall-health verdict is a pass or fail against
      <em>normalized</em> attribute values, not against the raw counts an operator reads. Every SMART attribute carries
      both. The raw value is the physical count: 477 sectors. The normalized value is a vendor-scaled score, typically
      starting near 100 and falling as the attribute worsens, and the drive reports FAILED only when that score drops to
      the vendor's threshold.
    </p>
    <p>
      Those thresholds are set where the manufacturer expects imminent, warranty-relevant death, and on a 4 TB drive the
      spare sector pool is large enough that 477 retired sectors barely moves the score. So the raw count sat at a number
      any operator would act on immediately, while the normalized score stayed comfortably in passing territory. Both
      facts are true at once, and the verdict is behaving exactly as specified.
    </p>
    <p>
      The bit is doing its job. Its job is simply not the job people use it for. It answers "has this drive crossed the
      manufacturer's replace-under-warranty line", and it gets read as "is this drive fine". The mistake is not that the
      firmware got it wrong. The mistake is trusting a one-bit verdict instead of reading the raw attributes underneath
      it.
    </p>

    <h2>The same drive passed a full surface test</h2>
    <p>
      Here is the part that surprised us. We ran a complete destructive write-and-verify pass over that drive: write every
      sector, read it all back, compare. If 477 sectors are dead, a full surface test should notice.
    </p>
    <p>
      It came back clean. Zero errors.
    </p>
    <p>
      That is correct behavior, and it is the whole problem. Reallocation is the drive <em>hiding</em> the damage: the bad
      sector is retired, a spare is mapped in its place, and every read and write after that is served by good media. From
      the operating system's point of view nothing happened. The host-visible IO path is clean precisely because the drive
      is spending its reserve to keep it clean.
    </p>
    <p>
      So two independent checks both came back clean, and neither was wrong. The health verdict truthfully reported that
      no normalized attribute had crossed its threshold. The surface test truthfully reported that every sector it
      touched read back correctly. Both answered the question they were asked. Neither was asked "how much of this
      drive has already been retired", and the only place that answer exists is the raw attribute counter, visible only
      to something watching it over time.
    </p>

    <h2>The part that should end the argument: pending sectors</h2>
    <p>
      If the 477 does not move you, this should. Pending sectors, SMART attribute 197, are sectors the drive has found
      suspect and has not yet been able to retire. A non-zero pending count is the one reading that even operators who
      trust the health verdict treat as replace-this-now: it means there is data the drive currently cannot read
      reliably.
    </p>
    <p>
      Across our 140 readings of that drive, all three series at once:
    </p>
    <figure class="chart-figure">
      <div class="chart-scroll">
        <img
          src="/blog/smart-said-passed-trajectory.png?v=3"
          alt="Chart of one drive across 140 readings. A green band across the top shows overall health reporting PASSED in every reading. A flat dashed line marks reallocated sectors at 477, unchanged throughout. Below, the pending sector count opens at its maximum of 96, drains to zero over about two days, and after a 5.17 day gap in monitoring rises from zero three more times, peaking at 16, 32 and 16."
          width="1464"
          height="792"
          loading="eager"
          decoding="async"
        />
      </div>
      <figcaption>
        Reading the rows: <strong>health</strong> is the drive's own PASSED or FAILED verdict.
        <strong>attr 5</strong> is reallocated sectors, drawn on its own scale because 477 will not share an
        axis with a count that peaks at 96. <strong>attr 197</strong> is pending sectors, the series that
        moves. One drive, one continuous record: the break in the horizontal axis is a gap in our polling,
        not a second drive.
      </figcaption>
    </figure>
    <p>
      When we started watching, the count was already at <strong>96</strong> and took about two days to drain to zero.
      Later in the window it rose from zero three more times, peaking at 16, then 32, then 16, all inside twenty hours.
      In total <strong>89 of the 140 readings</strong> had pending sectors above zero. At no point during any of that did
      the overall-health verdict stop saying PASSED. This is the hard version of the finding, and it does not depend on
      anyone agreeing that 477 is alarming: the drive was repeatedly unable to read its own sectors, and its
      self-assessment reported healthy throughout.
    </p>
    <p>
      There is a second lesson buried in the same data, and it is why we do not alert on pending. The counter is
      <em>supposed</em> to move: the drive finds a suspect sector, retries it later, and either clears it or retires it.
      An alert keyed on pending would have fired and self-cleared several times in a little over a week on this one
      drive, and nobody keeps reading an alert that does that. So we anchor the critical on reallocated sectors, which
      only ever go up, and on the drive's own failing verdict. We considered pending as a trigger and the data talked us
      out of it, while that same data made the case above.
    </p>

    <h2>We tried to kill four healthy drives and could not</h2>
    <p>
      The other half of the campaign was an attempt to manufacture a failure, so we would have more than one bad drive to
      learn from. We took drives with roughly 59,000 power-on hours, which is about six and a half years of continuous
      service, and hammered them.
    </p>
    <p>
      Two days of continuous random writes produced nothing. Eight of the nine drives under stress finished with exactly
      zero reallocated and zero pending sectors, jobs completing normally throughout. Then full write-and-verify passes
      over four of them, several hours each, every sector written and read back: zero errors, zero new defects, all four
      still reporting clean afterwards.
    </p>
    <p>
      We could not break them, and the failure of that experiment is itself a finding. Reallocations track latent media
      defects, not how hard you have been writing. Write volume is not the driver, which means "this drive has had a heavy
      workload" is not a risk signal, and the only drive that produced new defects was the one that was already marginal.
    </p>

    <h2>What we are not claiming</h2>
    <p>
      One failing drive is a demonstration, not a dataset, and we would rather say so than dress it up.
    </p>
    <p>
      We found exactly one bad drive, and we found it already at 477. We did not watch it climb from zero, so we cannot
      tell you what number is worth worrying about. Is a drive at 3 reallocated sectors in trouble, or is it fine for
      another four years? Our campaign cannot answer that, and any threshold we published off a single drive would be an
      invention with a number attached to it.
    </p>
    <p>
      That has a concrete consequence for the product. We considered splitting the alert so that a low, stable reallocated
      count became a quieter advisory rather than a critical. We are not shipping that yet, because we cannot calibrate
      where "low" ends, and the two ways of being wrong are not equally bad. Telling you to investigate a drive that is
      actually dying costs you data. Paging you about a drive that turns out to be stable costs you a ticket. Until we can
      draw that line from real failures rather than from one anecdote, reallocated sectors stay critical.
    </p>

    <h2>What to take from this</h2>
    <p>
      If you run bare metal, the useful conclusions are cheap to act on:
    </p>
    <ul>
      <li>
        <strong>Do not read the overall-health verdict as a health check.</strong> It is a normalized-threshold test with
        a warranty question behind it. A drive can be deep into its spare sector pool, and intermittently unable to read
        its own sectors, and still report PASSED. Ours did, in every reading.
      </li>
      <li>
        <strong>Read the raw attributes, and read them over time.</strong> This is the one rule that needs no threshold
        and no failure statistics, so it is the one we can hand you with a straight face: a single reading tells you
        almost nothing, and the same counters read weekly tell you nearly everything. Trajectory is the signal. The
        verdict is not.
      </li>
      <li>
        <strong>Alert on the counter that latches, and only that one.</strong> Reallocated sectors only ever go up:
        once a drive retires a sector it does not un-retire it, and ours sat at exactly 477 in all 140 readings. That
        makes it safe to page on. Pending sectors are the opposite, oscillating by design, and ours swung between 0 and
        96 while the actual damage never changed, so read them as evidence rather than wiring them to a pager. Offline
        uncorrectable sectors, attribute 198, behave more like pending than like reallocated: they can clear too, so do
        not assume they latch.
      </li>
      <li>
        <strong>A clean surface test does not clear a drive.</strong> Reallocation exists to make the damage invisible to
        exactly that test.
      </li>
      <li>
        <strong>A raw count needs interpreting in both directions.</strong> The drive above is the alarming version:
        477 retired sectors under a PASSED verdict. Another drive in the same fleet is the mirror image, sitting at 138
        interface CRC errors with zero reallocated sectors and, yes, also a PASSED verdict. Attribute 199 counts errors
        on the cable and backplane between controller and drive, not on the media, so that second drive is fine and
        replacing it would fix nothing; the thing to reseat is the cable. Same verdict on both drives, opposite
        realities, and the verdict distinguished neither. Only the raw attributes did.
      </li>
    </ul>
    <p>
      Glassmkr does this watching for you, which is why the drive above raised a critical alert on the raw counts while
      its own verdict, correctly and unhelpfully, still read PASSED. But none of the findings here depend on our product.
      They are properties of the drives you already own, and the counters are there whether or not anything is reading
      them.
    </p>
    <p>
      <a href="/docs">Read the docs</a> or <a href="/">see how Glassmkr works</a>.
    </p>
  </article>
</div>

<style>
  .post-hero { display:block; width:100%; height:auto; aspect-ratio:1200/630;
    border-radius:6px; border:1px solid var(--surface-border);
    margin:24px 0 20px; background:var(--surface-raised); }
  .post {
    padding: 56px 0 80px;
  }
  .chart-figure {
    margin: 30px 0 26px;
  }
  /* The chart is 1600px of dense data. Scaling it to a 375px phone makes the
     axis labels unreadable, so below the breakpoint it keeps a legible width
     and scrolls horizontally inside its own box instead. The page body never
     scrolls sideways. */
  .chart-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface-raised);
  }
  .chart-scroll img {
    display: block;
    width: 100%;
    height: auto;
  }
  @media (max-width: 760px) {
    .chart-scroll img {
      width: 680px;
      max-width: none;
    }
  }
  .chart-figure figcaption {
    margin: 12px 2px 0;
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--text-muted, #8B94A2);
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
  .post ul {
    margin: 0 0 18px;
    padding-left: 22px;
  }
  .post li {
    font-size: 16px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 10px;
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
