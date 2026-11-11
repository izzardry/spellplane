// M0-P2: card model trimming, image tiers and double-faced cards (DESIGN "Card data and images";
// "Specification: card data, packs and draft formats", Stored fields; "Specification: geometry, layout and motion",
// Texture tiers). Acceptance: a double-faced fixture card yields two face images.
import { describe, expect, it } from 'vitest';
import {
  STORED_CARD_FIELDS,
  STORED_FACE_FIELDS,
  faceCount,
  faceImages,
  imageUrl,
  imageUrlForHeight,
  isDoubleFaced,
  placeholderFace,
  relatedTokenIds,
  trimCard,
} from '../../../src/data/cards';
import { CardFaceSource } from '../../../src/data/faces';
import type { CardData, CardDataSource } from '../../../src/data/types';
import { allFixtureCards, loadFixtureSet } from './fakeScryfall';

const m19 = loadFixtureSet('m19.json');
const tokens = loadFixtureSet('tm19.json');
const bolas = m19.find((c) => c.name.startsWith('Nicol Bolas, the Ravager'))!;
const shock = m19.find((c) => c.name === 'Shock')!;

describe('trimCard', () => {
  it('keeps exactly the stored fields, dropping everything else Scryfall sends', () => {
    const raw = {
      object: 'card',
      ...shock,
      lang: 'en',
      prices: { usd: '0.1' },
      legalities: { modern: 'legal' },
      image_uris: { ...shock.image_uris, png: 'x.png', art_crop: 'a.jpg', border_crop: 'b.jpg' },
      purchase_uris: {},
      flavor_text: 'zap',
    };
    const card = trimCard(raw)!;
    expect(Object.keys(card).every((k) => (STORED_CARD_FIELDS as readonly string[]).includes(k))).toBe(true);
    expect(Object.keys(card.image_uris!).sort()).toEqual(['large', 'normal', 'small']);
    expect(card).toEqual(shock);
  });

  it('trims card faces to the per-face fields and related parts to id, component, name and type', () => {
    const raw = {
      ...bolas,
      card_faces: bolas.card_faces!.map((f) => ({ object: 'card_face', ...f, flavor_text: 'x', illustration_id: 'y', image_uris: { ...f.image_uris, png: 'p' } })),
      all_parts: bolas.all_parts!.map((p) => ({ object: 'related_card', ...p, uri: 'https://api.scryfall.com/cards/x' })),
    };
    const card = trimCard(raw)!;
    for (const f of card.card_faces!) expect(Object.keys(f).every((k) => (STORED_FACE_FIELDS as readonly string[]).includes(k))).toBe(true);
    for (const p of card.all_parts!) expect(Object.keys(p).sort()).toEqual(['component', 'id', 'name', 'type_line']);
    expect(card).toEqual(bolas);
  });

  it('is the identity on every recorded fixture card (they are stored trimmed)', () => {
    for (const c of allFixtureCards()) expect(trimCard(c)).toEqual(c);
  });

  it('rejects objects without the identifying fields and drops malformed nested values', () => {
    expect(trimCard(null)).toBeNull();
    expect(trimCard({ object: 'error' })).toBeNull();
    expect(trimCard({ id: 'x', name: 'X', set: 's' })).toBeNull();
    const c = trimCard({ id: 'x', name: 'X', set: 's', collector_number: '1', colors: 'R', image_uris: { small: 's' }, card_faces: [{}, 5] })!;
    expect(c).toEqual({ id: 'x', name: 'X', set: 's', collector_number: '1', rarity: 'common', layout: 'normal', cmc: 0, type_line: '', color_identity: [] });
  });
});

describe('face images', () => {
  it('the double-faced fixture card Nicol Bolas, the Ravager yields two face images', () => {
    expect(bolas.layout).toBe('transform');
    const faces = faceImages(bolas);
    expect(faces).toHaveLength(2);
    expect(faceCount(bolas)).toBe(2);
    expect(isDoubleFaced(bolas)).toBe(true);
    expect(faces[0]!.normal).toContain('/front/');
    expect(faces[1]!.normal).toContain('/back/');
    expect(faces[0]!.normal).not.toBe(faces[1]!.normal);
    expect(imageUrl(bolas, 0, 'large')).toBe(bolas.card_faces![0]!.image_uris!.large);
    expect(imageUrl(bolas, 1, 'small')).toBe(bolas.card_faces![1]!.image_uris!.small);
  });

  it('every double-faced fixture card (M19, ORI) yields two distinct face images', () => {
    const dfcs = allFixtureCards().filter((c) => c.layout === 'transform');
    expect(dfcs.length).toBeGreaterThanOrEqual(6);
    for (const c of dfcs) {
      const f = faceImages(c);
      expect(f).toHaveLength(2);
      expect(new Set(f.map((u) => u.normal)).size).toBe(2);
    }
  });

  it('a single-faced card yields one image; asking for face 1 falls back to the front', () => {
    expect(faceImages(shock)).toEqual([shock.image_uris]);
    expect(isDoubleFaced(shock)).toBe(false);
    expect(imageUrl(shock, 1, 'normal')).toBe(shock.image_uris!.normal);
  });

  it('a split or adventure card (faces without own images) yields its single top-level image', () => {
    const split: CardData = {
      ...shock,
      layout: 'split',
      name: 'Fire // Ice',
      card_faces: [{ name: 'Fire', mana_cost: '{1}{R}' }, { name: 'Ice', mana_cost: '{1}{U}' }],
    };
    expect(faceImages(split)).toEqual([shock.image_uris]);
    expect(isDoubleFaced(split)).toBe(false);
  });

  it('a card without any image has no face images and no URL', () => {
    const bare: CardData = { ...shock };
    delete bare.image_uris;
    expect(faceImages(bare)).toEqual([]);
    expect(imageUrl(bare, 0, 'normal')).toBeNull();
  });
});

describe('image tier by on-screen height', () => {
  it('uses 146×204 under 160 px, 488×680 up to 560 px and 672×936 above that', () => {
    expect(imageUrlForHeight(shock, 0, 40)).toBe(shock.image_uris!.small);
    expect(imageUrlForHeight(shock, 0, 159.9)).toBe(shock.image_uris!.small);
    expect(imageUrlForHeight(shock, 0, 160)).toBe(shock.image_uris!.normal);
    expect(imageUrlForHeight(shock, 0, 560)).toBe(shock.image_uris!.normal);
    expect(imageUrlForHeight(shock, 0, 560.5)).toBe(shock.image_uris!.large);
    expect(imageUrlForHeight(shock, 0, 2000)).toBe(shock.image_uris!.large);
  });

  it('always uses the largest tier in the inspect view', () => {
    expect(imageUrlForHeight(shock, 0, 100, true)).toBe(shock.image_uris!.large);
    expect(imageUrlForHeight(bolas, 1, 100, true)).toBe(bolas.card_faces![1]!.image_uris!.large);
  });

  it('picks the tier per face of a double-faced card', () => {
    expect(imageUrlForHeight(bolas, 1, 300)).toBe(bolas.card_faces![1]!.image_uris!.normal);
  });
});

describe('placeholder faces', () => {
  it('draw each face of a double-faced card from that face', () => {
    expect(placeholderFace(bolas, 0)).toMatchObject({ name: 'Nicol Bolas, the Ravager', cost: '{1}{U}{B}{R}', pt: '4/4' });
    expect(placeholderFace(bolas, 1)).toMatchObject({ name: 'Nicol Bolas, the Arisen', type: 'Legendary Planeswalker — Bolas', pt: '7' });
  });

  it('draw a single-faced card from the card', () => {
    expect(placeholderFace(shock, 0)).toEqual({ name: 'Shock', cost: '{R}', type: 'Instant', text: shock.oracle_text });
  });
});

describe('related tokens', () => {
  it('lists the token parts, without the card itself', () => {
    const angel = m19.find((c) => c.name === 'Resplendent Angel')!;
    const ids = relatedTokenIds(angel);
    expect(ids).toHaveLength(1);
    expect(tokens.find((t) => t.id === ids[0])?.name).toBe('Angel');
    const angelToken = tokens.find((t) => t.name === 'Angel')!;
    expect(relatedTokenIds(angelToken)).not.toContain(angelToken.id);
    expect(relatedTokenIds(shock)).toEqual([]);
  });
});

describe('FaceSource', () => {
  const source = (cards: CardData[]): CardDataSource => {
    const byId = new Map(cards.map((c) => [c.id, c]));
    return {
      peek: (sid) => byId.get(sid) ?? null,
      get: async (sid) => byId.get(sid) ?? null,
      getMany: async () => ({}),
      resolveDeck: async () => ({ main: [], side: [], cards: {}, errors: [] }),
      searchTokens: async () => [],
      relatedTokens: async () => [],
    };
  };

  it('returns a Scryfall URL per face and tier: two different images for a double-faced card', async () => {
    const faces = new CardFaceSource(source([bolas]), 'scryfall');
    const front = await faces.faceFor({ sid: bolas.id }, 0, 'normal');
    const back = await faces.faceFor({ sid: bolas.id }, 1, 'normal');
    expect(front).toEqual({ kind: 'url', url: bolas.card_faces![0]!.image_uris!.normal });
    expect(back).toEqual({ kind: 'url', url: bolas.card_faces![1]!.image_uris!.normal });
    expect(await faces.faceFor({ sid: bolas.id }, 0, 'small')).toEqual({ kind: 'url', url: bolas.card_faces![0]!.image_uris!.small });
  });

  it('with ?faces=placeholder returns placeholder faces from the card data, never a URL', async () => {
    const faces = new CardFaceSource(source([bolas, shock]), 'placeholder');
    const front = await faces.faceFor({ sid: bolas.id }, 0, 'large');
    const back = await faces.faceFor({ sid: bolas.id }, 1, 'large');
    expect(front).toEqual({ kind: 'placeholder', face: placeholderFace(bolas, 0) });
    expect(back).toEqual({ kind: 'placeholder', face: placeholderFace(bolas, 1) });
    expect(front).not.toEqual(back);
    expect((await faces.faceFor({ sid: shock.id, foil: true }, 0, 'small')).kind).toBe('placeholder');
  });

  it('an unknown card, or a card without images, gets a placeholder', async () => {
    const bare: CardData = { ...shock, id: 'no-image' };
    delete bare.image_uris;
    const faces = new CardFaceSource(source([bare]), 'scryfall');
    expect(await faces.faceFor({ sid: 'missing' }, 0, 'normal')).toEqual({ kind: 'placeholder', face: { name: 'Unknown card' } });
    expect(await faces.faceFor({ sid: 'no-image' }, 0, 'normal')).toMatchObject({ kind: 'placeholder', face: { name: 'Shock' } });
  });
});
