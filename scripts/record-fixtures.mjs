#!/usr/bin/env node
// Records the trimmed test fixtures under tests/fixtures/ (docs/PLAN.md, B0.5).
// Run by hand only (it uses the network); tests never do. Respects Scryfall's rate limits.
//   node scripts/record-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'tests/fixtures';
const TARGET_SETS = ['M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'ORI', 'M19', 'M20', 'M21'];
const FULL_SCRYFALL_SETS = ['m19', 'tm19'];
const SAMPLE_PER_SET = 24;
const UA = { 'User-Agent': 'spellplane-fixture-recorder/0.1', Accept: 'application/json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url, init = {}) {
  const wait = Math.max(0, last + 550 - Date.now());
  if (wait) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) } });
  if (res.status === 429) {
    await sleep(30_000);
    return get(url, init);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Fields stored per docs/DESIGN.md "Specification: card data, packs and draft formats".
const FACE_FIELDS = ['name', 'mana_cost', 'type_line', 'oracle_text', 'colors', 'power', 'toughness', 'loyalty', 'image_uris'];
const CARD_FIELDS = ['id', 'oracle_id', 'name', 'set', 'collector_number', 'rarity', 'layout', 'mana_cost', 'cmc', 'type_line', 'colors', 'color_identity', 'oracle_text', 'power', 'toughness', 'loyalty', 'image_uris', 'card_faces', 'all_parts', 'artist'];
function pickImages(iu) {
  if (!iu) return undefined;
  return { small: iu.small, normal: iu.normal, large: iu.large };
}
function trimCard(c) {
  const o = {};
  for (const k of CARD_FIELDS) {
    if (c[k] === undefined) continue;
    if (k === 'image_uris') o[k] = pickImages(c[k]);
    else if (k === 'card_faces')
      o[k] = c[k].map((f) => {
        const t = {};
        for (const fk of FACE_FIELDS) if (f[fk] !== undefined) t[fk] = fk === 'image_uris' ? pickImages(f[fk]) : f[fk];
        return t;
      });
    else if (k === 'all_parts') o[k] = c[k].map(({ id, component, name, type_line }) => ({ id, component, name, type_line }));
    else o[k] = c[k];
  }
  return o;
}

async function searchAll(q) {
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=set`;
  const cards = [];
  while (url) {
    const page = await get(url);
    cards.push(...page.data);
    url = page.has_more ? page.next_page : null;
  }
  return cards;
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 0) + '\n');
  console.log(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} kB)`);
}

// 1. Scryfall: full M19 (+ its tokens), samples of the other target sets.
const scry = {};
for (const code of FULL_SCRYFALL_SETS) scry[code] = (await searchAll(`e:${code}`)).map(trimCard);
for (const code of TARGET_SETS.filter((c) => c !== 'M19')) {
  const all = await searchAll(`e:${code.toLowerCase()} game:paper`);
  // Deterministic sample: every k-th card, plus every double-faced card.
  const k = Math.max(1, Math.floor(all.length / SAMPLE_PER_SET));
  scry[code.toLowerCase()] = all.filter((c, i) => i % k === 0 || c.card_faces).slice(0, SAMPLE_PER_SET + 6).map(trimCard);
}
for (const [code, cards] of Object.entries(scry)) write(`${OUT}/scryfall/${code}.json`, cards);

// 2. MTGJSON: booster data plus a trimmed card map for every target set.
for (const code of TARGET_SETS) {
  const json = await get(`https://mtgjson.com/api/v5/${code}.json`);
  const d = json.data;
  const cards = {};
  for (const c of [...(d.cards ?? []), ...(d.tokens ?? [])]) {
    cards[c.uuid] = { scryfallId: c.identifiers?.scryfallId, name: c.name, colors: c.colors ?? [], rarity: c.rarity, types: c.types ?? [], number: c.number, manaCost: c.manaCost };
  }
  write(`${OUT}/mtgjson/${code}.json`, { meta: json.meta, data: { code: d.code, name: d.name, releaseDate: d.releaseDate, booster: d.booster ?? null, cards } });
}
console.log('done');
