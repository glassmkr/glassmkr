<script lang="ts">
  // The canonical Compose self-hosting quickstart, rendered from ONE string
  // so it can never fork between surfaces. scripts/check-ground-truth.mjs
  // (monorepo root) verifies this block is byte-identical to the fenced
  // Quickstart block in SELF_HOSTING.md; edit both together or the check
  // fails. Never hand-type this block anywhere else.
  export const QUICKSTART = `git clone https://github.com/glassmkr/glassmkr.git
cd glassmkr
cp env.selfhost.example .env
./scripts/selfhost-setup.sh     # generates the secrets
docker compose up -d`;

  let copied = $state(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(QUICKSTART);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch { /* selectable text remains */ }
  }
</script>

<div class="quickstart">
  <pre><code>{QUICKSTART}</code></pre>
  <button class="copy-btn" class:ok={copied} onclick={copy} aria-label="Copy self-hosting quickstart">
    {copied ? "copied" : "copy"}
  </button>
</div>

<style>
  .quickstart {
    position: relative;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg);
    text-align: left;
  }
  .quickstart pre {
    margin: 0;
    padding: 14px 18px;
    overflow-x: auto;
  }
  .quickstart code {
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-secondary);
  }
  .copy-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    /* 23px is a pixel under the floor; this is the only way to take the
       compose command on a phone. */
    padding: 5px 10px;
    min-height: 24px;
    cursor: pointer;
  }
  .copy-btn:hover { color: var(--text-primary); }
  .copy-btn.ok { color: var(--green); }
</style>
