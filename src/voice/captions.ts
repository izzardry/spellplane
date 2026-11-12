/**
 * Dictation and captions (DESIGN "Chat and voice", Dictation and captions: interim and final captions anchored to the
 * card or stack item the speaker last acted on or is hovering, else beside the avatar; the final transcript stored on
 * the action in the log; dictation into note fields). Implementer: M3-P4.
 *
 * - **Listening** follows the talk state (voice/types.ts TalkState `dictation`); the engine is created on the first
 *   utterance, so nothing loads before the player dictates (and the local model only once it was chosen).
 * - **Own captions.** Interim words grow a local caption and go to the others on presence (`captionInterim`); the final
 *   text becomes a `caption` action carrying the anchor and `about`, the cid of the action the speaker last acted on.
 *   The anchor and `about` are fixed when the utterance starts.
 * - **Others' captions.** A peer's interim text comes from its presence; its final text from the `caption` action in
 *   the log, under the same caption id, so the bubble stays one bubble. A final caption lingers CAPTION_LINGER_MS.
 * - **Notes by voice.** While a note field has focus (`dictateInto`), the transcript goes into that field instead.
 * - **Hidden information.** An anchor is only ever a card in a public zone, a stack item or a seat: a hovered or last
 *   touched card in a hand or library is never named by a caption (CLAUDE.md, hidden information).
 */
import type { Action } from '../core/actions';
import type { Anchor, InstanceId, LogEntry, SeatId, StackItemId, TableState } from '../core/types';
import type { PeerPresence, Unsubscribe } from '../net/types';
import { CAPTION_LINGER_MS, type Caption, type CaptionControls, type CaptionHost, type CreateCaptions, type DictationTarget, type LocalSpeechEngine, type SpeechEngine, type SpeechEngineFactory, type SpeechEngineId, type SpeechEngineInfo, type TalkState } from './types';

/** After the talk key is released, how long the engine may still deliver the utterance's final text, ms. */
export const FINAL_GRACE_MS = 3000;
/** After a final caption, the interim presence is cleared this much later, so peers see the final action first, ms. */
export const INTERIM_CLEAR_MS = 2000;
/** A peer's interim caption that has not changed for this long is dropped (its final never came), ms. */
export const INTERIM_STALE_MS = 10_000;
/** Longest caption text sent (characters). */
export const CAPTION_MAX_CHARS = 500;
/** Longest note text (the HUD's note field, ui/Hud.svelte). */
export const NOTE_MAX_CHARS = 80;
/** The stored default language: it stands for "the browser's language" (DESIGN "Chat and voice", Language). */
export const DEFAULT_SPEECH_LANG = 'en';

// ---------------------------------------------------------------------------------------------------------------------
// Card context (DESIGN "Chat and voice", Placement and Record)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Actions that are not something the player did to the table (bookkeeping a browser sends by itself, conversation,
 * answers to a confirmation round): they neither give nor take away a card context.
 */
const TRANSPARENT = new Set<Action['type']>([
  'chat',
  'caption',
  'undo',
  'respond',
  'away',
  'rngReveal',
  'shuffleNonce',
  'shuffleDone',
  'commitClose',
  'snapshotHash',
  'sequencerClaim',
  'recover',
  'recoverCommit',
]);

const cardAnchor = (id: InstanceId): Anchor => ({ kind: 'card', id });

/**
 * What one action of the speaker acted on: an anchor, null when it acted on no card or stack item (a turn pass, a life
 * change: the context ends there), or 'skip' when it does not count (TRANSPARENT).
 */
function touchedBy(a: Action, cardOfItem: (item: StackItemId) => InstanceId | null): Anchor | null | 'skip' {
  if (TRANSPARENT.has(a.type)) return 'skip';
  const item = (id: StackItemId): Anchor => {
    const card = cardOfItem(id);
    return card ? cardAnchor(card) : { kind: 'stackItem', id };
  };
  switch (a.type) {
    case 'move':
    case 'moveTemp':
    case 'tap':
    case 'flip':
    case 'transform':
    case 'rotate':
    case 'counter':
    case 'note':
    case 'attach':
    case 'detach':
    case 'pile':
    case 'createToken':
    case 'copy':
    case 'remove':
    case 'toZone':
    case 'hide':
      return cardAnchor(a.card);
    case 'draw':
    case 'reveal':
    case 'revealTo':
      return cardAnchor(a.instanceId);
    case 'lookAt':
      return a.card ? cardAnchor(a.card) : null;
    case 'settle':
      return a.cards && a.cards.length > 0 ? cardAnchor(a.cards[a.cards.length - 1]!) : null;
    case 'stackPush':
      // A spell is its card (which stays on the table after it resolves); an ability or trigger is its stack item.
      return a.card ? cardAnchor(a.card) : { kind: 'stackItem', id: a.item };
    case 'stackNote':
    case 'stackResolve':
    case 'stackCounter':
    case 'stackReorder':
      return item(a.item);
    case 'ask':
      return a.about ? item(a.about) : null;
    case 'lineAdd':
      return a.from.kind === 'seat' ? null : a.from;
    case 'ping':
      return a.target.kind === 'seat' ? null : a.target;
    default:
      return null;
  }
}

/**
 * The card or stack item `seat` last acted on, with the cid of that action, or null (DESIGN "Chat and voice", Placement
 * and Record: the caption is anchored there and stored on that action). Walks the log back over the seat's own
 * actions: bookkeeping, chat and undone actions are passed over; the first other action decides — a card or stack
 * action gives its anchor, anything else (a turn pass, a life change, a die roll) means there is no card context.
 */
export function lastTouched(log: readonly LogEntry[], seat: SeatId): { anchor: Anchor; about: string } | null {
  const undone = new Set<string>();
  const cardOfItem = (item: StackItemId): InstanceId | null => {
    for (const e of log) if (e.kind === 'action' && e.action.type === 'stackPush' && e.action.item === item) return e.action.card ?? null;
    return null;
  };
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    if (e.kind !== 'action' || e.action.by !== seat) continue;
    const a = e.action;
    if (a.type === 'undo') undone.add(a.of);
    if (undone.has(a.cid)) continue;
    const t = touchedBy(a, cardOfItem);
    if (t === 'skip') continue;
    return t ? { anchor: t, about: a.cid } : null;
  }
  return null;
}

/** `anchor` when every viewer may see what it names: a card in a public zone, a stack item on the stack, a seat; else null. */
export function publicAnchor(state: TableState, anchor: Anchor | null | undefined): Anchor | null {
  if (!anchor) return null;
  switch (anchor.kind) {
    case 'card': {
      const c = state.cards[anchor.id];
      return c && state.zones[c.zone]?.visibility === 'public' ? anchor : null;
    }
    case 'stackItem':
      return state.stack.some((s) => s.id === anchor.id) ? anchor : null;
    case 'seat':
      return state.seats[anchor.id] ? anchor : null;
  }
}

/**
 * The dictation language for a stored setting (DESIGN "Chat and voice": "Language is a per-player setting, defaulting
 * to the browser locale"): the stored default stands for the browser's language; the settings store full tags.
 */
export function speechLang(stored: string | null | undefined, browser: string | null | undefined = typeof navigator === 'undefined' ? null : navigator.language): string {
  if (stored && stored !== DEFAULT_SPEECH_LANG) return stored;
  return browser || DEFAULT_SPEECH_LANG;
}

// ---------------------------------------------------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------------------------------------------------

interface Utterance {
  id: string;
  route: 'caption' | 'field';
  target: DictationTarget | null;
  anchor: Anchor | null;
  about: string | undefined;
  text: string;
}

/** Text joined to an existing note with one space. */
function appendText(base: string | undefined, text: string): string {
  const b = (base ?? '').trim();
  return b ? `${b} ${text}` : text;
}

class CaptionController implements CaptionControls {
  private list: Caption[] = [];
  private readonly listeners = new Set<(captions: Caption[]) => void>();
  private readonly unsubs: Unsubscribe[] = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly factories: SpeechEngineFactory[];
  private engineId: SpeechEngineId;
  private engineInst: { id: SpeechEngineId; engine: Promise<SpeechEngine> } | null = null;
  private language = speechLang(null);
  private target: DictationTarget | null = null;
  private hovered: Anchor | null = null;
  private listening = false;
  /** Listening runs so far; output of an older run (before the latest start) is dropped. */
  private run = 0;
  /** Engine output is taken while listening and, after a stop, until this local time (the final may come late). */
  private acceptUntil = 0;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private utter: Utterance | null = null;
  /** Own utterances so far (caption ids `<self>:<n>`). */
  private n = 0;
  private disposed = false;
  /** Log entries already looked at, by count. */
  private seen: number;
  /** Per other speaker: what its captions have reached (PeerCaptions). */
  private readonly peers = new Map<string, PeerCaptions>();
  /** Final captions of other speakers, until they fade. */
  private finals: Caption[] = [];
  private readonly ready: Promise<void>;

  constructor(private readonly host: CaptionHost) {
    this.factories = [...host.engines];
    this.engineId = this.factories.some((f) => f.info.id === 'fake') ? 'fake' : (this.factories[0]?.info.id ?? 'webspeech');
    this.seen = host.log().length;
    this.ready = Promise.all([host.settings.get('speechEngine').catch(() => null), host.settings.get('speechLang').catch(() => null)]).then(([engine, lang]) => {
      if (this.disposed) return;
      this.language = speechLang(lang);
      if (engine && this.engineId !== 'fake' && this.factories.some((f) => f.info.id === engine)) this.engineId = engine;
      // A local model chosen earlier is warmed up from the browser's cache (it was chosen, so it may load).
      if (this.engineId === 'local') void this.ensureEngine().then((e) => this.loadLocal(e)).catch(() => undefined);
    });
    this.unsubs.push(host.onState(() => this.onLog()));
    this.unsubs.push(host.presence.subscribe(() => this.rebuild()));
    if (host.talk) {
      const talk = host.talk;
      this.unsubs.push(talk.subscribe((s) => this.onTalk(s)));
      this.onTalk(talk.state());
    }
    this.rebuild();
  }

  // --- CaptionControls ---------------------------------------------------------------------------------------------

  captions(): Caption[] {
    return [...this.list];
  }

  subscribe(listener: (captions: Caption[]) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  engine(): SpeechEngineInfo {
    return this.factory(this.engineId)?.info ?? { id: this.engineId, label: this.engineId, audio: 'none', statement: 'No speech engine is available.' };
  }

  async engines(): Promise<{ info: SpeechEngineInfo; available: boolean }[]> {
    return Promise.all(
      this.factories.map(async (f) => {
        try {
          // A factory that can say so without loading (voice/speech/index.ts ProbedSpeechEngineFactory) is asked that
          // way; the others are created to ask their engine.
          const probed = 'available' in f && typeof f.available === 'function' ? (f as { available(): Promise<boolean> }) : null;
          const available = probed ? await probed.available() : await (await f.create()).available();
          return { info: f.info, available };
        } catch {
          return { info: f.info, available: false };
        }
      }),
    );
  }

  async setEngine(id: SpeechEngineId, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    await this.ready;
    const f = this.factory(id);
    if (!f) throw new Error(`No speech engine '${id}' here`);
    if (id === this.engineId && this.engineInst?.id === id) {
      if (id === 'local') await this.loadLocal(await this.engineInst.engine, onProgress);
      return;
    }
    // Create (and for the local model, download) first: a failed download leaves the engine as it was.
    const engine = f.create();
    if (id === 'local') await this.loadLocal(await engine, onProgress);
    else await engine;
    const wasListening = this.listening;
    if (wasListening) this.stopListening();
    this.engineId = id;
    this.replaceEngine({ id, engine });
    if (id === 'webspeech' || id === 'local') await this.host.settings.set('speechEngine', id);
    if (wasListening) this.startListening();
  }

  lang(): string {
    return this.language;
  }

  async setLang(lang: string): Promise<void> {
    await this.ready;
    const tag = lang.trim();
    if (!tag) return;
    this.language = tag;
    await this.host.settings.set('speechLang', tag);
    // The engine listens in one language: an open microphone switches at once.
    if (this.listening) {
      this.stopListening();
      this.startListening();
    }
  }

  dictateInto(target: DictationTarget | null): void {
    this.target = target;
  }

  hover(anchor: Anchor | null): void {
    this.hovered = anchor;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.listening) this.stopListening();
    if (this.utter?.route === 'caption') this.host.presence.captionInterim(null);
    this.utter = null;
    for (const u of this.unsubs.splice(0)) u();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.graceTimer) clearTimeout(this.graceTimer);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    if (this.engineInst) release(this.engineInst.engine);
    this.engineInst = null;
    this.listeners.clear();
    this.list = [];
  }

  // --- Engine and listening ----------------------------------------------------------------------------------------

  private factory(id: SpeechEngineId): SpeechEngineFactory | undefined {
    return this.factories.find((f) => f.info.id === id);
  }

  private ensureEngine(): Promise<SpeechEngine> {
    if (this.engineInst?.id === this.engineId) return this.engineInst.engine;
    const f = this.factory(this.engineId);
    if (!f) return Promise.reject(new Error('No speech engine is available'));
    const engine = f.create();
    this.replaceEngine({ id: this.engineId, engine });
    engine.catch(() => {
      if (this.engineInst?.engine === engine) this.engineInst = null;
    });
    return engine;
  }

  /** Make `next` the engine in use and release the one it replaces (its microphone, audio graph and model). */
  private replaceEngine(next: { id: SpeechEngineId; engine: Promise<SpeechEngine> }): void {
    const old = this.engineInst;
    this.engineInst = next;
    if (old && old.engine !== next.engine) release(old.engine);
  }

  private async loadLocal(engine: SpeechEngine, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const local = engine as Partial<LocalSpeechEngine>;
    if (typeof local.load === 'function') await local.load(onProgress);
  }

  private onTalk(s: TalkState): void {
    if (this.disposed) return;
    const want = s.dictation !== 'off';
    if (want && !this.listening) this.startListening();
    else if (!want && this.listening) this.stopListening();
  }

  private startListening(): void {
    this.listening = true;
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    // A new press starts a new utterance; one still waiting for its final keeps the words it had.
    if (this.utter) this.finishUtterance(this.utter.text);
    const run = ++this.run;
    void this.ready
      .then(() => this.ensureEngine())
      .then((engine) => {
        if (!this.listening || this.disposed || run !== this.run) return;
        engine.start(this.language, (text, final) => {
          if (run === this.run) this.onText(text, final);
        });
      })
      .catch((e: unknown) => {
        console.warn('Spellplane: dictation could not start', e);
      });
  }

  private stopListening(): void {
    this.listening = false;
    this.acceptUntil = this.host.now() + FINAL_GRACE_MS;
    void this.engineInst?.engine.then((e) => e.stop()).catch(() => undefined);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    // An engine that never sends the final text: the words the others already saw are what was said.
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.utter && !this.listening) this.finishUtterance(this.utter.text);
    }, FINAL_GRACE_MS);
  }

  // --- Own utterances ----------------------------------------------------------------------------------------------

  private onText(text: string, final: boolean): void {
    if (this.disposed) return;
    if (!this.listening && this.host.now() > this.acceptUntil) return;
    const t = text.replace(/\s+/g, ' ').trim().slice(0, CAPTION_MAX_CHARS);
    if (!final && !t) return;
    if (!this.utter) {
      if (final && !t) return;
      this.utter = this.beginUtterance();
    }
    if (final) this.finishUtterance(t);
    else this.growUtterance(t);
  }

  private beginUtterance(): Utterance {
    const self = this.host.self();
    const state = this.host.state();
    const id = `${self}:${++this.n}`;
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    if (this.target) return { id, route: 'field', target: this.target, anchor: null, about: undefined, text: '' };
    const seated = Object.hasOwn(state.seats, self);
    const last = seated ? lastTouched(this.host.log(), self) : null;
    const anchor = publicAnchor(state, this.hovered) ?? publicAnchor(state, last?.anchor);
    return { id, route: 'caption', target: null, anchor, about: last?.about, text: '' };
  }

  private growUtterance(text: string): void {
    const u = this.utter!;
    u.text = text;
    if (u.route === 'field') {
      if (u.target?.kind === 'field') u.target.insert(text, false);
      return;
    }
    this.upsertOwn({ id: u.id, speaker: this.host.self(), text, final: false, anchor: u.anchor, at: this.host.now() });
    this.host.presence.captionInterim(text, u.anchor);
  }

  private finishUtterance(text: string): void {
    const u = this.utter;
    if (!u) return;
    this.utter = null;
    if (u.route === 'field') {
      if (text) this.writeField(u.target, text);
      else if (u.target?.kind === 'field' && u.text) u.target.insert('', true);
      return;
    }
    if (!text) {
      this.removeOwn(u.id);
      this.host.presence.captionInterim(null);
      return;
    }
    const caption: Caption = { id: u.id, speaker: this.host.self(), text, final: true, anchor: u.anchor, at: this.host.now() };
    if (u.about !== undefined) caption.about = u.about;
    this.upsertOwn(caption);
    this.host.caption(text, u.anchor ?? undefined, u.about);
    this.later(() => this.removeOwn(u.id, caption), CAPTION_LINGER_MS);
    // The others drop the interim when the caption action lands; the presence is cleared once that had time to happen.
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      this.clearTimer = null;
      if (!this.utter) this.host.presence.captionInterim(null);
    }, INTERIM_CLEAR_MS);
  }

  private writeField(target: DictationTarget | null, text: string): void {
    if (!target) return;
    if (target.kind === 'field') {
      target.insert(text, true);
      return;
    }
    const state = this.host.state();
    if (target.kind === 'cardNote') {
      const c = state.cards[target.card];
      if (!c) return;
      this.host.note(target, appendText(c.note, text).slice(0, NOTE_MAX_CHARS));
    } else {
      const item = state.stack.find((s) => s.id === target.item);
      if (!item) return;
      this.host.note(target, appendText(item.note, text).slice(0, NOTE_MAX_CHARS));
    }
  }

  private own: Caption[] = [];

  private upsertOwn(c: Caption): void {
    const i = this.own.findIndex((x) => x.id === c.id);
    if (i >= 0) this.own[i] = c;
    else this.own.push(c);
    this.rebuild();
  }

  /** Drop an own caption (only `exact` if given, so a newer version of it is kept). */
  private removeOwn(id: string, exact?: Caption): void {
    const before = this.own.length;
    this.own = this.own.filter((c) => c.id !== id || (exact !== undefined && c !== exact));
    if (this.own.length !== before) this.rebuild();
  }

  // --- Others' captions --------------------------------------------------------------------------------------------

  /** The speaker key of a peer's presence: its seat, or its spectator id. */
  private speakerOf(p: Pick<PeerPresence, 'seat' | 'peerId'>): string {
    return p.seat ?? `v:${p.peerId}`;
  }

  private peerState(key: string): PeerCaptions {
    let s = this.peers.get(key);
    if (!s) {
      s = { finals: 0, consumed: null, lastFinal: null, shown: null, since: 0 };
      this.peers.set(key, s);
    }
    return s;
  }

  private onLog(): void {
    if (this.disposed) return;
    const log = this.host.log();
    // A shorter log (a snapshot resync) is history as it stands: its captions were already shown or are old.
    if (log.length < this.seen) this.seen = log.length;
    const self = this.host.self();
    let added = false;
    for (let i = this.seen; i < log.length; i++) {
      const e = log[i]!;
      if (e.kind !== 'action' || e.action.type !== 'caption' || e.action.by === self) continue;
      // A final from the log replaces the interim of the same speaker (same caption id), and that presence caption
      // is spent: it is not shown again.
      const a = e.action;
      const key = a.by;
      const ps = this.peerState(key);
      const presence = this.host.presence.peers().find((p) => this.speakerOf(p) === key);
      ps.consumed = presence?.caption ?? null;
      ps.lastFinal = a.text;
      const caption: Caption = { id: `${key}:${ps.finals}`, speaker: key, text: a.text, final: true, anchor: a.anchor ?? null, at: this.host.now() };
      if (a.about !== undefined) caption.about = a.about;
      ps.finals++;
      this.finals = [...this.finals.filter((c) => c.id !== caption.id), caption];
      this.later(() => {
        this.finals = this.finals.filter((c) => c !== caption);
        this.rebuild();
      }, CAPTION_LINGER_MS);
      added = true;
    }
    this.seen = log.length;
    if (added) this.rebuild();
  }

  private rebuild(): void {
    if (this.disposed) return;
    const now = this.host.now();
    const self = this.host.self();
    const interims: Caption[] = [];
    for (const p of this.host.presence.peers()) {
      const key = this.speakerOf(p);
      if (key === self) continue;
      if (!p.caption) {
        // The speaker cleared its caption: whatever comes next is a new utterance.
        const ps = this.peers.get(key);
        if (ps) ps.lastFinal = null;
        continue;
      }
      const ps = this.peerState(key);
      if (p.caption === ps.consumed) continue;
      // Presence is unordered against the log: an interim of the utterance whose final already came is late, not new.
      if (ps.lastFinal !== null && lateInterim(p.caption.text, ps.lastFinal)) continue;
      if (p.caption !== ps.shown) {
        ps.shown = p.caption;
        ps.since = now;
        this.later(() => this.rebuild(), INTERIM_STALE_MS + 1);
      }
      if (now - ps.since > INTERIM_STALE_MS) continue;
      const id = `${key}:${ps.finals}`;
      // A final already showing under this id wins over a late interim.
      if (this.finals.some((c) => c.id === id)) continue;
      interims.push({ id, speaker: key, text: p.caption.text, final: false, anchor: p.caption.anchor, at: ps.since });
    }
    const next = [...this.own, ...this.finals, ...interims].sort((a, b) => a.at - b.at);
    if (next.length === this.list.length && next.every((c, i) => c === this.list[i] || sameCaption(c, this.list[i]!))) return;
    this.list = next;
    const out = this.captions();
    for (const l of [...this.listeners]) l(out);
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(t);
  }
}

/**
 * Per other speaker: finals received (the next caption id), the presence caption the last final replaced, that
 * final's text until the speaker's presence caption is cleared, and the interim shown with when it last changed.
 */
interface PeerCaptions {
  finals: number;
  consumed: PeerPresence['caption'];
  lastFinal: string | null;
  shown: PeerPresence['caption'];
  since: number;
}

function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether interim text belongs to the utterance that ended with `final` (the same words, or the start of them). */
export function lateInterim(interim: string, final: string): boolean {
  const i = wordsOf(interim);
  const f = wordsOf(final);
  return i === f || f.startsWith(i);
}

/** Stop an engine and free what it holds (LocalWhisperEngine.dispose: microphone, audio graph, model). */
function release(engine: Promise<SpeechEngine>): void {
  void engine
    .then((e) => {
      e.stop();
      (e as { dispose?: () => void }).dispose?.();
    })
    .catch(() => undefined);
}

function sameCaption(a: Caption, b: Caption): boolean {
  return a.id === b.id && a.text === b.text && a.final === b.final && a.about === b.about && JSON.stringify(a.anchor) === JSON.stringify(b.anchor);
}

/** Create the caption controller (voice/types.ts CaptionControls). */
export const createCaptions: CreateCaptions = (host) => new CaptionController(host);
