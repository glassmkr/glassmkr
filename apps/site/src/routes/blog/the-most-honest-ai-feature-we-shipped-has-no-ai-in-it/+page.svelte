<svelte:head>
  <title>The most honest AI feature we shipped has no AI in it - Glassmkr Blog</title>
  <meta name="description" content="We built the self-hosted-Gemma path for our ticket-draft feature, A/B'd it against a plain template on a live degraded-array alert, and shipped the template. The model was fine. Fine did not justify 22 seconds and a hallucination surface. What we kept, what we cut, and why." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/the-most-honest-ai-feature-we-shipped-has-no-ai-in-it" />
  <meta property="og:title" content="The most honest AI feature we shipped has no AI in it" />
  <meta property="og:description" content="We built the AI path for our ticket-draft feature, measured it against a plain template on a live alert, and turned it off. The model was fine. Fine did not earn 22 seconds and a hallucination surface." />
  <meta property="og:image" content="https://glassmkr.com/og/the-most-honest-ai-feature-we-shipped-has-no-ai-in-it.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="The most honest AI feature we shipped has no AI in it" />
  <meta name="twitter:description" content="We built the AI path, measured it against a template on a live alert, and shipped the template. The model was fine. Fine did not earn 22 seconds." />
  <meta name="twitter:image" content="https://glassmkr.com/og/the-most-honest-ai-feature-we-shipped-has-no-ai-in-it.png?v=20260830" />
  <link rel="canonical" href="https://glassmkr.com/blog/the-most-honest-ai-feature-we-shipped-has-no-ai-in-it" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "The most honest AI feature we shipped has no AI in it",
    description: "We built the self-hosted-Gemma path for our ticket-draft feature, A/B'd it against a plain template on a live degraded-array alert, and shipped the template.",
    image: "https://glassmkr.com/og/the-most-honest-ai-feature-we-shipped-has-no-ai-in-it.png?v=20260830",
    datePublished: "2026-06-21",
    dateModified: "2026-06-21",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/the-most-honest-ai-feature-we-shipped-has-no-ai-in-it.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/the-most-honest-ai-feature-we-shipped-has-no-ai-in-it",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "The most honest AI feature we shipped has no AI in it", item: "https://glassmkr.com/blog/the-most-honest-ai-feature-we-shipped-has-no-ai-in-it" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">June 2026 · Engineering · 6 min read</p>
      <h1>The most honest AI feature we shipped has no AI in it.</h1>
      <p class="lede">
        We built a self-hosted model into a feature, measured it against a plain template on a real alert, and turned the model off. The interesting part was the measurement, not the model.
      </p>
    </header>

    <p>
      A disk starts to fail. Crucible catches it: SMART reports a pending sector on <code>/dev/sdb</code>, and the alert fires. If you own the box, you swap the drive. If you rent it, you file a ticket with your provider, and that ticket is the boring, error-prone part: dig out the serial, the model, the exact attribute that tripped, when it started, paste it into a portal, and write the polite ask. So we added a button: Generate ticket draft. It writes that message for you. Then you read it, edit it, and send it yourself.
    </p>

    <p>
      The part worth a blog post is what is behind the button, because it is not what you would guess.
    </p>

    <h2>We reached for the model first</h2>

    <p>
      The obvious build is to feed the alert to a model and get a ticket back. We already run a self-hosted Gemma for other features, so it was right there. We built it properly, with a real hallucination guard, because a hardware RMA hinges on one string being exactly right, and a model that "writes your ticket" is one hallucinated character away from sending your provider the wrong drive's serial.
    </p>

    <p>So we never let the model touch the facts. The draft is assembled in two layers:</p>

    <ul>
      <li>A fact block, printed verbatim by our server from the alert's structured data: server name, hardware model, drive serial, firmware, the SMART attribute that tripped and its value, and when it was first seen.</li>
      <li>Four short prose segments (opening, impact, the ask, closing) that the model writes, told explicitly not to restate any identifier. Any segment that comes back carrying a long digit or hex run, a serial or a raw value leaking into the prose, is dropped and replaced with the template wording.</li>
    </ul>

    <p>
      We wrote a test that feeds the model a deliberately wrong serial in its prose and asserts the real one is what lands in the draft. The guard holds. And then we asked the question we should ask more often: is the model actually making this better?
    </p>

    <h2>Then we measured it</h2>

    <p>
      We pointed both paths at a real degraded-array alert, a Crucial MX500 that had dropped out of a RAID1 mirror, and captured both drafts. The fact block was byte-identical in both, because the server injects it, not the model: same device, same model, same serial, same failed-member line. The only thing that differed was the four lines of connective prose.
    </p>

    <p>The template named the fault and asked for the specific action:</p>

    <pre><code>Monitoring on the server identified below reports a degraded RAID array.
...
Please identify and replace the failed member disk so the array can
rebuild, or dispatch a remote-hands technician.</code></pre>

    <p>Gemma's draft was courteous and correct, just a little softer:</p>

    <pre><code>Monitoring has detected a likely hardware fault on the server identified below.
...
Please inspect the hardware and replace the failed drive to restore the
array to a healthy state.</code></pre>

    <p>
      Be fair to the model, because the honest version of this post depends on it: that is a perfectly sendable ticket. It is not word salad, and it did not hallucinate a serial. Put the two side by side, though, and the template is the better ticket by a hair. It names the fault in the opening instead of "a likely hardware fault," and it keeps the remote-hands option that Gemma quietly dropped. The model did not write a worse ticket. It wrote an equal one, slightly vaguer, missing one useful line. And it took 22 seconds to do it.
    </p>

    <p>
      "Equal" is the damning verdict, not the flattering one. The set of provider-facing hardware faults is small and formulaic: a failing drive, a degraded array, an ECC storm, a dead PSU rail, maybe a dozen in all, and the right thing to say about each barely changes between incidents. A per-type template written once, carefully, by someone who knows what a provider needs to act, matches what the model improvises every time, minus the wait and minus the risk. The model's freedom to phrase it differently was not a feature here, because there was nothing useful to vary.
    </p>

    <h2>The value was never the prose</h2>

    <p>
      Strip the feature down and <strong>the model was the least valuable layer</strong>. The parts that actually save you time at 2 a.m. are three, and none of them is the writing:
    </p>

    <ul>
      <li>Gating: knowing that this alert is a physical fault you escalate to a provider, and that a CPU-temperature spike under load is not. That is a classification we already do, keyed to the same ownership note the rest of the product uses.</li>
      <li>Fact extraction: pulling the serial, the firmware, and the exact attribute that tripped out of the snapshot, verbatim, so you are not squinting at <code>smartctl</code> output at midnight.</li>
      <li>Assembly: laying it out as a clean, paste-ready ticket with no branding to strip.</li>
    </ul>

    <p>
      None of those need a model. They need domain knowledge and careful plumbing. Once we saw that, keeping the model in the hot path was just latency and a hallucination surface we had to guard, paid for at the exact moment, an incident, when you least want a flaky dependency. In our capture the model took 22 seconds to return: 22 seconds of a spinner while an operator is staring at a failing drive, for prose the template produces in single-digit milliseconds. So we took it out of the path.
    </p>

    <h2>Refusing to ship AI that does not help</h2>

    <p>
      There is pressure to put "AI" on every feature. We feel it too. The discipline we are trying to hold is to use a model where it earns its place and a template where it does not, and to be able to show the measurement either way. This feature is where the measurement said no.
    </p>

    <p>
      That is the same stance the rest of the product takes, and it is why we keep a <a href="/trust">trust page</a> rather than a list of adjectives. We would rather tell you what a feature does not do than imply it does more than it does. An AI label on this button would have been a claim we could not stand behind: the model was in the loop, it was slower, and it added a way to be wrong, for output a reader could not tell apart from the template. Shipping the template was not us giving up on AI. It was us refusing to ship AI that did not help.
    </p>

    <p>
      The model is not deleted. The Gemma path is still in the tree, wired and tested, behind a flag that is off in production. There is a plausible future case for it, a single message that has to synthesize several correlated alerts across one host, where the prose genuinely has to vary and a template would flatten it. The day that case is real, we turn the flag on, measure it the same way, and keep it only if it earns the wait. Until then it sits in the off position.
    </p>

    <h2>It drafts, it does not send</h2>

    <p>
      The button is "Generate ticket draft," not "Send to provider." Glassmkr does not contact your provider. The draft opens in an editable box; you review it, change anything, copy it, and send it through your own provider channel. The copied text is a clean ticket with no Glassmkr branding and nothing to strip. We are not in the loop between you and your vendor, and template-only makes that even plainer: there is no model output between your data and your clipboard at all.
    </p>

    <h2>A worked example</h2>

    <p>
      Here is the actual draft the shipped template path produces, for a second MX500 on the same box, the one that flagged a pending sector. SMART health still passes and nothing has reallocated yet, but a Current Pending Sector has been flickering between 0 and 1 for weeks: early-stage degradation, the kind you want to flag to your provider before it becomes an outage. Verbatim output, with the host and serial anonymized:
    </p>

    <pre><code>Subject: Hardware fault on web-fra1-02 (X11SCA-F): failing drive (SMART)

Monitoring on the server identified below has detected SMART indicators
of a failing drive.

Detected hardware details:
----------------------------------------
Server name: web-fra1-02
Server IP: 203.0.113.40
Hardware vendor: Supermicro
Hardware model: X11SCA-F
Operating system: Debian 12
Alert: SMART pending sector on /dev/sdb
Severity: warning
Device: /dev/sdb
Drive model: CT500MX500SSD1
Serial number: 2148E2F1A3C7
Firmware: M3CR046
SMART health: PASSED
Reallocated sectors: 0
Pending sectors: 1
----------------------------------------

Pending or reallocated sectors are an early sign of media failure; the
drive is at elevated risk of data loss or sudden failure and should be
inspected or replaced before it degrades further.

Please inspect the drive listed above and replace it if confirmed
failing, or dispatch a remote-hands technician to do so.

The full diagnostic report can be provided on request (command:
smartctl -a /dev/sdb).

Thank you for your help.</code></pre>

    <p>
      Every fact in that block is your telemetry, printed verbatim. The serial above is synthesized for this post; in a real draft it is the serial the drive reported. The prose around the facts is the template, the same four segments the model was asked to write and did not improve on.
    </p>

    <h2>What we will keep telling you</h2>

    <p>
      We will keep telling you what the AI is doing and what it is not. Sometimes what it is not doing is anything at all, because the honest version of the feature did not need it. Here, nothing is invented and nothing is phoned to your vendor. It is the typing you did not want to do, from your own data, with the model we built for it sitting quietly in the off position until it has something to add.
    </p>

    <p>
      More on how Glassmkr thinks about this: <a href="/trust">our trust page</a>, or <a href="/blog/introducing-furnace">Furnace, the AI assistant that helps you fix alerts</a>, where the model did earn its place.
    </p>

    <footer class="post-footer">
      <p>Published June 21, 2026. By Simon Rybisar.</p>
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
