/**
 * Default resolve destination (DESIGN "The effect stack", Resolving: permanents to the controller's battlefield,
 * instants and sorceries to the owner's graveyard, markers vanish).
 */
import type { CardInstance, StackItem, ZoneId } from '../../core/types';
import { zoneId } from '../../core/ids';
import type { DestinationCard } from '../types';

const PERMANENT = /\b(artifact|creature|enchantment|land|planeswalker|battle)\b/;
const NON_PERMANENT = /\b(instant|sorcery)\b/;

/** The card types of the face that was cast: the front face's type line, before the subtype dash. */
function frontTypes(typeLine: string): string {
  const front = typeLine.split('//')[0] ?? '';
  return (front.split(/—| - /)[0] ?? '').toLowerCase();
}

/**
 * Where a resolving stack item goes by default, or null when it vanishes.
 * - Ability, trigger and copy markers vanish.
 * - A spell whose front face has a permanent type goes to its controller's battlefield.
 * - An instant or sorcery goes to its owner's graveyard (the controller's when the instance is not supplied).
 * - Without card data (identity still loading) the spell defaults to the controller's battlefield; the player confirms
 *   or picks another zone, so a wrong guess costs one drag.
 * - A spell item without a card has nothing to move: null.
 */
export function mtgDefaultDestination(item: StackItem, card?: DestinationCard, instance?: CardInstance): ZoneId | null {
  if (item.kind !== 'spell' || item.card === undefined) return null;
  const types = card ? frontTypes(card.type_line) : '';
  if (card && !PERMANENT.test(types) && NON_PERMANENT.test(types)) return zoneId('graveyard', instance?.owner ?? item.controller);
  return zoneId('battlefield', item.controller);
}
