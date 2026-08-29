<script lang="ts">
  let { children } = $props();
</script>

<div class="auth-wrapper">
  <div class="auth-card card">
    {@render children()}
  </div>
</div>

<style>
  .auth-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 200px);
    padding: 24px;
  }
  .auth-card {
    width: 100%;
    max-width: 400px;
    padding: 32px;
  }
</style>
