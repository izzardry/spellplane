/**
 * MTGJSON per-set client and cache (DESIGN "Specification: card data, packs and draft formats", Booster data; "Card
 * data and images": MTGJSON per-set file, cached in IndexedDB). Contracts: M2-C (stubs); implementer: M2-P1.
 *
 * A set file is fetched once from `https://mtgjson.com/api/v5/<CODE>.json`, trimmed to the preferred booster
 * configuration (draft, else default, else play) and the uuid → Scryfall id map of the cards its sheets name, and kept
 * in the `sets` store. Lookup order: memory, then the store, then MTGJSON. Cached sets older than 30 days are served at
 * once and refreshed in the background. Storage failures never block loading: the cache is rebuildable.
 */
import { IdbSetCache } from '../store/sets';
import type { SetCache, SetRecord } from '../store/types';
import { guarded, REQUEST_TIMEOUT_MS, UnreachableError } from './offline';
import { FEATURED_SET_INFO, normaliseSetCode, orderSets } from './sets';
import {
  BOOSTER_TYPES,
  MTGJSON_SET_URL,
  type BoosterConfig,
  type BoosterLayout,
  type BoosterSheet,
  type MtgjsonUuid,
  type SetCardInfo,
  type SetCode,
  type SetData,
  type SetDataSource,
  type SetSummary,
} from './types';

/** Options for the set data source (DESIGN "Card data and images", Caching; M2-P1 may add fields). */
export interface SetDataSourceOptions {
  /** Injected fetch (tests never use the network). */
  fetch?: typeof fetch;
  /** null disables persistence (memory only). */
  cache?: SetCache | null;
  now?: () => number;
  /** Age after which a cached set is refreshed in the background; default SET_REFRESH_AGE_MS. */
  refreshAgeMs?: number;
  /** Fetch MTGJSON's SetList for the picker (default true); false lists only featured and cached sets. */
  setList?: boolean;
  /** How long one set file may take, body included (data/offline.ts; default REQUEST_TIMEOUT_MS.MTGJSON). Added by M5-P3. */
  timeoutMs?: number;
  /** Whether the browser believes it is online; offline loads fail at once (default navigator.onLine). Added by M5-P3. */
  online?: () => boolean;
}

/** Age after which a cached set file is refreshed in the background (same policy as card JSON: 30 days). */
export const SET_REFRESH_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** MTGJSON's list of every set (code, name, release date, type), for the picker. */
export const MTGJSON_SET_LIST_URL = 'https://mtgjson.com/api/v5/SetList.json';

/**
 * Set types that are sold in boosters, used to filter MTGJSON's SetList for the picker (the list carries no booster
 * data; a listed set without usable booster data answers null from `get` and is dropped from later listings).
 */
export const BOOSTER_SET_TYPES: readonly string[] = ['core', 'expansion', 'masters', 'draft_innovation', 'funny'];

/** The file name MTGJSON uses for a set code: `CON` (Conflux) is a reserved file name on Windows and is stored as `CON_`. */
export function mtgjsonFileCode(code: SetCode): string {
  const c = normaliseSetCode(code);
  return c === 'CON' ? 'CON_' : c;
}

// ---------------------------------------------------------------------------------------------------------------------
// Trimming a raw set file
// ---------------------------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function strArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...(v as string[])] : undefined;
}

function positiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

/** Card info from an MTGJSON card object (`data.cards[]`, with `identifiers.scryfallId`) or a fixture entry (`{scryfallId, …}`). */
function cardInfo(c: Obj): SetCardInfo | null {
  const ids = isObj(c.identifiers) ? c.identifiers : null;
  const scryfallId = str(c.scryfallId) ?? (ids ? str(ids.scryfallId) : undefined);
  const name = str(c.name);
  if (!scryfallId || name === undefined) return null;
  const info: SetCardInfo = { scryfallId, name, rarity: str(c.rarity) ?? 'common', number: str(c.number) ?? '' };
  const colors = strArray(c.colors);
  if (colors) info.colors = colors;
  const types = strArray(c.types);
  if (types) info.types = types;
  const manaCost = str(c.manaCost);
  if (manaCost !== undefined) info.manaCost = manaCost;
  return info;
}

/** Every card of the file by uuid: `data.cards` and `data.tokens` as arrays (MTGJSON) or as a uuid map (fixtures). */
function cardIndex(data: Obj): Map<MtgjsonUuid, SetCardInfo> {
  const out = new Map<MtgjsonUuid, SetCardInfo>();
  for (const key of ['cards', 'tokens']) {
    const list = data[key];
    if (Array.isArray(list)) {
      for (const c of list) {
        if (!isObj(c)) continue;
        const uuid = str(c.uuid);
        const info = cardInfo(c);
        if (uuid && info && !out.has(uuid)) out.set(uuid, info);
      }
    } else if (isObj(list)) {
      for (const [uuid, c] of Object.entries(list)) {
        if (!isObj(c)) continue;
        const info = cardInfo(c);
        if (info && !out.has(uuid)) out.set(uuid, info);
      }
    }
  }
  return out;
}

/** A sheet restricted to cards with a positive integer weight and a Scryfall id; null when nothing is left. */
function trimSheet(raw: unknown, index: Map<MtgjsonUuid, SetCardInfo>): BoosterSheet | null {
  if (!isObj(raw) || !isObj(raw.cards)) return null;
  const cards: Record<MtgjsonUuid, number> = {};
  let totalWeight = 0;
  for (const [uuid, w] of Object.entries(raw.cards)) {
    if (!positiveInt(w) || !index.has(uuid)) continue;
    cards[uuid] = w;
    totalWeight += w;
  }
  if (totalWeight === 0 || !Number.isSafeInteger(totalWeight)) return null;
  const sheet: BoosterSheet = { cards, totalWeight, foil: raw.foil === true };
  if (raw.balanceColors === true) sheet.balanceColors = true;
  if (raw.allowDuplicates === true) sheet.allowDuplicates = true;
  if (raw.fixed === true) sheet.fixed = true;
  return sheet;
}

/** How many cards a sheet can yield in one pack. */
function capacity(sheet: BoosterSheet): number {
  if (sheet.allowDuplicates) return Number.POSITIVE_INFINITY;
  if (sheet.fixed) return Object.values(sheet.cards).reduce((a, b) => a + b, 0);
  return Object.keys(sheet.cards).length;
}

/**
 * One booster type trimmed to what generation can honour: layouts whose every sheet exists and can yield its count,
 * the sheets they use, total weights recomputed from what is kept. Null when no layout survives.
 */
function trimConfig(raw: unknown, index: Map<MtgjsonUuid, SetCardInfo>): BoosterConfig | null {
  if (!isObj(raw) || !Array.isArray(raw.boosters) || !isObj(raw.sheets)) return null;
  const rawSheets = raw.sheets;
  const sheetCache = new Map<string, BoosterSheet | null>();
  const sheetFor = (name: string): BoosterSheet | null => {
    if (!sheetCache.has(name)) sheetCache.set(name, Object.hasOwn(rawSheets, name) ? trimSheet(rawSheets[name], index) : null);
    return sheetCache.get(name)!;
  };
  const boosters: BoosterLayout[] = [];
  const sheets: Record<string, BoosterSheet> = {};
  for (const b of raw.boosters) {
    if (!isObj(b) || !positiveInt(b.weight) || !isObj(b.contents)) continue;
    const contents: Record<string, number> = {};
    let ok = Object.keys(b.contents).length > 0;
    for (const [name, count] of Object.entries(b.contents)) {
      const sheet = sheetFor(name);
      if (!positiveInt(count) || !sheet || capacity(sheet) < count) {
        ok = false;
        break;
      }
      contents[name] = count;
    }
    if (!ok) continue;
    boosters.push({ contents, weight: b.weight });
    for (const name of Object.keys(contents)) sheets[name] = sheetFor(name)!;
  }
  if (boosters.length === 0) return null;
  return { boosters, boostersTotalWeight: boosters.reduce((a, b) => a + b.weight, 0), sheets };
}

/**
 * Trim a raw MTGJSON set file (`{meta, data}`) to SetData: the preferred booster type (draft, else default, else play)
 * and the uuid → card map for every card its sheets name; null when it has none of those booster types (DESIGN
 * "Specification: card data, packs and draft formats", Booster data). A type whose sheets cannot fill any layout (cards
 * without a Scryfall id are dropped) counts as absent, so the next type is tried.
 */
export function trimSetFile(raw: unknown): SetData | null {
  if (!isObj(raw)) return null;
  const data = isObj(raw.data) ? raw.data : raw;
  const code = str(data.code);
  if (!code || !isObj(data.booster)) return null;
  const index = cardIndex(data);
  for (const type of BOOSTER_TYPES) {
    if (!Object.hasOwn(data.booster, type)) continue;
    const booster = trimConfig(data.booster[type], index);
    if (!booster) continue;
    const cards: Record<MtgjsonUuid, SetCardInfo> = {};
    for (const name of Object.keys(booster.sheets).sort()) {
      for (const uuid of Object.keys(booster.sheets[name]!.cards).sort()) cards[uuid] = index.get(uuid)!;
    }
    return {
      code: normaliseSetCode(code),
      name: str(data.name) ?? code,
      releaseDate: str(data.releaseDate) ?? '',
      boosterType: type,
      booster,
      cards,
    };
  }
  return null;
}

/** The Scryfall id of an MTGJSON uuid in a trimmed set (DESIGN "Booster data": the map from MTGJSON uuid to Scryfall id); null when unknown. */
export function scryfallIdOf(set: SetData, uuid: MtgjsonUuid): string | null {
  return Object.hasOwn(set.cards, uuid) ? set.cards[uuid]!.scryfallId : null;
}

/** Whether a stored value has the SetData shape this version writes (an older or foreign record is refetched). */
export function isSetData(v: unknown): v is SetData {
  if (!isObj(v) || typeof v.code !== 'string' || typeof v.name !== 'string' || typeof v.releaseDate !== 'string') return false;
  if (!(BOOSTER_TYPES as readonly unknown[]).includes(v.boosterType) || !isObj(v.cards) || !isObj(v.booster)) return false;
  const b = v.booster;
  return Array.isArray(b.boosters) && b.boosters.length > 0 && isObj(b.sheets) && typeof b.boostersTotalWeight === 'number';
}

/** The picker entry of a trimmed set. */
export function summaryOf(set: SetData): SetSummary {
  return { code: set.code, name: set.name, releaseDate: set.releaseDate, featured: false };
}

/** Picker entries from MTGJSON's SetList (`{data: [{code, name, releaseDate, type, isOnlineOnly}]}`): paper sets of booster types. */
export function setListSummaries(raw: unknown): SetSummary[] {
  const list = isObj(raw) && Array.isArray(raw.data) ? raw.data : [];
  const out: SetSummary[] = [];
  for (const s of list) {
    if (!isObj(s)) continue;
    const code = str(s.code);
    const name = str(s.name);
    const releaseDate = str(s.releaseDate);
    const type = str(s.type);
    if (!code || !name || !releaseDate || !type || !BOOSTER_SET_TYPES.includes(type) || s.isOnlineOnly === true) continue;
    out.push({ code: normaliseSetCode(code), name, releaseDate, featured: false });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The data source
// ---------------------------------------------------------------------------------------------------------------------

class MtgjsonSetDataSource implements SetDataSource {
  private readonly fetchFn: typeof fetch | null;
  private readonly cache: SetCache | null;
  private readonly now: () => number;
  private readonly refreshAgeMs: number;
  private readonly useSetList: boolean;
  /** Loaded sets; null records a set known to have no usable booster data. */
  private readonly mem = new Map<SetCode, SetData | null>();
  private readonly inflight = new Map<SetCode, Promise<SetData | null>>();
  private readonly refreshing = new Set<SetCode>();
  private setList: Promise<SetSummary[]> | null = null;
  private readonly timeoutMs: number;
  private readonly online: () => boolean;

  constructor(opts: SetDataSourceOptions) {
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS.MTGJSON;
    this.online = opts.online ?? (() => (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? true : navigator.onLine));
    this.fetchFn = opts.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.cache = opts.cache === undefined ? new IdbSetCache() : opts.cache;
    this.now = opts.now ?? (() => Date.now());
    this.refreshAgeMs = opts.refreshAgeMs ?? SET_REFRESH_AGE_MS;
    this.useSetList = opts.setList ?? true;
  }

  peek(code: SetCode): SetData | null {
    return this.mem.get(normaliseSetCode(code)) ?? null;
  }

  get(code: SetCode): Promise<SetData | null> {
    const c = normaliseSetCode(code);
    if (this.mem.has(c)) return Promise.resolve(this.mem.get(c)!);
    let p = this.inflight.get(c);
    if (!p) {
      p = this.load(c).finally(() => this.inflight.delete(c));
      this.inflight.set(c, p);
    }
    return p;
  }

  async listSets(): Promise<SetSummary[]> {
    const all: SetSummary[] = [...FEATURED_SET_INFO];
    for (const set of await this.cachedSets()) all.push(summaryOf(set));
    for (const set of this.mem.values()) if (set) all.push(summaryOf(set));
    if (this.useSetList) all.push(...(await this.fetchSetList()));
    const unusable = new Set([...this.mem.entries()].filter(([, s]) => s === null).map(([c]) => c));
    return orderSets(all.filter((s) => !unusable.has(normaliseSetCode(s.code))));
  }

  private async load(code: SetCode): Promise<SetData | null> {
    const record = await this.cacheGet(code);
    if (record && isSetData(record.data)) {
      const set = record.data;
      this.mem.set(code, set);
      if (this.now() - record.fetchedAt > this.refreshAgeMs) this.refreshInBackground(code);
      return set;
    }
    const set = await this.fetchSet(code);
    this.mem.set(code, set);
    return set;
  }

  /**
   * Fetch and trim one set file and store it; null when MTGJSON has no such set or no usable booster data. A set file
   * that cannot be fetched (offline, no answer within the timeout) throws an UnreachableError that names the set and
   * says that sets used before still work (data/offline.ts).
   */
  private async fetchSet(code: SetCode): Promise<SetData | null> {
    if (!this.fetchFn) throw new Error('no fetch available to load set data');
    const fetchFn = this.fetchFn;
    const url = MTGJSON_SET_URL(mtgjsonFileCode(code));
    if (!this.online()) throw new UnreachableError('MTGJSON', 'offline', url);
    const answer = await guarded(
      'MTGJSON',
      url,
      async (signal) => {
        const res = await fetchFn(url, { signal });
        if (!res.ok) return { status: res.status, raw: undefined as unknown, invalid: false };
        try {
          return { status: res.status, raw: (await res.json()) as unknown, invalid: false };
        } catch (e) {
          if (e instanceof TypeError) throw e;
          return { status: res.status, raw: undefined as unknown, invalid: true };
        }
      },
      { timeoutMs: this.timeoutMs, online: this.online },
    );
    if (answer.status === 404) return null;
    if (answer.status < 200 || answer.status > 299) throw new Error(`MTGJSON ${code}: HTTP ${answer.status}. The booster data service answered with an error; sets already loaded on this device still work, try again later.`);
    if (answer.invalid) throw new Error(`MTGJSON ${code}: the set file is not valid JSON (a network or proxy page answered instead). Sets already loaded on this device still work.`);
    const set = trimSetFile(answer.raw);
    if (set) await this.cachePut({ code, data: set, fetchedAt: this.now() });
    return set;
  }

  private refreshInBackground(code: SetCode): void {
    if (this.refreshing.has(code)) return;
    this.refreshing.add(code);
    void this.fetchSet(code)
      .then((set) => {
        if (set) this.mem.set(code, set);
      })
      .catch(() => undefined)
      .finally(() => this.refreshing.delete(code));
  }

  private async cachedSets(): Promise<SetData[]> {
    if (!this.cache) return [];
    try {
      const codes = await this.cache.codes();
      const out: SetData[] = [];
      for (const code of codes) {
        const c = normaliseSetCode(code);
        const known = this.mem.get(c);
        if (known !== undefined) continue;
        const record = await this.cache.get(code);
        if (record && isSetData(record.data)) {
          this.mem.set(c, record.data);
          out.push(record.data);
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  private fetchSetList(): Promise<SetSummary[]> {
    if (!this.setList) {
      const fetchFn = this.fetchFn;
      this.setList = (async () => {
        if (!fetchFn || !this.online()) return [];
        try {
          // The list only adds sets to the picker: without it the featured and cached sets are still offered.
          return await guarded(
            'MTGJSON',
            MTGJSON_SET_LIST_URL,
            async (signal) => {
              const res = await fetchFn(MTGJSON_SET_LIST_URL, { signal });
              return res.ok ? setListSummaries(await res.json()) : [];
            },
            // The picker waits for the list: give up sooner than on a set file.
            { timeoutMs: Math.min(this.timeoutMs, REQUEST_TIMEOUT_MS.Scryfall), online: this.online },
          );
        } catch {
          return [];
        }
      })();
      // A failed list (offline) is asked for again on the next listing.
      void this.setList.then((l) => {
        if (l.length === 0) this.setList = null;
      });
    }
    return this.setList;
  }

  private async cacheGet(code: SetCode): Promise<SetRecord | null> {
    if (!this.cache) return null;
    try {
      return await this.cache.get(code);
    } catch {
      return null;
    }
  }

  private async cachePut(record: SetRecord): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.put(record);
    } catch {
      // The cache is rebuildable; a failed write only costs a refetch later.
    }
  }
}

/** The set data source over MTGJSON and the `sets` store (data/types.ts SetDataSource). */
export function createSetDataSource(opts: SetDataSourceOptions = {}): SetDataSource {
  return new MtgjsonSetDataSource(opts);
}
