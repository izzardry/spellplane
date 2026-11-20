<!--
  Every `#/decks…` route (decks.md section 1: D1 library, D2 new-deck chooser, D4 opening, D5 deck page). Stub by M8-C:
  the route's name and a way back. M8-P3 owns the file.
-->
<script lang="ts">
  import type { Route } from '../routes';
  import type { DeckStore, SettingsStore } from '../../store/types';

  let { route, decks: _decks = null, settings: _settings = null }: { route: Extract<Route, { name: 'decks' | 'deckNew' | 'deck' | 'deckOpen' }>; decks?: DeckStore | null; settings?: SettingsStore | null } = $props();
</script>

<section class="ds-page" data-testid="decks-route" data-route={route.name}>
  <h1 class="ds-t-heading">Decks</h1>
  <p class="ds-t-reading">The deck library is not in this build yet.</p>
</section>
