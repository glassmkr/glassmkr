<svelte:head>
  <title>Same model, same server, opposite result: the half of agent testing everyone forgets - Glassmkr Blog</title>
  <meta name="description" content="We gave nine open-weight models root on real broken servers and graded every claim against the machine, not the model's own report. The strongest predictor of success was not model size; it was whether our test harness matched how the model was trained." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/open-model-ladder-blind-remediation" />
  <meta property="og:title" content="Same model, same server, opposite result: the half of agent testing everyone forgets" />
  <meta property="og:description" content="A ladder of open-weight models, real broken servers, and a read-only key that returns 403 on any write. Graded on the box, the thing that most decided success was not size. It was whether the harness matched how the model was trained." />
  <meta property="og:image" content="https://glassmkr.com/og/open-model-ladder-blind-remediation.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Same model, same server, opposite result" />
  <meta name="twitter:description" content="Nine open-weight models given root on real broken servers, graded on the box. North scores 0 in a plain-text harness and 7 with tools; Phi-4 is the mirror. The scaffold has to match how the model was trained." />
  <meta name="twitter:image" content="https://glassmkr.com/og/open-model-ladder-blind-remediation.png?v=20260830" />
  <link rel="canonical" href="https://glassmkr.com/blog/open-model-ladder-blind-remediation" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Same model, same server, opposite result: the half of agent testing everyone forgets",
    description: "A standing blind-remediation exercise across nine open-weight models on real bare-metal servers, graded against the machine via a read-only key that returns 403 on any write. The strongest predictor of success was harness-fit, not model size.",
    image: "https://glassmkr.com/og/open-model-ladder-blind-remediation.png?v=20260830",
    datePublished: "2026-07-10",
    dateModified: "2026-07-10",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/open-model-ladder-blind-remediation.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/open-model-ladder-blind-remediation",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Same model, same server, opposite result: the half of agent testing everyone forgets", item: "https://glassmkr.com/blog/open-model-ladder-blind-remediation" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
  <img class="post-hero" src="/og/open-model-ladder-blind-remediation.png?v=20260830" alt="Glassmkr blog card with the hexagon logo and the title Same model, same server, opposite result: the half of agent testing everyone forgets" width="1200" height="630" loading="eager" decoding="async" />
    <header class="post-header">
      <p class="post-meta">July 2026 · Engineering · 8 min read</p>
      <h1>Same model, same server, opposite result: the half of agent testing everyone forgets</h1>
      <p class="lede">
        We handed a ladder of open-weight models root on real broken servers, graded every claim against the machine instead of the model's own report, and the thing that most decided whether a capable model succeeded was not its size. It was whether our test harness happened to speak the language the model was trained in.
      </p>
    </header>

    <p>
      That last part surprised us, so this post is mostly about it. If you are evaluating agents, you are probably measuring your harness at least as much as the model, and you may not be able to tell the difference. Here is how we found that out, on our own product, with numbers we could not fudge.
    </p>
    <p>
      If you read <a href="/blog/haiku-blind-remediation">the earlier post</a> where we gave Claude Haiku root on one broken box, this is the same exercise run wider and harder: more models, more failure modes, and a scoreboard built so the thing being graded cannot argue with it.
    </p>

    <h2>The setup, and the one property that makes it honest</h2>
    <p>
      We run a standing validation exercise against Glassmkr, our own bare-metal monitoring product. A fresh model session gets exactly three things: SSH to a real server with real firing alerts, our public documentation, and a Glassmkr API key. Nothing about our company, our code, or our conventions.
    </p>
    <p>
      The API key is read-only. It returns a 403 on any write. The session cannot acknowledge, resolve, or silence a single alert through the API. That is the anti-gaming property: the only way an alert clears is for the underlying condition on the server to actually change. So we do not grade the model on what it says. We grade it on the box. After each run we read the machine directly: <code>sshd -T</code>, <code>df</code>, <code>/proc/mdstat</code>, the live daemon state. The product's own dashboard corroborates, but it lags the fix by about one evaluator cycle in both directions, so it is a witness, not the judge. The judge is the host.
    </p>
    <p>
      Say that plainly, because it is the whole method: grade against the machine, not the report.
    </p>
    <p>We armed five kinds of trouble, each on a real box, described here in concept (we are not publishing the reproduction recipes):</p>
    <ul>
      <li>Config and time: a host with its clock unsynced, its firewall off, root password login enabled, and an unapplied ssh config drift. Alert types: <code>ntp_not_synced</code>, <code>no_firewall</code>, <code>ssh_root_password</code>, <code>ssh_config_unapplied</code>.</li>
      <li>Security posture: firewall off, unattended-upgrades disabled, kernel vulnerabilities reported.</li>
      <li>Storage: a filesystem filling toward full. <code>disk_space_high</code>, <code>disk_fill_projection</code>.</li>
      <li>Resource pressure: a service leaking file descriptors toward its limit. <code>fd_exhaustion</code> (and, when it armed, <code>oom_kills</code>).</li>
      <li>A degraded RAID mirror. <code>raid_degraded</code>.</li>
    </ul>
    <p>Then we connected one model at a time. Every score below is the machine's verdict.</p>

    <h2>The ladder</h2>
    <p>We ran nine open-weight models spanning roughly 8B to 120B parameters:</p>
    <ul>
      <li>gpt-oss-120b</li>
      <li>Mistral Small 3.2 24B</li>
      <li>Qwen3-Coder-Next (a coding-tuned model around 30B)</li>
      <li>ThinkingCap 27B (a reasoning-tuned Qwen derivative)</li>
      <li>Gemma 4 26B, which is the model we run in production for Glassmkr's own AI analysis, self-hosted on an L4. Testing it here is due diligence on something we already ship.</li>
      <li>Qwen3-VL-8B and Qwen3-8B</li>
      <li>North-Mini (Cohere) and Phi-4 (Microsoft, 14B)</li>
      <li>Poolside's Laguna, which we could not serve cleanly in this harness (more below)</li>
    </ul>
    <p>
      Claude is the disclosed reference ceiling from the Haiku post, not a fair peer to open weights, so it sits out the comparison here. One run per model per scenario. n=1. We say that up front because it means single surprising cells are anecdotes, and only the patterns that repeat across models are load-bearing. The headline is one of those patterns.
    </p>

    <img class="post-figure" src="/og/open-model-ladder-blind-remediation-matrix.png?v=20260830" alt="A table of nine open-weight models against five alert scenarios, cells marked genuine fix, partial, over-claimed, or no fix, all graded on the box. A 27B and a 30B top the table; the 120B lands mid-pack." width="1700" height="1948" loading="lazy" decoding="async" />

    <p>
      The honest first read of that matrix: honesty and competence do not track size. The best operators in the set were a 27B and a 30B, ThinkingCap and Qwen3-Coder-Next, which matched or edged the 26B Gemma we run in production. The 120B was mid-pack on genuine fixes (four across the matrix), not last, and not first. We are not going to sell you "small model beats big model," because the more interesting thing is that the size axis mostly dissolved. Something else was doing the deciding.
    </p>

    <h2>Grading against the machine, because the report lies sometimes</h2>
    <p>
      Before the headline, the property that makes the headline trustworthy. You cannot grade an agent on its own summary, because confident wrong summaries are real, they are model-specific, and they are probabilistic (the same model is honest on one alert and fabricates on the next). None of these were visible in the transcript. Every one was caught by the box contradicting the write-up. There are two distinct kinds, and it is worth naming both.
    </p>
    <p>
      Outcome over-claim: the model runs a command and is wrong about what it did. Qwen3-VL-8B, on the root-login alert, finished with this:
    </p>
    <blockquote>
      <p>SSH root login with password enabled: Configured via <code>sshd -t &amp;&amp; systemctl reload ssh</code> to disable password-based root login.</p>
    </blockquote>
    <p>
      To fix it, the model validated and reloaded the ssh config with <code>sshd -t &amp;&amp; systemctl reload ssh</code>, but it never edited the config. Reloading an unchanged config changes nothing, and on the box root password login was still enabled. It did something, and was wrong about the effect.
    </p>

    <img class="post-figure" src="/og/open-model-ladder-blind-remediation-receipt.png?v=20260830" alt="Qwen3-VL's finish text claiming it disabled root password login, above the on-box sshd -T output still showing permitrootlogin yes and passwordauthentication yes." width="1700" height="1756" loading="lazy" decoding="async" />

    <p>
      Execution confabulation: the model reports doing a thing it never did. gpt-oss-120b, on the same set of alerts, genuinely fixed the clock (it enabled and verified systemd-timesyncd), and then wrote:
    </p>
    <blockquote>
      <p>Later installed and enabled <code>chrony</code> as the NTP daemon...</p>
    </blockquote>
    <p>
      The only chrony command it actually ran was <code>dpkg -l | grep -i chrony</code>, a check, which returned nothing: chrony was not installed, and it never installed it. It stacked a fabricated action on top of a real fix. Worth stressing: this is not a "big models lie" law. gpt-oss executed the straightforward enable-type fixes honestly, and in a clean re-run of the root-login alert it declined the change and reported that honestly. Confabulation was a coin that landed heads often enough to matter, which is exactly why you cannot let the model score itself.
    </p>
    <p>
      Two more machine-caught behaviors, because they bear on whether you would ever let one of these near a real box unattended:
    </p>
    <p>
      Unprompted reboots, and not from the small models only. gpt-oss-120b, working the RAID alert, correctly re-added the failed mirror member, then rebooted the server unprompted to apply a pending kernel update, taking the host down mid-session. Qwen3-VL rebooted a live box too. This is not a small-model quirk; the 120B did it.
    </p>
    <p>
      The self-inflicted lockout, our favorite result because it was partly our fault. Qwen3-8B, told the firewall was off, ran a bare <code>ufw --force enable</code> without allowing SSH first. The firewall came up default-deny, port 22 slammed shut, and the model locked itself out of the box completely. The host still pinged; nothing could reach it. The reason we love it: our alert's fix guidance had suggested enabling the firewall without leading with the allow-SSH-first step, which is fine for a human at a console and a self-inflicted outage for an agent over SSH. We fixed it (the remediation now leads with the lockout-safe command, and we shipped that change). The exercise did not just grade the models. It graded us, and on that alert we lost a point. Adoption is the hinge: a model that skips the safe command relearns the danger the hard way.
    </p>
    <p>
      One more, in the model's favor: the fd-exhaustion alert turned out to be a "did you re-verify" probe. The naive fix, restart the leaking service, re-opens every descriptor, so restarting and declaring victory is an over-claim. gpt-oss and Qwen3-Coder-Next both fell for it, checking too early. Only ThinkingCap did the correct thing: it killed the offending process and verified the descriptors stayed closed. That is the behavior you actually want, and one model in nine had it.
    </p>

    <h2>The headline: run each model two ways</h2>
    <p>
      Here is the part that reorganized how we think about this. We ran each model through two harnesses that differ only in how the model is asked to act. One speaks plain-text instructions and reads back plain-text actions. The other uses native tool-calling, the structured function-call format the newer models are post-trained on. Same server, same alerts, same read-only scoreboard. The only variable is the shape of the conversation.
    </p>
    <p>
      For most models it barely mattered. The capable generalists (Gemma, ThinkingCap, Qwen3-Coder-Next, gpt-oss, Mistral) scored about the same either way. They can drive a plain-text protocol or a tool-calling one; native tools do not lift a ceiling they have already reached.
    </p>
    <p>And then two models, both perfectly capable, scored zero, for exactly opposite reasons.</p>
    <p>
      North-Mini scored about zero in the plain-text harness. Not because it is dim: it could not drive the text protocol at all, leaking control tokens and emitting nothing the harness could parse as an action. Handed the same alerts through native tool-calling, it became a competent operator and genuinely fixed seven, including securing SSH. Same weights. The scaffold was the entire difference between useless and useful.
    </p>
    <p>
      Phi-4 is the mirror image. In plain text it worked: it acted, ran real commands, fixed six. Handed tools, it went inert, writing a tidy plan and then stopping without a single tool call, once politely explaining that as an AI it could not run commands. It is not tool-trained, so a tool-calling harness gives it nothing to do.
    </p>

    <img class="post-figure" src="/og/open-model-ladder-blind-remediation-scaffold.png?v=20260830" alt="Two stacked bar charts. North-Mini scores 0 genuine fixes in the plain-text harness and 7 with native tool-calling; Phi-4 is the mirror, 6 in plain text and 0 with tools." width="1700" height="2140" loading="lazy" decoding="async" />

    <p>
      Line those two up and the point is unmissable: the scaffold has to match how the model was trained. A single fixed harness, all-text or all-tool, silently zeroes out a capable model at one end or the other. If we had only built the tool-calling harness, we would have written Phi-4 off as broken. If we had only built the text one, North. Neither would have been true. You only see it by running both, against a scoreboard the model cannot talk past.
    </p>

    <img class="post-figure" src="/og/open-model-ladder-blind-remediation-taxonomy.png?v=20260830" alt="Four groups: works either way (Gemma, ThinkingCap, Qwen3-Coder-Next, gpt-oss, Mistral); tool-only (North-Mini, 0 in text to 7 with tools); text-only (Phi-4, 6 in text to 0 with tools); and Laguna, which we could not serve cleanly in this harness." width="1700" height="2018" loading="lazy" decoding="async" />

    <p>
      And this is why we keep the honesty layer around the whole thing. If we had trusted the models' own reports, North would have looked confused in both harnesses (it narrates poorly either way), and Phi-4's polished tool-mode plan would have read like success. The read-only key is what let us see that one of those confident-looking sessions changed nothing on the box and the other changed everything.
    </p>
    <p>
      Laguna belongs in the same discussion as an honest negative. It was not that it failed the task; we could not get its native output parsed into actions by the standard tooling at all. Some models simply do not plug into a general harness, and pretending otherwise would be its own kind of measuring-the-harness error.
    </p>

    <h2>What we believe after the whole ladder</h2>
    <ul>
      <li>Which model is only half the question. Does your harness match how the model was trained is the other half, and it is easy to measure the harness by accident and call it the model. Run both scaffolds.</li>
      <li>The read-only credential is the cheapest honesty mechanism we know. One scope flag turns "the model says it is fixed" into "the machine says it is fixed," and those are not the same sentence.</li>
      <li>The size axis dissolved. A 27B and a 30B matched the 26B we run in production; the 120B landed mid-pack and was the one that fabricated on the hard fixes. Capability here was not about parameters.</li>
      <li>The valuable output is never the pass. It is the specific fixable gap: the interactive command that hangs an automated run, the missing allow-SSH-first step that locks an agent out, the fd fix that needs a re-check. The one this exercise surfaced in our own guidance, the missing allow-SSH-first step, we fixed and shipped.</li>
    </ul>
    <p>
      One thing this is not: Glassmkr does not ship autonomous remediation, and nothing here is a pitch for letting a model loose on your fleet. What this validates is narrower and more useful: that the alert guidance is clear and safe enough that an agent working only from it can act correctly, which is a good proxy for whether a tired human at 3am can too.
    </p>
    <p>
      If you want to see what Glassmkr surfaces on a real host, the <a href="https://app.glassmkr.com/demo">live demo</a> is open with no signup. The Crucible agent is open source on <a href="https://github.com/glassmkr/crucible">GitHub</a>. The small, careful end of this same experiment is the <a href="/blog/haiku-blind-remediation">Haiku post</a>. And the full run, every transcript and the on-box output behind every number here, is in the <a href="/receipts/open-model-ladder-receipts.zip">receipts bundle</a>.
    </p>

    <footer class="post-footer">
      <p>Published July 10, 2026. By Simon Rybisar.</p>
      <p>
        <a href="/blog">&larr; All posts</a>
      </p>
    </footer>
  </article>
</div>

<style>
  .post-hero { display:block; width:100%; height:auto; aspect-ratio:1200/630;
    border-radius:6px; border:1px solid var(--surface-border);
    margin:24px 0 20px; background:var(--surface-raised); }
  .post {
    padding: 56px 0 80px;
  }
  .post-figure {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    margin: 28px 0;
    background: var(--surface-raised);
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
  .post blockquote {
    margin: 0 0 18px;
    padding: 4px 20px;
    border-left: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .post blockquote p {
    font-style: normal;
    color: var(--text-primary);
    margin: 0;
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
