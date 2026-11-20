<!--
  Deck strength (docs/design/m8/contracts.md Part B; visual.md 2.7): five 4 × 12 px bars, filled for the band, and the
  number and band name in eyebrow type (`54 SOLID`). `null` is an unknown strength (a deck under half size). Added by M8-P1.
-->
<script lang="ts">
  import './kit';

  /** Band names in order (decks.md section 5). */
  const BANDS = ['Casual', 'Light', 'Solid', 'Strong', 'Fierce'] as const;
  let { band, score = undefined, label = undefined, ...rest }: { band: 1 | 2 | 3 | 4 | 5 | null; score?: number | undefined; label?: string | undefined; [attr: string]: unknown } = $props();
  const name = $derived(band ? BANDS[band - 1] : null);
  const text = $derived(label ?? (band ? `${score ?? ''} ${name}`.trim() : 'No strength yet'));
</script>

<span class="ds-strength" role="img" aria-label={band ? `Strength ${score !== undefined ? `${score}, ` : ''}${name}, band ${band} of 5` : 'Strength unknown'} data-band={band ?? 0} {...rest}>
  <span class="ds-str" aria-hidden="true">{#each [1, 2, 3, 4, 5] as b (b)}<span class="ds-str__bar" class:ds-str__bar--off={!band || b > band}></span>{/each}</span>
  <span class="ds-t-eyebrow" aria-hidden="true">{text}</span>
</span>
