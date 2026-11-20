/**
 * Made-up nicknames for a first visit (journey.md J27: "Nobody is asked for a name before playing. A nickname is made
 * up on first visit (`Amber Fox`)"). Two words, each capitalised; a random source can be injected for tests. M8-P2.
 */

/** First words: colours and materials. */
export const NICK_FIRST: readonly string[] = [
  'Amber', 'Ash', 'Azure', 'Brass', 'Bright', 'Cedar', 'Cobalt', 'Copper', 'Coral', 'Dusk', 'Ember', 'Fern', 'Frost', 'Gilded', 'Golden', 'Granite',
  'Hazel', 'Indigo', 'Ivory', 'Jade', 'Juniper', 'Linen', 'Maple', 'Misty', 'Moss', 'Night', 'Ochre', 'Olive', 'Opal', 'Pearl', 'Pine', 'Quiet',
  'Russet', 'Sable', 'Saffron', 'Sage', 'Silver', 'Slate', 'Stone', 'Storm', 'Swift', 'Tawny', 'Teal', 'Thistle', 'Umber', 'Velvet', 'Willow', 'Winter',
];

/** Second words: animals. */
export const NICK_SECOND: readonly string[] = [
  'Badger', 'Bear', 'Bison', 'Crane', 'Crow', 'Deer', 'Eagle', 'Elk', 'Falcon', 'Finch', 'Fox', 'Gecko', 'Hare', 'Hawk', 'Heron', 'Ibis',
  'Jay', 'Kestrel', 'Kite', 'Lark', 'Lynx', 'Marten', 'Mole', 'Moth', 'Newt', 'Otter', 'Owl', 'Panda', 'Pike', 'Puffin', 'Quail', 'Raven',
  'Robin', 'Seal', 'Shrike', 'Snipe', 'Sparrow', 'Stag', 'Stoat', 'Swan', 'Tern', 'Toad', 'Trout', 'Viper', 'Vole', 'Wolf', 'Wren', 'Yak',
];

/** A uniform integer in [0, n) from `random` (a [0, 1) source, default Math.random). */
function pick(n: number, random: () => number): number {
  return Math.min(n - 1, Math.floor(random() * n));
}

/** A made-up nickname, e.g. `Amber Fox` (journey.md J27). At most 16 characters. */
export function randomNickname(random: () => number = Math.random): string {
  return `${NICK_FIRST[pick(NICK_FIRST.length, random)]!} ${NICK_SECOND[pick(NICK_SECOND.length, random)]!}`;
}
