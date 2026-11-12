/**
 * Dictation and captions for a networked table (DESIGN "Chat and voice", Dictation and captions; PLAN M3-P4): builds
 * the CaptionHost (voice/types.ts) from the session and creates the caption controller. Mounted by session/net.ts when
 * the session has voice options. Implementer: M3-P4.
 *
 * Listening follows the session's talk state (`session.voice`, M3-P3). Without voice controls (a page that has not
 * joined the microphone, or a build without them) the talk mode stored in settings still opens dictation where no key
 * is needed: dictation with an open gate, or with the turn gate during the own turn (DESIGN "Chat and voice", Talk
 * modes: "Dictation … for the whole own turn when combined with Turn mic").
 *
 * Dictation that opens without a key press (the open or the turn gate) waits until the player acted on the page: with
 * voice controls until the microphone was joined (DESIGN "Chat and voice", Live voice: "The microphone is acquired once
 * on joining the table (a click…)"), without them until a first click or key press, so a browser never shows its
 * microphone prompt on its own. The talk key is such an action itself.
 */
import type { SeatId, TableState } from '../core/types';
import { isSeatActive } from '../core/teams';
import { DEFAULT_TALK, type SettingsStore, type TalkSettings } from '../store/types';
import { createCaptions } from '../voice/captions';
import { TALK_CLOSED, type CaptionControls, type CaptionHost, type TalkState, type VoiceControls } from '../voice/types';
import type { TableSession, VoiceSessionOptions } from './types';

type Talk = Pick<VoiceControls, 'state' | 'subscribe'>;
type Voice = Talk & Partial<Pick<VoiceControls, 'joined'>>;

/** Whether the player has clicked or pressed a key on this page yet (a microphone prompt should follow such an act). */
export interface Activation {
  active(): boolean;
  /** Called once the page becomes active. */
  subscribe(listener: () => void): () => void;
}

/** The page's user activation: the browser's sticky activation, else the first pointer or key press seen. */
export function pageActivation(): Activation {
  if (typeof window === 'undefined') return { active: () => true, subscribe: () => () => undefined };
  const sticky = (): boolean => (navigator as { userActivation?: { hasBeenActive?: boolean } }).userActivation?.hasBeenActive === true;
  let seen = sticky();
  const listeners = new Set<() => void>();
  const on = (e: Event): void => {
    if (!e.isTrusted || seen) return;
    seen = true;
    for (const l of [...listeners]) l();
  };
  return {
    active: () => seen || (seen = sticky()),
    subscribe(listener) {
      if (listeners.size === 0) for (const t of ['pointerdown', 'keydown'] as const) window.addEventListener(t, on, { capture: true });
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) for (const t of ['pointerdown', 'keydown'] as const) window.removeEventListener(t, on, { capture: true });
      };
    },
  };
}

/** `s`, or closed while dictation would open without a key and the player has not acted yet. */
function gated(s: TalkState, acted: boolean): TalkState {
  return s.dictation !== 'off' && s.reason !== 'key' && !acted ? { ...s, dictation: 'off', reason: s.audio === 'off' ? null : s.reason } : s;
}

/** The dictation state the stored talk mode gives without a talk key (no voice controls). */
export function settingsDictation(talk: TalkSettings, state: TableState, seat: SeatId | null): TalkState {
  if (!talk.dictation || talk.muted || !seat) return TALK_CLOSED;
  if (talk.gate === 'open') return { audio: 'off', dictation: 'caption', reason: 'open', muted: false };
  if (talk.gate === 'turn' && Object.hasOwn(state.seats, seat) && isSeatActive(state, seat)) return { audio: 'off', dictation: 'caption', reason: 'turn', muted: false };
  return TALK_CLOSED;
}

/**
 * A talk source from the stored talk mode and the turn (used while the session has no voice controls). The stored mode
 * is read again whenever the turn passes, so a changed setting takes effect by the next turn at the latest.
 */
function settingsTalk(settings: SettingsStore, session: Pick<TableSession, 'getState' | 'subscribe' | 'seat'>): Talk & { dispose(): void } {
  let talk: TalkSettings = DEFAULT_TALK;
  const listeners = new Set<(s: TalkState) => void>();
  let current: TalkState = TALK_CLOSED;
  let disposed = false;
  const seat = (): SeatId | null => session.seat ?? null;
  const update = (): void => {
    if (disposed) return;
    const next = settingsDictation(talk, session.getState(), seat());
    if (next.dictation === current.dictation && next.reason === current.reason) return;
    current = next;
    for (const l of [...listeners]) l(current);
  };
  const read = (): void => {
    void settings
      .get('talk')
      .then((t) => {
        talk = { ...DEFAULT_TALK, ...t };
        update();
      })
      .catch(() => undefined);
  };
  read();
  let turn = session.getState().turn.active;
  const unsub = session.subscribe(() => {
    const active = session.getState().turn.active;
    if (active !== turn) {
      turn = active;
      read();
    }
    update();
  });
  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      unsub();
      listeners.clear();
    },
  };
}

/**
 * The talk state dictation follows: the session's voice controls (M3-P3) when it has them, else the stored talk mode.
 * Voice controls mounted after the captions are picked up on the next tick or state change, and from then on win.
 */
export function talkSource(session: Pick<TableSession, 'getState' | 'subscribe' | 'seat'> & { voice?: Voice | undefined }, settings: SettingsStore, activation: Activation = pageActivation()): Talk & { dispose(): void } {
  const listeners = new Set<(s: TalkState) => void>();
  let fallback: (Talk & { dispose(): void }) | null = session.voice ? null : settingsTalk(settings, session);
  let using: Voice = session.voice ?? fallback!;
  const acted = (): boolean => (using === fallback ? activation.active() : using.joined === true);
  const current = (): TalkState => gated(using.state(), acted());
  let last: TalkState | null = null;
  const emit = (): void => {
    const s = current();
    if (last && s.dictation === last.dictation && s.reason === last.reason && s.audio === last.audio && s.muted === last.muted) return;
    last = s;
    for (const l of [...listeners]) l(s);
  };
  let unsubUsing = using.subscribe(emit);
  let disposed = false;
  const adopt = (): void => {
    const voice = session.voice;
    if (disposed || !voice || voice === using) return;
    unsubUsing();
    fallback?.dispose();
    fallback = null;
    using = voice;
    unsubUsing = voice.subscribe(emit);
    emit();
  };
  const unsubSession = session.subscribe(() => {
    adopt();
    // The microphone may have been joined meanwhile.
    emit();
  });
  const unsubActivation = activation.subscribe(emit);
  queueMicrotask(adopt);
  return {
    state: current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      unsubSession();
      unsubActivation();
      unsubUsing();
      fallback?.dispose();
      listeners.clear();
    },
  };
}

/**
 * Create the session's caption controller (TableSession.captions). Mount it after the voice controls (session.voice);
 * voice controls that arrive later are still adopted (talkSource).
 */
export function mountCaptions(session: TableSession, voice: Pick<VoiceSessionOptions, 'settings' | 'engines'>, now: () => number = () => Date.now()): CaptionControls {
  const talk = talkSource(session, voice.settings);
  const host: CaptionHost = {
    self: () => session.seat,
    state: () => session.getState(),
    log: () => session.log(),
    onState: (listener) => session.subscribe(listener),
    caption: (text, anchor, about) => {
      session.dispatch({ type: 'caption', text, ...(anchor ? { anchor } : {}), ...(about !== undefined ? { about } : {}) });
    },
    note: (target, text) => {
      if (target.kind === 'cardNote') session.dispatch({ type: 'note', card: target.card, text });
      else session.dispatch({ type: 'stackNote', item: target.item, note: text });
    },
    // Through the session, so a rejoin's new engine is the one used.
    presence: {
      captionInterim: (text, anchor) => session.presence.captionInterim(text, anchor ?? null),
      peers: () => session.presence.peers(),
      subscribe: (listener) => session.presence.subscribe(listener),
    },
    talk,
    engines: voice.engines,
    settings: voice.settings,
    now,
  };
  const controls = createCaptions(host);
  const dispose = controls.dispose.bind(controls);
  return Object.assign(controls, {
    dispose: () => {
      dispose();
      talk.dispose();
    },
  });
}
