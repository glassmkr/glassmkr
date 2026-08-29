<script lang="ts">
  interface Props {
    text: string;
    label?: string;
  }

  let { text, label = "Copy" }: Props = $props();
  let copied = $state(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => { copied = false; }, 2000);
  }
</script>

<button class="btn btn-small" onclick={copy}>
  {copied ? "Copied!" : label}
</button>
