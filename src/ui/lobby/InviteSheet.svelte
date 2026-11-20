<!--
  The invite sheet (journey.md 4.8; visual.md 2.8 "Invite sheet"): a title, a line, the QR plate, the link and COPY LINK.
  A simple working version by M8-C (no QR yet); M8-P4 owns the file.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, text, link, status = undefined, footer = undefined }: { title: string; text: string; link: string; status?: string | undefined; footer?: Snippet | undefined } = $props();
  let copied = $state(false);
  function copy(): void {
    void navigator.clipboard?.writeText(link).then(() => (copied = true)).catch(() => undefined);
  }
</script>

<section class="ds-sheet ds-sheet--narrow" aria-label={title} data-testid="invite-sheet">
  <h2 class="ds-t-title">{title}</h2>
  <p class="ds-t-reading">{text}</p>
  <input class="ds-field__input" readonly value={link} aria-label="Table link" />
  <button type="button" class="ds-btn ds-btn--primary ds-btn--md" onclick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
  {#if status}<p class="ds-status" role="status">{status}</p>{/if}
  {#if footer}{@render footer()}{/if}
</section>
