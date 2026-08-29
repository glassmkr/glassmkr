<script lang="ts">
  // Bespoke hex-framed product glyphs (redesign spec D6): the shared hexagon is
  // the recurring brand motif; each product gets a line-art symbol drawn on the
  // Lucide 24px / 1.5-stroke aesthetic. Amber via currentColor. Decorative
  // (aria-hidden) since the product name always sits beside it.
  let {
    name,
    size = 40,
  }: { name: "crucible" | "dashboard" | "furnace"; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 64 64"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  class="glyph"
>
  <polygon points="32,7 54,20 54,44 32,57 10,44 10,20" />
  {#if name === "crucible"}
    <!-- Vessel centered on the hex center (32,32): light handle up top
         balances the heavier bowl below so it reads optically centered. -->
    <path d="M22,26 A10,8 0 0,0 42,26" />
    <ellipse cx="32" cy="27" rx="10" ry="2.5" />
    <path d="M23,27 C23,38 27,45 32,45 C37,45 41,38 41,27" />
    <path d="M26,33 L38,33" />
  {:else if name === "dashboard"}
    <rect x="20" y="22" width="24" height="20" rx="2" />
    <path d="M27,38 L27,34" />
    <path d="M32,38 L32,30" />
    <path d="M37,38 L37,28" />
  {:else if name === "furnace"}
    <!-- Block centered on the hex center (32,32): 28x28 at x18,y18. -->
    <rect x="18" y="18" width="28" height="28" rx="3" />
    <path d="M18,25 L46,25" />
    <path d="M27,42 L27,35 Q32,30 37,35 L37,42 Z" />
    <path d="M29,42 L35,42" />
    <circle cx="32" cy="39" r="1.6" fill="currentColor" stroke="none" />
  {/if}
</svg>

<style>
  .glyph {
    color: var(--accent);
    display: block;
    flex: none;
  }
</style>
