<script lang="ts">
  // Dev-only route used by scripts/capture-screenshots.mjs (Playwright) to
  // render a single showcase component on a clean background so the capture
  // script can screenshot just the framed showcase.
  //
  // "Dev-only" is now enforced by +page.server.ts, which 404s in production and
  // 404s an unknown name anywhere. It used to be enforced by a noindex tag and
  // a robots.txt Disallow, which is not enforcement: production answered 200
  // for every name, including ones that do not exist, and served hand-composed
  // telemetry from a glassmkr.com URL with no label saying it was illustrative.
  import { page } from "$app/stores";
  import ShowcaseAlert from "$lib/components/showcase/ShowcaseAlert.svelte";
  import ShowcaseOverview from "$lib/components/showcase/ShowcaseOverview.svelte";
  import ShowcaseStorage from "$lib/components/showcase/ShowcaseStorage.svelte";
  import ShowcaseNetwork from "$lib/components/showcase/ShowcaseNetwork.svelte";
  import ShowcaseSecurity from "$lib/components/showcase/ShowcaseSecurity.svelte";
  import ShowcaseIPMI from "$lib/components/showcase/ShowcaseIPMI.svelte";
  import ShowcaseServerDetail from "$lib/components/showcase/ShowcaseServerDetail.svelte";

  let name = $derived($page.params.name);
</script>

<svelte:head>
  <title>capture: {name}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div id="capture-root" class="stage">
  {#if name === "alert"}
    <ShowcaseAlert />
  {:else if name === "overview"}
    <ShowcaseOverview />
  {:else if name === "storage"}
    <ShowcaseStorage />
  {:else if name === "network"}
    <ShowcaseNetwork />
  {:else if name === "security"}
    <ShowcaseSecurity />
  {:else if name === "ipmi"}
    <ShowcaseIPMI />
  {:else if name === "server-detail"}
    <ShowcaseServerDetail />
  {:else}
    <p style="color:#888;font-family:monospace;padding:40px">unknown: {name}</p>
  {/if}
</div>

<style>
  /* Page-level reset so the capture region is exactly the showcase frame.
     The site's root layout wraps us with a header/footer; we hide those
     via :global() so the screenshot script's element-bound capture stays
     clean even if the wider page renders extras off-screen. */
  :global(header),
  /* .cookie-notice, not .cookie-banner. The old selector matched nothing, so
     every capture taken on an uncookied browser included the cookie disclosure
     band in the screenshot. */
  :global(.cookie-notice),
  :global(footer),
  :global(.footer-content) {
    display: none !important;
  }
  :global(main) {
    padding: 0 !important;
    margin: 0 !important;
    max-width: none !important;
  }
  :global(body) {
    background: #050505;
    margin: 0;
    padding: 0;
  }
  .stage {
    padding: 24px;
    background: #050505;
    /* Was a hard width: 1140px, which overflowed any viewport narrower than
       that. The capture script sets its own viewport, so a max-width gives it
       the same framing while leaving the page able to fit a phone. */
    width: 100%;
    max-width: 1140px; /* DashboardFrame max-width 1100 + 2*20 breathing room */
    box-sizing: border-box;
  }
</style>
