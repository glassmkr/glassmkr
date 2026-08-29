<script lang="ts">
  // Hand-authored inline SVG. Not a charting library. Three nodes wired
  // left-to-right on desktop; CSS stacks the diagram vertically on
  // mobile via the @media query below.
</script>

<section class="trust">
  <div class="inner">
    <p class="eyebrow">YOUR TELEMETRY STAYS YOURS</p>

    <div class="diagram-wrap">
      <svg
        class="diagram desktop"
        viewBox="0 0 720 260"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Telemetry path: your hardware to Dashboard in Amsterdam to self-hosted Gemma 4 AI"
        role="img"
      >
        <!-- Wire definitions -->
        <defs>
          <marker id="arrow-amber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="var(--accent)"/>
          </marker>
        </defs>

        <!-- Wire: Hardware -> Dashboard -->
        <line x1="160" y1="130" x2="290" y2="130" stroke="var(--accent)" stroke-width="1.5" marker-end="url(#arrow-amber)"/>
        <text x="225" y="118" text-anchor="middle" class="annotation">TLS, to Amsterdam</text>

        <!-- Wire: Dashboard -> AI -->
        <line x1="430" y1="130" x2="560" y2="130" stroke="var(--accent)" stroke-width="1.5" marker-end="url(#arrow-amber)"/>
        <text x="495" y="118" text-anchor="middle" class="annotation">Internal only</text>

        <!-- Node 1: Your hardware -->
        <g>
          <rect x="40" y="80" width="120" height="100" rx="6" fill="#0e0e0e" stroke="var(--accent)" stroke-width="1.2"/>
          <!-- server-rack glyph -->
          <g transform="translate(72, 102)" stroke="var(--accent)" stroke-width="1" fill="none" opacity="0.7">
            <rect x="0" y="0" width="56" height="9" rx="1"/>
            <circle cx="50" cy="4.5" r="1.2" fill="var(--accent)"/>
            <rect x="0" y="13" width="56" height="9" rx="1"/>
            <circle cx="50" cy="17.5" r="1.2" fill="var(--accent)"/>
            <rect x="0" y="26" width="56" height="9" rx="1"/>
            <circle cx="50" cy="30.5" r="1.2" fill="var(--accent)"/>
          </g>
          <text x="100" y="166" text-anchor="middle" class="node-label">Your hardware</text>
        </g>

        <!-- Node 2: Dashboard -->
        <g>
          <rect x="290" y="80" width="140" height="100" rx="6" fill="#0e0e0e" stroke="var(--accent)" stroke-width="1.2"/>
          <text x="360" y="124" text-anchor="middle" class="node-title">Dashboard</text>
          <text x="360" y="146" text-anchor="middle" class="node-sub">EU, Amsterdam</text>
        </g>

        <!-- Node 3: Self-hosted AI -->
        <g>
          <rect x="560" y="80" width="160" height="100" rx="6" fill="#0e0e0e" stroke="var(--accent)" stroke-width="1.2"/>
          <text x="640" y="120" text-anchor="middle" class="node-title">Self-hosted AI</text>
          <text x="640" y="146" text-anchor="middle" class="node-mono">gemma-4-26B-A4B-it</text>
          <text x="640" y="160" text-anchor="middle" class="node-mono">UD-Q4_K_XL</text>
        </g>
      </svg>

      <!-- Stacked variant for mobile. Same nodes, vertical wires. -->
      <svg
        class="diagram mobile"
        viewBox="0 0 320 540"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        role="img"
      >
        <defs>
          <marker id="arrow-amber-m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="var(--accent)"/>
          </marker>
        </defs>

        <!-- Wires -->
        <line x1="160" y1="120" x2="160" y2="200" stroke="var(--accent)" stroke-width="1.5" marker-end="url(#arrow-amber-m)"/>
        <text x="172" y="165" class="annotation" text-anchor="start">TLS, to Amsterdam</text>

        <line x1="160" y1="320" x2="160" y2="400" stroke="var(--accent)" stroke-width="1.5" marker-end="url(#arrow-amber-m)"/>
        <text x="172" y="365" class="annotation" text-anchor="start">Internal only</text>

        <!-- Nodes -->
        <rect x="80" y="20" width="160" height="100" rx="6" fill="#0e0e0e" stroke="var(--accent)" stroke-width="1.2"/>
        <text x="160" y="78" text-anchor="middle" class="node-title">Your hardware</text>

        <rect x="80" y="200" width="160" height="120" rx="6" fill="#0e0e0e" stroke="var(--accent)" stroke-width="1.2"/>
        <text x="160" y="248" text-anchor="middle" class="node-title">Dashboard</text>
        <text x="160" y="270" text-anchor="middle" class="node-sub">EU, Amsterdam</text>

        <rect x="60" y="400" width="200" height="120" rx="6" fill="#0e0e0e" stroke="var(--accent)" stroke-width="1.2"/>
        <text x="160" y="442" text-anchor="middle" class="node-title">Self-hosted AI</text>
        <text x="160" y="468" text-anchor="middle" class="node-mono">gemma-4-26B-A4B-it</text>
        <text x="160" y="484" text-anchor="middle" class="node-mono">UD-Q4_K_XL</text>
      </svg>
    </div>

    <p class="callout">
      Your alert text never reaches OpenAI, Anthropic, or Google.
    </p>

    <!-- Caption emphasis per CONTENT_TRANCHE_1 spec (2026-05-17):
         lead with the open-source agent, surface the "only metrics +
         alert state leave the server" data-handling claim, and call
         out EU jurisdiction explicitly. -->
    <p class="caption">
      The Crucible agent is <a href="https://github.com/glassmkr/crucible">AGPL-3.0-only and open source</a>. Only metrics and alert state leave your server, plus small bounded diagnostic excerpts around a failure (for example the last journal lines of a failed service): no bulk log streaming and no command output. Dashboard runs in Amsterdam on dedicated hardware, which the RIPE record confirms, under a data controller registered in the Czech Republic. Read the <a href="/trust">full trust posture &rarr;</a>
    </p>
  </div>
</section>

<style>
  .trust {
    padding: 96px 24px;
  }
  .inner {
    max-width: 880px;
    margin: 0 auto;
    text-align: center;
  }
  .eyebrow {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--accent);
    opacity: 0.7;
    margin: 0 0 56px;
  }

  .diagram-wrap { width: 100%; max-width: 720px; margin: 0 auto; }
  .diagram { width: 100%; height: auto; display: block; }
  .diagram.mobile { display: none; }

  /* SVG text styling */
  :global(.diagram .node-title) {
    font-size: 14px;
    font-weight: 600;
    fill: var(--text-primary);
  }
  :global(.diagram .node-sub) {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    fill: var(--text-secondary);
  }
  :global(.diagram .node-mono) {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    fill: var(--accent);
    opacity: 0.85;
  }
  :global(.diagram .node-label) {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    fill: var(--text-secondary);
  }
  :global(.diagram .annotation) {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    fill: var(--text-tertiary);
    letter-spacing: 0.04em;
  }

  .callout {
    margin: 28px auto 8px;
    font-size: 13.5px;
    color: var(--accent);
    font-style: italic;
    max-width: 560px;
  }

  .caption {
    margin: 32px auto 0;
    font-size: 14.5px;
    line-height: 1.65;
    color: var(--text-secondary);
    max-width: 600px;
  }
  .caption a { color: var(--accent); text-decoration: none; }

  @media (max-width: 720px) {
    .diagram.desktop { display: none; }
    .diagram.mobile { display: block; max-width: 320px; margin: 0 auto; }
    .trust { padding: 72px 20px; }
  }
</style>
