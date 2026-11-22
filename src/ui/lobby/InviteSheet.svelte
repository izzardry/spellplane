<!--
  The invite sheet (journey.md 4.8 "Invite sheet"; matchmaking.md 2.12; visual.md 2.8 "Invite sheet"; mock.html board 5):
  a title and a line, the QR code on a white plate (no code when the link is too long for one), the link in a read-only
  field, COPY LINK (COPIED ✓ for 2 s), SHARE where navigator.share exists, the game code small as the game's name, the
  presence line and, rarely, SPECTATOR LINK. M8-P5 reuses it for "Bring Ben back" with its own title, text, link and
  status. The clipboard is only written, never read. M8-P4.
-->
<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import Button from '../design/Button.svelte';
  import QrPlate from '../design/QrPlate.svelte';
  import Sheet from '../design/Sheet.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import { qrMatrix } from '../qr';

  let {
    title,
    text,
    link,
    status = undefined,
    footer = undefined,
    code = null,
    spectatorLink = null,
    onclose = undefined,
    present = false,
    compact = false,
  }: {
    title: string;
    text: string;
    link: string;
    /** The presence line (`Waiting for players · 1 of 2 here`). */
    status?: string | undefined;
    footer?: Snippet | undefined;
    /** The game code shown as the game's name (`AMBER FOX 93`), or null. */
    code?: string | null;
    /** The watch link; SPECTATOR LINK copies it. */
    spectatorLink?: string | null;
    onclose?: (() => void) | undefined;
    /** The presence line's dot: solid when the awaited player is here, hollow and pulsing while waiting. */
    present?: boolean;
    /**
     * Board 7's compact block (the plate menu's "Bring Ben back"): the QR code beside the title and its text, so the
     * sheet fits an 800 px window inside the plate popover (gate M8 finding N11).
     */
    compact?: boolean;
  } = $props();

  let matrix = $state.raw<boolean[][] | null>(null);
  let copied = $state<'' | 'link' | 'watch'>('');
  let timer: ReturnType<typeof setTimeout> | null = null;
  let field = $state<HTMLInputElement | undefined>();
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // The code is drawn in the browser (qrcode-generator, loaded with the first sheet); nothing is sent anywhere.
  $effect(() => {
    const l = link;
    let live = true;
    void qrMatrix(l)
      .then((m) => {
        if (live) matrix = m;
      })
      .catch(() => {
        if (live) matrix = null;
      });
    return () => {
      live = false;
    };
  });

  async function copy(what: 'link' | 'watch'): Promise<void> {
    const value = what === 'link' ? link : spectatorLink;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      copied = what;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        copied = '';
        timer = null;
      }, 2000);
    } catch {
      // No clipboard (an insecure page, a refused permission): select the link so it can be copied by hand.
      field?.focus();
      field?.select();
    }
  }

  async function share(): Promise<void> {
    try {
      await navigator.share({ title: 'Spellplane', text: title, url: link });
    } catch {
      // Cancelling the system share sheet copies nothing (journey.md 4.8).
    }
  }

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });
</script>

{#snippet linkField()}
  <label class="ds-field ds-field--square">
    <span class="ds-sr-only">Link</span>
    <input class="ds-field__input link" data-testid="share-link" readonly value={link} bind:this={field} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
  </label>
{/snippet}

{#snippet copyRow()}
  <div class="actions">
    {#if compact}{@render linkField()}{/if}
    <Button variant="primary" size={compact ? 'sm' : undefined} data-testid="copy-link" onclick={() => copy('link')}>{copied === 'link' ? 'COPIED ✓' : 'COPY LINK'}</Button>
    {#if canShare}<Button size={compact ? 'sm' : undefined} data-testid="share" onclick={share}>SHARE</Button>{/if}
  </div>
{/snippet}

{#snippet presence()}
  {#if status}
    <!-- One status word: the dot carries "waiting", the line says the rest, and wraps inside the sheet (gate M8 N11). -->
    <div class="presence">
      <StatusLine data-testid="invite-status">
        {#snippet icon()}<span class="ds-dot {present ? 'ds-dot--here' : 'ds-dot--connecting'}" aria-hidden="true"></span>{/snippet}
        {status}
      </StatusLine>
    </div>
  {/if}
{/snippet}

{#snippet linkAndStatus()}
  {@render linkField()}
  {@render copyRow()}
  {#if code}<p class="ds-t-meta code" data-testid="invite-code">Game code: <span class="mono">{code}</span></p>{/if}
  {@render presence()}
  {#if spectatorLink || footer}
    <div class="foot">
      {#if spectatorLink}<Button variant="ghost" size="sm" data-testid="spectator-link" onclick={() => copy('watch')}>{copied === 'watch' ? 'COPIED ✓' : 'SPECTATOR LINK'}</Button>{/if}
      {@render footer?.()}
    </div>
  {/if}
{/snippet}

{#if compact}
  <!-- Board 7's block inside the plate menu: no second sheet in the popover, the 124 px code beside a one-line strong
       title, two lines of reading text, the state and one row of quiet actions; under it the link and COPY LINK in one
       row (visual.md 2.8 "Plate menu"; gate M8 findings N11, round 3). -->
  <section class="compact" aria-label={title} data-testid="invite-sheet" data-compact="true">
    <div class="beside">
      <div class="qr small" data-testid="invite-qr">
        <QrPlate {matrix} size={124} label="QR code of the link" data-testid="qr-plate" />
      </div>
      <div class="words">
        <h2 class="ds-t-strong title" title={title}>{title}</h2>
        <p class="ds-t-reading text" data-testid="invite-text">{text}</p>
        <div class="words-foot">
          {@render presence()}
          {#if footer}<div class="foot-row">{@render footer()}</div>{/if}
        </div>
      </div>
    </div>
    <!-- The link and COPY LINK share one sm row under the code (gate M8 N11, round 3: the popover fits 800 px). -->
    {@render copyRow()}
  </section>
{:else}
  <Sheet label={title} width="narrow" {onclose} data-testid="invite-sheet">
    {#snippet header()}
      <div class="head">
        <span class="well" aria-hidden="true">＋</span>
        <div class="words">
          <h2 class="ds-t-title">{title}</h2>
          <p class="ds-t-reading">{text}</p>
        </div>
      </div>
    {/snippet}
    {#if matrix}
      <div class="qr" data-testid="invite-qr">
        <QrPlate {matrix} label="QR code of the link" data-testid="qr-plate" />
      </div>
    {/if}
    {@render linkAndStatus()}
  </Sheet>
{/if}

<style>
  .head {
    display: flex;
    gap: var(--ds-space-md);
    align-items: flex-start;
  }
  .words {
    display: grid;
    gap: var(--ds-space-xs);
  }
  .words p {
    margin: 0;
  }
  .well {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--ds-control-md);
    height: var(--ds-control-md);
    border-radius: 50%;
    background: var(--ds-chip);
    box-shadow: var(--ds-elevation-well, none);
    color: var(--ds-ink);
  }
  .qr {
    display: flex;
    justify-content: center;
  }
  .compact {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-md);
    min-width: 0;
  }
  .beside {
    display: flex;
    gap: var(--ds-space-md);
    align-items: flex-start;
  }
  .qr.small {
    flex: none;
  }
  .compact .words {
    min-width: 0;
    flex: 1;
    align-content: start;
  }
  .compact .title {
    margin: 0;
    font-size: 12px;
    line-height: 18px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .compact .text {
    font-size: 12px;
  }
  .compact .presence :global(.ds-status) {
    padding: 0;
  }
  .compact .words {
    align-self: stretch;
    grid-template-rows: auto auto 1fr;
  }
  .words-foot {
    display: grid;
    align-content: end;
    gap: var(--ds-space-xs);
  }
  .foot-row {
    display: flex;
  }
  .compact .actions :global(.ds-btn--primary) {
    flex: none;
  }
  .compact .actions .ds-field {
    flex: 1;
    min-width: 0;
    height: var(--ds-control-sm);
    padding: 0 12px;
  }
  .link {
    font-family: var(--ds-font-mono);
    font-size: var(--ds-type-small);
  }
  .actions {
    display: flex;
    gap: var(--ds-space-sm);
  }
  .actions :global(.ds-btn--primary) {
    flex: 1;
  }
  .code {
    margin: 0;
  }
  .mono {
    font-family: var(--ds-font-mono);
    color: var(--ds-ink);
    letter-spacing: 0.08em;
  }
  .presence :global(.ds-status) {
    display: flex;
    align-items: flex-start;
    height: auto;
    min-height: 24px;
    padding: 7px 0;
    box-sizing: border-box;
    white-space: normal;
    line-height: 1.4;
  }
  .presence :global(.ds-dot) {
    margin-top: 2px;
  }
  .foot {
    display: flex;
    gap: var(--ds-space-sm);
    padding-top: var(--ds-space-md);
    border-top: 1px solid var(--ds-line);
  }
</style>
