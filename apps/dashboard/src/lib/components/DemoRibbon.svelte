<script lang="ts">
  // Shown at the top of the real dashboard when the visitor is in the
  // read-only demo tenant. Soft lead capture: explore freely, with a
  // "leave your email / book a call" CTA that opens a small popover card.
  let email = $state("");
  let wantsCall = $state(false);
  let formState = $state<"idle" | "sending" | "done" | "error">("idle");
  let errorMsg = $state("");
  let open = $state(false);
  let wrapEl: HTMLDivElement | undefined = $state();

  async function submit(e: Event) {
    e.preventDefault();
    if (formState === "sending") return;
    formState = "sending";
    errorMsg = "";
    try {
      const res = await fetch("/api/v1/demo/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, wantsCall }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        formState = "error";
        errorMsg = data?.error ?? "Something went wrong. Please try again.";
        return;
      }
      formState = "done";
    } catch {
      formState = "error";
      errorMsg = "Network error. Please try again.";
    }
  }

  function onWindowClick(e: MouseEvent) {
    if (open && wrapEl && !wrapEl.contains(e.target as Node)) open = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKey} />

<!-- "Live demo" with a pulsing dot claimed the fleet was reporting now. It is a
     fixed capture: these hosts stopped ingesting when the fixture was seeded, so
     a visitor arriving a day later met four machines last seen twenty hours ago,
     presented as live. Either refresh the fixture continuously or say what it
     is. Saying what it is costs nothing and cannot rot. -->
<div class="demo-ribbon">
  <span class="label">Sample fleet</span>
  <span class="sub">read-only capture, not a live system</span>

  <div class="cta-wrap" bind:this={wrapEl}>
    {#if formState === "done"}
      <span class="thanks">Thanks, we will be in touch{wantsCall ? " to book a call" : ""}.</span>
    {:else}
      <button class="cta" class:active={open} onclick={() => (open = !open)} aria-expanded={open}>
        Get this on your fleet
      </button>
      {#if open}
        <div class="lead-popover">
          <p class="pop-title">See Glassmkr on your own fleet</p>
          <p class="pop-sub">Leave your email for a guided walkthrough, or book a quick call.</p>
          <form onsubmit={submit}>
            <input
              type="email"
              placeholder="you@company.com"
              bind:value={email}
              required
              aria-label="Your email"
            />
            <label class="call-check">
              <input type="checkbox" bind:checked={wantsCall} />
              <span class="box" aria-hidden="true"></span>
              <span>Book a 20-minute call instead</span>
            </label>
            <button type="submit" class="send" disabled={formState === "sending"}>
              {formState === "sending" ? "Sending..." : wantsCall ? "Request a call" : "Send"}
            </button>
            {#if formState === "error"}<span class="err">{errorMsg}</span>{/if}
          </form>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Drops only the demo cookie. This used to point at the logout route, which
       cleared the shared session on the parent domain and would have taken a
       real account in the same browser with it. -->
  <a class="exit" href="https://app.glassmkr.com/demo/exit">Exit demo</a>
</div>

<style>
  .demo-ribbon {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    /* Breathing room before the page H1 on every demo subpage. */
    margin-bottom: 24px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--surface-border);
    font-size: 13px;
    flex-wrap: wrap;
    position: relative;
    z-index: 95;
  }
  .label { font-weight: 600; color: var(--text-primary); }
  .sub { color: var(--text-secondary); }

  .cta-wrap { margin-left: auto; position: relative; }
  .cta {
    background: var(--accent-glow, rgba(255, 107, 53,0.12));
    color: var(--accent);
    border: 1px solid rgba(255, 107, 53, 0.4);
    border-radius: 4px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .cta:hover, .cta.active { background: rgba(255, 107, 53, 0.18); border-color: rgba(255, 107, 53, 0.55); }

  /* Popover card: a proper designed lead form rather than a cramped
     inline strip. Anchored under the CTA, right-aligned. */
  .lead-popover {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    width: 320px;
    max-width: calc(100vw - 32px);
    background: var(--bg-elevated, #181B1F);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    padding: 16px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    text-align: left;
    z-index: 200;
  }
  /* Caret pointing up at the CTA. */
  .lead-popover::before {
    content: "";
    position: absolute;
    top: -6px;
    right: 22px;
    width: 11px;
    height: 11px;
    background: var(--bg-elevated, #181B1F);
    border-left: 1px solid var(--surface-border);
    border-top: 1px solid var(--surface-border);
    transform: rotate(45deg);
  }
  .pop-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0 0 4px; }
  .pop-sub { font-size: 12px; color: var(--text-secondary); margin: 0 0 14px; line-height: 1.5; }
  .lead-popover form { display: flex; flex-direction: column; gap: 11px; }

  .lead-popover input[type="email"] {
    width: 100%;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    padding: 9px 12px;
    font-size: 13px;
    color: var(--text-primary);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .lead-popover input[type="email"]::placeholder { color: var(--text-tertiary); }
  .lead-popover input[type="email"]:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.15);
  }

  /* Custom checkbox: reads as designed even when unchecked. */
  .call-check { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
  .call-check input { position: absolute; opacity: 0; width: 0; height: 0; }
  .call-check .box {
    width: 17px; height: 17px; flex-shrink: 0;
    border-radius: 4px; border: 1px solid var(--surface-border); background: var(--surface);
    display: inline-flex; align-items: center; justify-content: center;
    transition: background 0.15s, border-color 0.15s;
  }
  .call-check input:checked + .box { background: var(--accent); border-color: var(--accent); }
  .call-check input:checked + .box::after {
    content: ""; width: 4px; height: 8px; margin-top: -2px;
    border: solid var(--bg, #0B0C0E); border-width: 0 2px 2px 0; transform: rotate(45deg);
  }
  .call-check input:focus-visible + .box { box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.2); }

  .send {
    width: 100%;
    background: var(--accent); color: var(--bg, #0B0C0E); border: none; border-radius: 4px;
    padding: 9px; font-size: 13px; font-weight: 600; cursor: pointer;
    transition: filter 0.15s;
  }
  .send:hover { filter: brightness(1.08); }
  .send:disabled { opacity: 0.6; cursor: default; }
  .err { color: var(--red); font-size: 12px; }

  .thanks { color: var(--green); font-weight: 500; }
  /* 19px tall, and it is how a visitor leaves the demo. Inline-flex plus a
     24px floor, with the padding pulled back by a negative margin so the
     ribbon's own height does not change. */
  .exit {
    font-size: 12px; color: var(--text-tertiary); text-decoration: none; white-space: nowrap;
    display: inline-flex; align-items: center; min-height: 24px; padding: 3px 0; margin: -3px 0;
  }
  .exit:hover { color: var(--accent); }
  @media (max-width: 640px) {
    .sub { display: none; }
  }
</style>
