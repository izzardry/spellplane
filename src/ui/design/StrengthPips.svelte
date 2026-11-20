<!--
  Deck strength (docs/design/m8/contracts.md Part B; visual.md 2.7): five 4 × 12 px bars, filled for the band, and the
  number and band name in eyebrow type (`54 SOLID`; bands from decks.md D19: Rough, Casual, Solid, Tuned, Fierce).
  `null` is an unknown strength (a deck under half size). `label` is the accessible name, as in the seed; `text={false}`
  draws the bars alone (a deck tile). Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import { bandName } from './strength';

  let {
    band,
    score = undefined,
    label = undefined,
    text = true,
    ...rest
  }: {
    band: 1 | 2 | 3 | 4 | 5 | null;
    score?: number | undefined;
    label?: string | undefined;
    /** [M8-P1] show the number and band name beside the bars (default true) */
    text?: boolean;
    [attr: string]: unknown;
  } = $props();
  const name = $derived(band ? bandName(band) : null);
  const shown = $derived(band ? `${score ?? ''} ${name}`.trim() : 'No strength yet');
  const aria = $derived(label || (band ? `Strength ${score !== undefined ? `${score}, ` : ''}${name}, band ${band} of 5` : 'Strength unknown'));
</script>

<span class="ds-strength" role="img" aria-label={aria} data-band={band ?? 0} {...rest}>
  <span class="ds-str" aria-hidden="true">{#each [1, 2, 3, 4, 5] as b (b)}<span class="ds-str__bar" class:ds-str__bar--off={!band || b > band}></span>{/each}</span>
  {#if text}<span class="ds-t-eyebrow" aria-hidden="true">{shown}</span>{/if}
</span>
