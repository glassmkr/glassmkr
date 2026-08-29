<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** Optional URL shown in a fake browser-bar at the top, mono. */
    url?: string;
    /** Hard cap on the frame body's pixel height on desktop. Content
     *  exceeding this is hidden and a subtle bottom fade signals
     *  "more here." Default 480px (chapter showcase). Hero showcase
     *  passes 600. On tablet/mobile this is scaled to a vh-based
     *  budget so the showcase doesn't dominate small viewports. */
    maxHeight?: number;
    children: Snippet;
  }

  let { url = "app.glassmkr.com", maxHeight = 480, children }: Props = $props();
</script>

<div class="dashboard-frame" style:--max-h={`${maxHeight}px`}>
  <div class="frame-bar">
    <div class="dots">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
    <div class="url">{url}</div>
  </div>
  <div class="frame-body">
    {@render children()}
    <div class="fade" aria-hidden="true"></div>
  </div>
</div>

<style>
  .dashboard-frame {
    background: #0a0a0a;
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.08));
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.35);
    width: 100%;
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    /* Showcase content reads left-aligned regardless of where the
       frame lives on the page (the hero section centers prose). */
    text-align: left;
    /* Static demo, not interactive. Hover does nothing. */
    pointer-events: none;
    user-select: none;
  }

  .frame-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid var(--surface-border, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
  }

  .dots {
    display: flex;
    gap: 6px;
  }
  .dots .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
  }

  .url {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary, #707070);
    flex: 1;
    text-align: center;
    padding-right: 36px;
  }

  .frame-body {
    position: relative;
    background: #0a0a0a;
    /* The cap. On wide viewports use the prop value verbatim; on
       narrower viewports scale to a fraction of the viewport height
       so showcases don't dominate small screens. */
    max-height: var(--max-h, 480px);
    overflow: hidden;
  }

  /* Always-on bottom fade. When content fits exactly under max-h
     this reads as a soft bottom edge; when content overflows it
     reads as "more here." Either way it merges the showcase into
     the page background. */
  .fade {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: linear-gradient(transparent, #0a0a0a);
    pointer-events: none;
  }

  @media (max-width: 1024px) {
    .frame-body {
      max-height: min(var(--max-h, 480px), 65vh);
    }
  }
  @media (max-width: 640px) {
    .frame-body {
      max-height: min(var(--max-h, 480px), 70vh);
    }
  }
</style>
