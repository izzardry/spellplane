/** The test page's shared state: the build both views show, which view is up, and how often the list wrote back. */
import type { DeckBuild } from '../../../../src/core/types';
import type { BuilderSort } from '../../../../src/scene/types';
import type { BuilderViewKind } from '../../../../src/ui/types';

export const harness: { build: DeckBuild; view: BuilderViewKind; sort: BuilderSort; changes: number } = $state({
  build: { cards: [], main: [] },
  view: 'table',
  sort: 'colour',
  changes: 0,
});
