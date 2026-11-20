<!--
  JOIN A GAME… (journey.md 4.9; matchmaking.md 2.12): one field, `Paste the invite link`. A link, also inside a
  sentence, navigates to it; a bare code is answered with "Paste the whole link: the code alone does not carry the key."
  Home (M8-P2) opens it; `onjoin` navigates (default: the page's hash). M8-P4.
-->
<script lang="ts">
  import Button from '../design/Button.svelte';
  import Field from '../design/Field.svelte';
  import Sheet from '../design/Sheet.svelte';
  import { parseRoomLink, pageBase } from './room';
  import { BARE_CODE_TEXT, NOT_A_LINK_TEXT, joinVerdict } from './waiting';

  let { onclose = undefined, onjoin = undefined }: { onclose?: (() => void) | undefined; onjoin?: ((hash: string) => void) | undefined } = $props();
  let text = $state('');
  let problem = $state('');

  function join(): void {
    const v = joinVerdict(text, (t) => parseRoomLink(pageBase(location.href), t));
    if (v.kind === 'go') {
      problem = '';
      if (onjoin) onjoin(v.hash);
      else location.hash = v.hash;
    } else if (v.kind === 'code') problem = BARE_CODE_TEXT;
    else if (v.kind === 'bad') problem = NOT_A_LINK_TEXT;
  }
</script>

<Sheet label="Join a game" width="narrow" {onclose} data-testid="join-sheet">
  {#snippet header()}<h2 class="ds-t-title">Join a game</h2>{/snippet}
  <Field bind:value={text} label="Paste the invite link" placeholder="Paste the invite link" autocomplete="off" data-testid="join-field" oninput={() => (problem = '')} onenter={join} />
  {#if problem}<p class="ds-status ds-status--danger" role="alert" data-testid="join-problem">{problem}</p>{/if}
  {#snippet footer()}
    {#if onclose}<Button variant="quiet" data-testid="join-cancel" onclick={onclose}>CANCEL</Button>{/if}
    <Button variant="primary" data-testid="join-go" disabled={!text.trim()} onclick={join}>JOIN</Button>
  {/snippet}
</Sheet>
