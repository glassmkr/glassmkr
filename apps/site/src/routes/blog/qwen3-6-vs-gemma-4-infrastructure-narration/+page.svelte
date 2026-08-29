<svelte:head>
  <title>We benchmarked Qwen3.6 against our production Gemma 4 on an L4. Here's what actually mattered. - Glassmkr Blog</title>
  <meta name="description" content="Three-way benchmark of Gemma 4 26B-A4B, Qwen3.6 35B-A3B no-think, and Qwen3.6 35B-A3B thinking on a production infrastructure health analysis prompt. Same L4 GPU, same 6500-token prompt, three runs each. Real wall-clock numbers, VRAM footprints, and the quality-latency tradeoff that matters for narration." />
  <meta name="keywords" content="Qwen3.6, Gemma 4, NVIDIA L4, MoE inference, infrastructure LLM, llama.cpp benchmark, Qwen3.6-35B-A3B, local LLM" />

  <!-- OpenGraph (Facebook, LinkedIn, Slack, Discord) -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/qwen3-6-vs-gemma-4-infrastructure-narration" />
  <meta property="og:title" content="We benchmarked Qwen3.6 against our production Gemma 4 on an L4" />
  <meta property="og:description" content="Three-way benchmark on a production health analysis prompt. Qwen3.6 no-think was 30% faster than Gemma 4. Thinking mode was not worth shipping. Both models hallucinated the AMD TSA acronym." />
  <meta property="og:image" content="https://glassmkr.com/og/qwen3-6-vs-gemma-4-infrastructure-narration.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Comparison showing both Gemma 4 and Qwen3.6 hallucinated the AMD TSA vulnerability acronym in our benchmark" />
  <meta property="og:site_name" content="Glassmkr" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="We benchmarked Qwen3.6 against our production Gemma 4 on an L4" />
  <meta name="twitter:description" content="Qwen3.6 no-think was 30% faster than Gemma 4. Thinking mode is a trap. Both models hallucinated the AMD TSA acronym." />
  <meta name="twitter:image" content="https://glassmkr.com/og/qwen3-6-vs-gemma-4-infrastructure-narration.png?v=20260826" />
  <meta name="twitter:image:alt" content="Comparison showing both Gemma 4 and Qwen3.6 hallucinated the AMD TSA vulnerability acronym" />
  <link rel="canonical" href="https://glassmkr.com/blog/qwen3-6-vs-gemma-4-infrastructure-narration" />

  <!-- Structured data: Article + BreadcrumbList. -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "We benchmarked Qwen3.6 against our production Gemma 4 on an L4",
    description: "Three-way benchmark of Gemma 4 26B-A4B, Qwen3.6 35B-A3B no-think, and Qwen3.6 35B-A3B thinking on a production infrastructure health analysis prompt. Real wall-clock numbers, VRAM footprints, and the quality-latency tradeoff that matters for narration.",
    image: "https://glassmkr.com/og/qwen3-6-vs-gemma-4-infrastructure-narration.png?v=20260826",
    datePublished: "2026-04-21",
    dateModified: "2026-04-21",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/qwen3-6-vs-gemma-4-infrastructure-narration.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/qwen3-6-vs-gemma-4-infrastructure-narration",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Qwen3.6 vs Gemma 4 on L4", item: "https://glassmkr.com/blog/qwen3-6-vs-gemma-4-infrastructure-narration" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <p class="post-meta">April 2026 · Engineering</p>

    <h1>We benchmarked Qwen3.6 against our production Gemma 4 on an L4. Here's what actually mattered.</h1>

    <aside class="editorial-note">
      <strong>Update (August 2026):</strong> Glassmkr is now fully open source and free, both self-hosted and hosted. Pricing described below is historical. See <a href="/blog">/blog</a> for the announcement.
    </aside>

    <p>Glassmkr's Crucible agent ships a snapshot every 60 seconds: CPU load, SMART health, IPMI sensors, network errors, security posture, IPMI SEL, ZFS state, systemd failures. Furnace (our self-hosted Gemma 4 inference on an NVIDIA L4 in Amsterdam) turns that snapshot into a plain-English reading of what an operator should care about, in JSON. Today (May 2026), Furnace surfaces a verdict prior (recoverable, investigation, or vendor-side) on every alert. This is Integration 1, shipped 2026-05-20. Per-snapshot LLM narration ships in Integration 2 after 2 to 4 weeks of priors-only usage data; the pipeline this post describes is Integration 2's pipeline. Current production model is <code>gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf</code>. Qwen released Qwen3.6-35B-A3B in late April, so we benchmarked it against our production setup. Same L4, same 6500-token production prompt, three runs each, temperature 0.3.</p>

    <p>If you run infra and you're choosing between small MoE models for narration tasks, the results below might save you a weekend.</p>

    <h2>Setup</h2>

    <p>The prompt is real: 4154-char system prompt describing the role (senior bare metal operator), output schema, safety warnings for dangerous recommendations, analysis rules ("bond interface drops with active firewall are firewall blocks, say so"), and a strict ban on em-dashes. The user message is a 14983-char JSON snapshot from a production GPU host. Total: ~6500 prompt tokens. The response target is structured JSON with <code>summary</code>, <code>findings[]</code>, <code>optimizations[]</code>, <code>risk_level</code>.</p>

    <p>Three configurations on the same llama-server binary, cold-start before each batch of runs:</p>

    <table>
      <thead>
        <tr><th>Config</th><th>Model</th><th>Flags</th><th>ctx</th><th>max_tokens</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>Gemma 4 (production)</strong></td><td><code>gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf</code></td><td>(none)</td><td>16384</td><td>4096</td></tr>
        <tr><td><strong>Qwen3.6 no-think</strong></td><td><code>Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf</code></td><td><code>--reasoning-budget 0</code></td><td>16384</td><td>4096</td></tr>
        <tr><td><strong>Qwen3.6 thinking</strong></td><td><code>Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf</code></td><td>default</td><td>32768</td><td>16384</td></tr>
      </tbody>
    </table>

    <p>Why three columns instead of two: Qwen3.6's thinking mode immediately truncated at our production <code>max_tokens=4096</code> cap. The reasoning chain alone consumed 12K-30K characters. To fairly evaluate thinking-mode quality we had to bump both context and output limits. <code>--reasoning-budget 0</code> is the clean way to turn thinking off and get the model to answer on token one, matching what the production budget can actually serve.</p>

    <h2>Results</h2>

    <table>
      <thead>
        <tr><th>Metric</th><th>Gemma 4</th><th>Qwen3.6 no-think</th><th>Qwen3.6 thinking</th></tr>
      </thead>
      <tbody>
        <tr><td>Valid JSON</td><td>3/3</td><td>3/3</td><td>3/3</td></tr>
        <tr><td>TSA vulnerability identified</td><td>3/3</td><td>3/3</td><td>3/3</td></tr>
        <tr><td>Microcode update recommended</td><td>3/3</td><td>3/3</td><td>3/3</td></tr>
        <tr><td>Zombie process noted</td><td>3/3</td><td>3/3</td><td>3/3</td></tr>
        <tr><td>Bond0 drops noted</td><td>3/3</td><td>3/3</td><td>3/3</td></tr>
        <tr><td>Correct <code>risk_level</code></td><td>3/3</td><td>2/3</td><td>3/3</td></tr>
        <tr><td>Em-dashes across all runs</td><td>0</td><td>0</td><td>0</td></tr>
        <tr><td>Findings avg</td><td>3.33</td><td>3.67</td><td>3.67</td></tr>
        <tr><td><strong>Wall-clock (avg)</strong></td><td><strong>16.2 s</strong></td><td><strong>11.2 s</strong></td><td><strong>79.9 s</strong></td></tr>
        <tr><td>Completion tokens avg</td><td>662</td><td>800</td><td>5527</td></tr>
        <tr><td>Reasoning tokens avg</td><td>0</td><td>0</td><td>19173</td></tr>
        <tr><td>Peak VRAM</td><td>17.9 GB</td><td>20.9 GB</td><td>21.2 GB</td></tr>
        <tr><td>VRAM headroom (24 GB L4)</td><td>4.7 GB</td><td>1.6 GB</td><td>0.8 GB</td></tr>
      </tbody>
    </table>

    <p>Qwen3.6 with reasoning turned off is 30% faster than Gemma with equivalent correctness on the four things that mattered: identifying the unmitigated TSA kernel vulnerability, flagging the bond0 drops as firewall noise rather than hardware (our prompt explicitly tells the model to make that call), catching the single zombie process, and recommending a microcode update for the CPU.</p>

    <p>The one material difference: Qwen no-think returned <code>risk_level: "healthy"</code> once out of three runs when the snapshot had an active warning-level alert. That's technically wrong, but it's a prompt patch, not a model limitation.</p>

    <p>Thinking mode produced 19K characters of chain-of-thought for 80 seconds of wall-clock, concluded with findings that were basically the same as the no-think version, and used 21.2 GB of VRAM leaving 0.8 GB for everything else. The quality uplift was not worth 7x the latency.</p>

    <h2>What happened in each run</h2>

    <p>Reading the actual JSON output carefully, three observations that the headline table doesn't capture:</p>

    <p><strong>Both models hallucinated the TSA acronym.</strong> This is worth naming clearly because it's a real risk for production narration. The server's active alert is an unmitigated AMD TSA vulnerability (Transient Scheduler Attack, publicly disclosed August 2025). Across the 9 runs:</p>

    <ul>
      <li>Gemma called it "TSX Asynchronous Abort" in all 3 runs (wrong; that's an Intel vulnerability with different mechanics)</li>
      <li>Qwen no-think called it "Transcendental State Access" (run 1), "Transcendental State Attack" (run 2), and "Transcendence Speculative Attack" (run 3). Three different wrong expansions in three runs.</li>
      <li>Qwen thinking got it right in run 3 ("TSA/TAA CPU vulnerability") but hedged in runs 1 and 2.</li>
    </ul>

    <p>Neither model was trained on enough data about AMD TSA to know what the acronym stands for. Both produce confident-sounding expansions anyway. The validator layer in our broader design rejects exactly this class of output, an acronym expansion that isn't grounded in the input JSON, but a less disciplined narration pipeline would ship these hallucinations to users. Worth knowing before you trust a small MoE to narrate anything with a recent technical term.</p>

    <p><strong>Qwen no-think's content is more analytically useful, Gemma's is more reliably on-schema.</strong> On bond0 drops, Gemma says "transient buffer event" or "driver-level buffer event." Qwen says "occurring at the bond aggregation layer, which is consistent with UFW dropping packets before they are handed to the underlying interfaces." Qwen's explanation is better because the prompt specifically told the model to make that call, and Qwen actually makes it. On the IPMI SEL "Unknown #0xff" noise, only Gemma run 3 notices the pattern. Qwen no-think runs 2 and 3 identify it as "BMC firmware quirk" or "sensor mapping artifacts", correct operator-grade reading.</p>

    <p>Counterweight: Qwen no-think run 2 returned <code>risk_level: "healthy"</code> despite the warning-level alert. The chain of reasoning (visible in the completion) argued that TSA is "low risk in most non-hostile environments" and walked the severity down. That's not a model limitation per se, but it means Qwen is more willing to exercise judgment against the input signals than Gemma, for better and worse. Gemma's 3/3 "watch" is more conservative and in this case more correct.</p>

    <p><strong>Thinking mode's "better" finding wasn't actually reasoning.</strong> Qwen thinking run 1 correctly returned <code>risk_level: "warning"</code> where the no-think runs used "watch." Reading the 12,870 characters of chain-of-thought that produced this: the model reasoned "the alert is warning, so risk is warning." That's a correct mapping and it's also a one-line prompt fix, not a reasoning breakthrough. The other 79 seconds of thinking added nothing the no-think runs didn't already produce.</p>

    <h2>The em-dash question</h2>

    <p>Glassmkr's system prompt forbids em-dashes. Both models complied across all 9 runs. This matters because the em-dash is the single most common LLM output tell in written material. Ban it, and the narration reads like a human operator wrote it. Ban it and verify, because we've seen models ignore the rule on longer outputs.</p>

    <p>What worked: explicit, terminal in the system prompt ("Never use em-dashes. Use commas, semicolons, colons, or periods.") near a section about output format. What hasn't worked in earlier tests: a softer instruction ("avoid em-dashes") buried in general guidelines.</p>

    <h2>Recommendation for this workload</h2>

    <p>We're staying on Gemma 4 for production, with Qwen3.6 no-think as the switch candidate when we revisit the tradeoff. Four reasons:</p>

    <p><strong>VRAM headroom.</strong> Production snapshots can be 5-10x larger than the test snapshot (more drives, more DIMMs, more IPMI sensors on high-density hosts). Gemma's 4.7 GB headroom gives room. Qwen no-think at 1.6 GB is tight; a busy snapshot plus a context extension could trigger swap or OOM.</p>

    <p><strong>The "healthy" miscall is a known prompt issue we can fix, but haven't yet.</strong> If Qwen produces the correct risk level after a prompt patch, the 30% latency improvement becomes worth switching for. Until then, Gemma's 3/3 correctness is the baseline.</p>

    <p><strong>Gemma's hallucinations on the TSA acronym are at least internally consistent</strong> (calling it "TSX Asynchronous Abort" three times with the same wrong expansion), whereas Qwen produced three different wrong expansions. Neither is ideal; both get caught by our validator layer. But Gemma's failure mode is easier to audit. Qwen's inconsistency suggests we'd want to add the actual AMD TSA definition to the system prompt before switching, to give the model a grounded reference it can quote.</p>

    <p><strong>Production is running fine.</strong> The model selection cost on an infra narration task is not zero. There's prompt tuning, there's reviewing outputs across a sample of real production snapshots, there's handling the switchover without breaking dashboards. Until we have a concrete reason (a snapshot Gemma consistently misreads, a context-length need Gemma can't meet, a latency budget Gemma can't serve), Gemma stays.</p>

    <p>If any of those change, Qwen no-think is a single <code>--reasoning-budget 0</code> flag away.</p>

    <h2>Thinking mode is not worth shipping for narration</h2>

    <p>This is the generalizable takeaway. Thinking mode on small MoE models trades enormous latency for marginal quality gains on tasks where the model isn't actually reasoning through novel logic. Infra narration isn't one of those tasks. The deterministic pipeline behind the narration has already done the reasoning (which metrics matter, which alerts fired, which patterns correlate). The LLM's job is to explain it. Reasoning over the explanation layer is redundant.</p>

    <p>If your task genuinely requires multi-step reasoning (agentic tool use, complex code synthesis, mathematical proofs), thinking mode may earn its keep. If your task is "turn structured evidence into natural language," it doesn't.</p>

    <p>The implication: don't let thinking-mode benchmarks drive your model selection for narration. A good non-thinking model on the same architecture will get you the same quality at a fraction of the compute.</p>

    <h2>Configuration for anyone replicating</h2>

    <p>Both models run under <code>llama-server</code> (build b8707) on a single 24 GB L4. Default flash attention, <code>-ngl 999</code> to put every layer on GPU.</p>

    <p>Gemma 4:</p>

    <pre><code>llama-server \
  --model gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf \
  --ctx-size 16384 \
  --n-gpu-layers 999 \
  --host 0.0.0.0 --port 8000</code></pre>

    <p>Qwen3.6 no-think:</p>

    <pre><code>llama-server \
  --model Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf \
  --ctx-size 16384 \
  --n-gpu-layers 999 \
  --reasoning-budget 0 \
  --host 0.0.0.0 --port 8000</code></pre>

    <p>Qwen3.6 thinking (document only; not recommended for narration):</p>

    <pre><code>llama-server \
  --model Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf \
  --ctx-size 32768 \
  --n-gpu-layers 999 \
  --host 0.0.0.0 --port 8000</code></pre>

    <p>Request body:</p>

    <pre><code>&#123;
  "model": "[model-name]",
  "messages": [
    &#123;"role": "system", "content": "&lt;glassmkr system prompt&gt;"&#125;,
    &#123;"role": "user", "content": "&lt;snapshot JSON&gt;"&#125;
  ],
  "temperature": 0.3,
  "max_tokens": 4096
&#125;</code></pre>

    <p>For thinking mode, raise <code>max_tokens</code> to 16384 or the model will truncate before producing the final JSON answer.</p>

    <h2>What's next for Glassmkr's AI narration</h2>

    <p>The model we ship is less interesting than the discipline around it. Every narration in Glassmkr is deterministic first: the alert rules fire on current state via a rules engine, trend analysis runs separately via statistical methods, correlation rules match multi-signal patterns. The LLM only narrates what deterministic code has already concluded. If the model output fails the validator (as both models did on the TSA acronym in this benchmark), Furnace drops the offending finding rather than shipping it; the alert still surfaces with its deterministic content (rule trigger, evidence, copy-pasteable FIX). The user always sees the underlying metric values, the specific commands to verify, the corroborating evidence; what they may or may not see is the model's gloss on top.</p>

    <p>This is why model selection matters less than most AI-monitoring marketing implies. The LLM is a narration surface, not a decision layer. Switching from Gemma 4 to Qwen3.6 would improve latency by a few seconds and might give us slightly more contextual detail in findings. It wouldn't change what Glassmkr considers a failure, why, or when.</p>

    <p>That's how we think it should be for production infra. If you're building something similar, benchmark the small MoE models on your actual prompt with your actual data. The answer might surprise you. And whatever model you pick, build the validator first.</p>

    <p>Two companion posts: <a href="/blog/gemma-4-l4-gpu-server-analysis">how we got Gemma 4 running on the L4</a> (the deployment + quantization + prompting story behind this benchmark), and <a href="/blog/training-drive-failure-model-on-l4">how we co-locate quarterly LightGBM training on the same L4 without disturbing Furnace inference</a>.</p>

    <h2>Notes</h2>

    <p>Glassmkr is bare metal monitoring that catches what your hosting provider doesn't. Open source agent (<code>@glassmkr/crucible</code> on npm); the whole stack is open source and self-hostable, and the hosted service is free up to 10 servers. <a href="https://glassmkr.com/docs">glassmkr.com/docs</a>.</p>

    <div class="post-footer">
      <a href="https://app.glassmkr.com/register" class="btn-page btn-amber">Try Glassmkr Free &rarr;</a>
    </div>
  </article>
</div>

<style>
  .container-narrow {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 24px 80px;
    position: relative;
    z-index: 1;
  }

  article {
    padding-top: 40px;
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
    border-left: 3px solid rgba(245, 166, 35, 0.5);
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

  h1 {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.2;
    margin-bottom: 32px;
  }

  h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 40px 0 16px;
  }

  h3 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 28px 0 12px;
  }

  p {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.75;
    margin-bottom: 16px;
  }

  a {
    color: var(--accent);
  }

  ul {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.75;
    margin-bottom: 16px;
    padding-left: 24px;
  }

  li {
    margin-bottom: 6px;
  }

  code {
    font-size: 13px;
    background: var(--surface-raised);
    padding: 2px 6px;
    border-radius: var(--radius-md);
    font-family: 'SF Mono', SFMono-Regular, 'Fira Code', Consolas, 'Courier New', monospace;
  }

  pre {
    background: var(--surface-raised);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 16px;
    overflow-x: auto;
    margin-bottom: 16px;
  }

  pre code {
    background: none;
    padding: 0;
    font-size: 13px;
    line-height: 1.6;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0 24px;
    font-size: 13px;
    font-family: 'SF Mono', SFMono-Regular, 'Fira Code', Consolas, 'Courier New', monospace;
  }

  th, td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid var(--surface-border);
    color: var(--text-secondary);
    vertical-align: top;
  }

  th {
    color: var(--text-primary);
    font-weight: 600;
    background: var(--surface-raised);
  }

  tbody tr:hover {
    background: rgba(255, 255, 255, 0.01);
  }

  td code {
    font-size: 12px;
  }

  .post-footer {
    margin-top: 48px;
    padding-top: 32px;
    border-top: 1px solid var(--surface-border);
    text-align: center;
  }

  .btn-page {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 22px;
    border-radius: var(--radius-md);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    transition: all 0.2s;
  }

  .btn-amber {
    background: rgba(245, 166, 35, 0.12);
    border: 1px solid rgba(245, 166, 35, 0.25);
    color: var(--accent);
  }

  .btn-amber:hover {
    background: rgba(245, 166, 35, 0.18);
    border-color: rgba(245, 166, 35, 0.35);
    text-decoration: none;
  }
</style>
