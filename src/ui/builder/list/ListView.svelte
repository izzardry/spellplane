<!--
  The builder's list view: pool and deck as a compact two-column list with filters and counts (DESIGN "Pre-game: draft,
  sealed and deck building", Deck building: List view). Contracts: M2-C (placeholder so the builder container can mount
  it); implementer: M2-P6.
-->
<script lang="ts">
  import type { ListViewProps } from '../../types';

  let { build }: ListViewProps = $props();
</script>

<section class="list-view" data-testid="builder-list">
  <p>List view: {build.main.length} of {build.cards.length} cards in the deck (M2-P6).</p>
</section>
