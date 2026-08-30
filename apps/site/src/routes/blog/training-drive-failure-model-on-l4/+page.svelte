<svelte:head>
  <title>Training a drive-failure model on a GPU server's CPU - Glassmkr Blog</title>
  <meta name="description" content="We retrained our drive-failure predictor on 2 years of Backblaze data (222M drive-days) on the CPU of our L4 inference server. Gemma stayed resident in VRAM. 59 minutes, no new compute, 5.8% inference overhead. Plus the feature-importance surprise: SMART 197 beat SMART 187." />
  <meta name="keywords" content="LightGBM, Backblaze, drive failure prediction, SMART 197, SMART 187, NVIDIA L4, Gemma 4, bare metal monitoring, DuckDB, ONNX, Glassmkr" />

  <!-- OpenGraph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/training-drive-failure-model-on-l4" />
  <meta property="og:title" content="Training a drive-failure model on a GPU server's CPU" />
  <meta property="og:description" content="Quarterly retraining of our Stage 2.5 tier-ranker drive-failure model on the CPU of the L4 inference server while Gemma stays resident. 222M drive-days, 59 minutes, 5.8% inference overhead. SMART 197 beat SMART 187." />
  <meta property="og:image" content="https://glassmkr.com/og/training-drive-failure-model-on-l4.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Training next to Gemma: top output showing python train.py at 2200% CPU alongside llama-server at 9% CPU on l4-ams-01" />
  <meta property="og:site_name" content="Glassmkr" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Training a drive-failure model on a GPU server's CPU" />
  <meta name="twitter:description" content="Retraining our drive-failure model on 2 years of Backblaze data on the same L4 server's CPU while Gemma kept serving. 59 minutes, 5.8% inference overhead. SMART 197 beat SMART 187." />
  <meta name="twitter:image" content="https://glassmkr.com/og/training-drive-failure-model-on-l4.png?v=20260830" />
  <meta name="twitter:image:alt" content="Training next to Gemma: a drive-failure model trained on the CPU while Gemma kept serving" />
  <link rel="canonical" href="https://glassmkr.com/blog/training-drive-failure-model-on-l4" />

  <!-- Structured data: Article + BreadcrumbList. -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Training a drive-failure model on a GPU server's CPU",
    description: "We retrained our drive-failure predictor on 2 years of Backblaze data (222M drive-days) on the CPU of our L4 inference server. Gemma stayed resident in VRAM. 59 minutes, no new compute, 5.8% inference overhead. SMART 197 beat SMART 187.",
    image: "https://glassmkr.com/og/training-drive-failure-model-on-l4.png?v=20260830",
    datePublished: "2026-04-21",
    dateModified: "2026-04-21",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/training-drive-failure-model-on-l4.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/training-drive-failure-model-on-l4",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Training a drive-failure model on L4", item: "https://glassmkr.com/blog/training-drive-failure-model-on-l4" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
  <img class="post-hero" src="/og/training-drive-failure-model-on-l4.png?v=20260830" alt="Glassmkr blog card with the hexagon logo and the title Training a drive-failure model on a GPU server's CPU" width="1200" height="630" loading="eager" decoding="async" />
    <p class="post-meta">April 2026 · Engineering</p>

    <h1>Training a drive-failure model on a GPU server's CPU</h1>

    <p>We retrained a drive-failure predictor on two years of Backblaze data without renting any extra compute. The model trained on the CPU of the same L4 GPU server that runs Furnace, our self-hosted Gemma 4 inference on an NVIDIA L4 in Amsterdam, while Gemma stayed resident in VRAM and kept answering requests. Total wall-clock: 59 minutes for 222 million drive-days of training data. Gemma's latency was 5.8% slower during training. No new cloud bill, no separate training node, no moving the model off-box.</p>

    <p>This post walks through what that setup looked like, why it works, and what the training turned up along the way. The relevant bits are the economics (you already pay for the whole machine, so use all of it), a drive-health finding that surprised us (SMART 197 beats SMART 187), and the practical limits of the approach (don't try this on a 16 GB laptop).</p>

    <h2>Why retraining costs nothing extra</h2>

    <p>The Furnace box (L4 GPU + AMD EPYC 4464P) is 12 Zen 4 cores, 24 threads, 64 GB of RAM, sitting in Amsterdam on a private WireGuard mesh. During normal operation, the L4's 24 GB of VRAM is pinned to Gemma, and the GPU itself is only busy when an inference request comes in. The CPU sits at single-digit utilization most of the time, serving only the orchestration of llama.cpp request handling.</p>

    <p>Which means there's an entire 24-thread workstation sitting idle on the same box where our production LLM runs. We already paid for it.</p>

    <p>For a quarterly retraining of our drive-failure model, that idle CPU is exactly the right resource. The training isn't a continuous workload. It runs once a quarter, takes an hour, and then the hardware goes back to what it was doing. If we had to provision a separate training box for this (or rent a cloud instance), we'd be paying for compute that sits idle 24 hours a day, 89 days out of 90. Instead we use the CPU we already have.</p>

    <p>The constraint is that the training must not disturb the inference workload. VRAM pressure is out of the question; Gemma uses 18.3 GB of the L4's 24 GB and we can't afford swap. CPU contention has to be bounded too, because even though llama.cpp does its heavy lifting on the GPU, it still needs cores for request handling, prompt processing, and the pre- and post-steps of inference.</p>

    <p>The question this post answers is whether a real training job actually satisfies those constraints in practice, not just in theory.</p>

    <h2>The job</h2>

    <p>Backblaze publishes a quarterly drive-failure dataset: CSV files, one row per drive per day, with SMART attributes and a <code>failure</code> flag on the day a drive dies. We used Q1 2024 through Q4 2025, which unpacks to 82 GB across 731 CSV files covering 222,773,948 drive-days and 259,648 failure events across 374,869 unique drives. Temporal split: everything before July 2025 is training, everything after is held-out validation.</p>

    <p>The target is a LightGBM classifier that predicts whether a drive will fail within 30 days, given SMART attributes and their recent trends. It's used in Dashboard's Stage 2.5 tier ranker, which adjusts alert severity on known-degrading drives. A model score above 0.7 tiers an alert up; below 0.1 can tier it down. Everything in between defers to the rules engine.</p>

    <p>The pipeline has four steps:</p>

    <ol>
      <li><code>prepare_features.py</code>: stream the CSVs through DuckDB, sort by (serial, date), compute lagged deltas and rolling windows for SMART attributes, write a Parquet file.</li>
      <li><code>train.py</code>: load Parquet, apply negative subsampling (keep all 259k positives plus a 5% uniform sample of the 222M negatives), train a LightGBM booster with early stopping.</li>
      <li><code>validate.py</code>: score the full 60.8M-row held-out validation set (no subsampling here), compute AUROC, PR curve, per-vendor breakdown.</li>
      <li><code>export_onnx.py</code>: convert the booster to ONNX, verify parity against the original on 1000 random rows.</li>
    </ol>

    <p>All four steps ran serially on the L4 server's CPU while the L4 itself stayed pinned to Gemma.</p>

    <h2>What the GPU did for 59 minutes</h2>

    <p>Sampling GPU state every 5 seconds for the duration of the training run: VRAM held at 18.3 GB, with a total drift of 30 MiB across 711 samples. That 30 MiB isn't training. It's Gemma's KV cache growing as inference requests came in. Training allocated nothing on the GPU. Not a stray tensor, not a scratch buffer. LightGBM doesn't use CUDA.</p>

    <p>GPU utilization averaged 1.7% during training. The peaks hit 98%, but only in the brief windows when Gemma served an inference request. The baseline state was a GPU resident with Gemma's weights, idling, waiting.</p>

    <p>This is the point: the training job was running full-tilt on the CPU (22 of 24 threads saturated during the LightGBM boosting loop), while the GPU had no idea anything unusual was happening. The two workloads compete for different hardware. CPU cores for training, GPU SMs for inference. They don't fight.</p>

    <h2>Did Gemma slow down?</h2>

    <p>To test this empirically rather than just by argument, we triggered three Gemma inference requests from a separate SSH session during the <code>train.py</code> window, when all 24 CPU threads were at 100%. These are the same kind of requests Gemma serves in production: ~6500 input tokens, structured JSON output, same system prompt as the Qwen benchmark.</p>

    <table>
      <thead>
        <tr><th>Gemma run during training</th><th>Elapsed</th><th>Valid JSON</th><th>Findings</th></tr>
      </thead>
      <tbody>
        <tr><td>1</td><td>22.41 s</td><td>yes</td><td>4</td></tr>
        <tr><td>2</td><td>15.98 s</td><td>yes</td><td>4</td></tr>
        <tr><td>3</td><td>12.91 s</td><td>yes</td><td>3</td></tr>
        <tr><td>Average</td><td>17.10 s</td><td>3/3</td><td>3.67</td></tr>
      </tbody>
    </table>

    <p>Idle baseline from our Qwen vs Gemma benchmark was 16.16 s (average of 3 runs). So Gemma during training averaged 17.10 s vs 16.16 s at baseline: a 5.8% latency increase.</p>

    <p>Caveat: three samples is a tiny comparison. The Qwen benchmark's idle runs ranged from 13.74 s to 17.66 s, so any one of our training-window runs could plausibly sit anywhere in that band. The 5.8% overhead is inside normal run-to-run variance, which is the claim worth making. What we can say with confidence is that Gemma stayed functional, all outputs were valid JSON with the expected finding counts, and nothing in the observed latencies would be visible to a Dashboard user watching a health analysis render. What we can't say is "0% overhead" or "never degrades under load." At a higher concurrent inference rate or longer sustained training windows, this might be different.</p>

    <p>What we can also say: the training job peaked at 2200% CPU (22 threads at 100%) while llama.cpp stayed at 9% CPU. Both co-existed because they were asking for different resources.</p>

    <h2>The feature ranking surprised us</h2>

    <p>The research hypothesis going in, based on Backblaze's own blog posts and the operator folklore that grew around them, was that SMART 187 (Reported Uncorrectable Errors) would be the dominant feature. It wasn't.</p>

    <table>
      <thead>
        <tr><th>Rank</th><th>Feature</th><th>% of total gain</th></tr>
      </thead>
      <tbody>
        <tr><td>1</td><td>smart_197_raw</td><td>25.3%</td></tr>
        <tr><td>2</td><td>smart_5_raw</td><td>20.1%</td></tr>
        <tr><td>3</td><td>model_afr_prior</td><td>10.8%</td></tr>
        <tr><td>4</td><td>drive_age_days</td><td>8.4%</td></tr>
        <tr><td>5</td><td>smart_187_raw</td><td>6.7%</td></tr>
        <tr><td>6</td><td>smart_197_delta_30d</td><td>6.3%</td></tr>
        <tr><td>7</td><td>smart_5_delta_30d</td><td>5.7%</td></tr>
      </tbody>
    </table>

    <p>SMART 197 (Current Pending Sector Count) topped the ranking at 25.3% of total gain, followed by SMART 5 (Reallocated Sector Count) at 20.1%. SMART 187 landed fifth.</p>

    <p>This contradicts a widely-repeated piece of operator advice, which is worth addressing carefully. The claim isn't that SMART 187 is useless. It's still a strong individual indicator, and if you only get to alert on one SMART attribute, it's defensible. The claim is that when you combine 27 features in a boosted tree, the marginal information content of SMART 197 exceeds SMART 187's. This is consistent with Botezatu et al. (2016), who found pending-sector count outperforms reported-uncorrectable on 30-day-horizon prediction tasks. Backblaze's own analysis leans on SMART 187 in part because of how their monitoring surfaces it in isolation, not because it's the most predictive attribute in a combined model.</p>

    <p>The practical implication for a rules engine isn't "alert on 197 instead of 187." Both still matter. The implication is for tier-ranker training: when you're picking which features to engineer deltas and rolling windows for, 197 should be at the top of the list, not 187. It is for us.</p>

    <p>The <code>drive_age_days</code> feature at 8.4% is worth noting too. Older drives fail more. This isn't news, but it's useful confirmation that the model is catching the AFR (Annual Failure Rate) curve correctly rather than learning shortcuts from serial-number patterns. The per-model AFR prior at 10.8% similarly confirms that drive model identity carries legitimate signal, not just leakage.</p>

    <h2>Validation</h2>

    <p>AUROC on the full held-out validation set was 0.8864. The spec aimed for 0.90, so we're just short. Context for that:</p>

    <p>Published benchmarks like DFPoLD and RODMAN report AUROC in the 0.89 to 0.94 range on similar data. Those papers aggregate predictions to drive-week, which means a single prediction per drive per week rather than one per drive per day. Aggregation shifts the positive base rate and inflates AUROC. Our validation is at the row level (one prediction per drive-day), which is closer to how the tier ranker actually runs in production. A like-for-like row-level evaluation of DFPoLD's method would likely land closer to our 0.886 than to their 0.94.</p>

    <p>The PR-curve operating points look bad at first glance:</p>

    <table>
      <thead>
        <tr><th>FPR</th><th>Precision</th><th>Recall</th><th>TP</th><th>FP</th></tr>
      </thead>
      <tbody>
        <tr><td>0.1%</td><td>9.83%</td><td>11.4%</td><td>6,478</td><td>59,425</td></tr>
        <tr><td>0.5%</td><td>6.38%</td><td>36.4%</td><td>20,673</td><td>303,190</td></tr>
        <tr><td>0.8%</td><td>4.85%</td><td>43.5%</td><td>24,734</td><td>485,648</td></tr>
        <tr><td>2.0%</td><td>2.57%</td><td>56.3%</td><td>31,978</td><td>1,212,754</td></tr>
      </tbody>
    </table>

    <p>The spec (copied from DFPoLD/RODMAN) targets precision above 75% at 0.8% FPR. We got 4.85%. That's not a model failure; it's a base-rate ceiling. At 0.094% positive rate, even a perfect classifier bounds precision at 0.8% FPR to about 10.5%. To get 75% precision at that FPR on this base rate, you would need the classifier to achieve near-perfect ranking of all 56,837 failures within the top 456,000 scored rows out of 60.8 million. No classifier on this dataset does that. The 75% number in the spec assumes drive-week aggregation, which shifts the base rate roughly 7-fold and makes those operating points reachable.</p>

    <p>For the Stage 2.5 tier ranker, AUROC is the right quality metric because the ranker only tiers alerts up at score &gt; 0.7 (high confidence failure) or down at score &lt; 0.1 (high confidence healthy). It doesn't operate at arbitrary FPR points. AUROC 0.886 is a perfectly usable operating characteristic at those score thresholds, and it's what <code>validate.py</code> hard-fails on.</p>

    <p>Per-vendor AUROC tells a more textured story:</p>

    <table>
      <thead>
        <tr><th>Vendor</th><th>Drive-days</th><th>Failures</th><th>AUROC</th></tr>
      </thead>
      <tbody>
        <tr><td>Seagate</td><td>20.9M</td><td>21,650</td><td>0.9035</td></tr>
        <tr><td>WDC</td><td>14.7M</td><td>6,817</td><td>0.8746</td></tr>
        <tr><td>Toshiba</td><td>20.0M</td><td>19,165</td><td>0.8524</td></tr>
        <tr><td>HGST/Hitachi</td><td>5.0M</td><td>9,186</td><td>0.8301</td></tr>
      </tbody>
    </table>

    <p>Seagate is the easiest to predict, HGST is hardest. This matches Backblaze's own observation that older Hitachi drives often fail more abruptly, with less SMART lead time, than Seagate or WDC drives of the same generation. If we end up shipping vendor-specific score thresholds in the tier ranker later, HGST is where it would matter most. For now, the combined model is usable across all vendors.</p>

    <h2>What actually ships</h2>

    <p>The training output is a 442 KB ONNX file, a 5.8 KB metadata JSON, and a 2.4 KB per-model AFR table. Dashboard production loads all three on server startup via <code>onnxruntime-node</code>. The parity check between LightGBM's direct predictions and the ONNX runtime showed a maximum absolute difference of 1.02 × 10⁻⁷ across 1000 random validation rows, well inside our 1e-5 tolerance.</p>

    <p>From snapshot arriving in Dashboard to tier-ranker score computed is a single ONNX inference call against a ~27-element float vector. No Python dependency at runtime, no PyTorch, no scikit-learn, no separate training environment. Just a small model file, a TypeScript wrapper that builds the feature vector, and the ONNX runtime.</p>

    <p>We have written separately about <a href="/blog/gemma-4-l4-gpu-server-analysis">why we self-host the model and how we chose it</a>, and <a href="/blog/qwen3-6-vs-gemma-4-infrastructure-narration">how Qwen3.6 benchmarks against Gemma 4 for the narration workload that shares this same L4</a>.</p>

    <h2>Where the approach would break</h2>

    <p>This worked, but with caveats worth naming.</p>

    <p>The training pipeline peaked at 51 GB of resident memory during the LightGBM step. That's on a 64 GB box. The first version of the pipeline used pandas for feature preparation, which tried to load the full 222M-row frame at once and OOM'd immediately. DuckDB's streaming sort and window aggregation is what made the feature-prep step fit, and even it mmapped significant temporary storage. A smaller server (for example a 16 GB box) would fail on feature prep before we ever got to training. A standard GitHub Actions runner at 7 GB will not complete this pipeline.</p>

    <p>The 5.8% Gemma latency overhead was measured on three requests. Scale and sustained load could look different. Real production inference is close to serial in our setup (one analysis every 60 seconds per server), so high concurrent inference collisions with training are rare by design. If they mattered, we could gate the training job to low-traffic windows. We didn't need to.</p>

    <p>DuckDB's 53-minute feature-prep step was slower than our earlier ad-hoc benchmark runs of the same code. The difference was that during this run, the GPU sampler was running, llama.cpp was serving Gemma, and the three benchmark Gemma requests consumed some cores. Co-location isn't free in the feature-prep step, even if it's effectively free at the GPU level. That's a reasonable trade for us; the job still finishes in an hour and we didn't need to pay for anything extra.</p>

    <h2>Using what you own</h2>

    <p>The architectural point is the one worth leaving with. If you run self-hosted inference on GPU hardware that isn't mostly CPU-bound, the CPU on that same box is a real resource for periodic batch workloads. Quarterly model retraining, log rollups, nightly compactions, offline analytics. Anything that's CPU-heavy, short-lived, and doesn't need its own GPU. The economics of cloud GPUs make separate training instances look reasonable. The economics of bare metal GPUs make using the CPU you already rented obvious.</p>

    <p>We're running this job on one of our L4 servers. We expect to run the quarterly retraining on the same box for the foreseeable future. There is no separate training node in our infrastructure. There probably doesn't need to be one.</p>

    <div class="post-footer">
      <a href="https://app.glassmkr.com/register" class="btn-page btn-amber">Try Dashboard Free &rarr;</a>
    </div>
  </article>
</div>

<style>
  .post-hero { display:block; width:100%; height:auto; aspect-ratio:1200/630;
    border-radius:6px; border:1px solid var(--surface-border);
    margin:24px 0 20px; background:var(--surface-raised); }
  .container-narrow {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 24px 80px;
    position: relative;
    z-index: 1;
  }

  article { padding-top: 40px; }
  .post-meta {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 18px;
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

  p {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.75;
    margin-bottom: 16px;
  }

  a { color: var(--accent); }

  ol {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.75;
    margin-bottom: 16px;
    padding-left: 24px;
  }
  ol li { margin-bottom: 6px; }

  code {
    font-size: 13px;
    background: var(--surface-raised);
    padding: 2px 6px;
    border-radius: var(--radius-md);
    font-family: 'SF Mono', SFMono-Regular, 'Fira Code', Consolas, 'Courier New', monospace;
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
  tbody tr:hover { background: rgba(255, 255, 255, 0.01); }
  td code { font-size: 12px; }

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
    transition: background-color 0.2s, border-color 0.2s, color 0.2s;
  }
  .btn-amber {
    background: rgba(255, 107, 53, 0.12);
    border: 1px solid rgba(255, 107, 53, 0.25);
    color: var(--accent);
  }
  .btn-amber:hover {
    background: rgba(255, 107, 53, 0.18);
    border-color: rgba(255, 107, 53, 0.35);
    text-decoration: none;
  }
</style>
