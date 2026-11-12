/**
 * Browser entry for the draft UI's Playwright specs: bundled from source by ./bundle.ts and served on the app's own
 * origin. Mounts src/ui/draft/harness.ts with the recorded Core Set 2019 card data (tests/fixtures; never bundled into
 * the app); faces are placeholders drawn from that data.
 */
import cards from '../../fixtures/scryfall/m19.json';
import type { CardData } from '../../../src/data/types';
import { mount } from '../../../src/ui/draft/harness';

mount(document.getElementById('app')!, cards as unknown as CardData[]);
