/**
 * Dictation and captions for a networked table (DESIGN "Chat and voice", Dictation and captions; PLAN M3-P4): builds
 * the CaptionHost (voice/types.ts) from the session and creates the caption controller. Mounted by session/net.ts when
 * the session has voice options. Implementer: M3-P4.
 *
 * Listening follows the session's talk state (`session.voice`, M3-P3). Without voice controls (a page that has not
 * joined the microphone, or a build without them) the talk mode stored in settings still opens dictation where no key
 * is needed: dictation with an open gate, or with the turn gate during the own turn (DESIGN "Chat and voice", Talk
 * modes: "Dictation … for the whole own turn when combined with Turn mic").
 */
import type { SeatId, TableState } from '../core/types';
import { isSeatActive } from '../core/teams';
import { DEFAULT_TALK, type SettingsStore, type TalkSettings } from '../store/types';
import { createCaptions } from '../voice/captions';
import { TALK_CLOSED, type CaptionControls, type CaptionHost, type TalkState, type VoiceControls } from '../voice/types';
import type { TableSession, VoiceSessionOptions } from './types';

type Talk = Pick<VoiceControls, 'state' | 'subscribe'>;

/** The dictation state the stored talk mode gives without a talk key (no voice controls). */
export function settingsDictation(talk: TalkSettings, state: TableState, seat: SeatId | null): TalkState {
  if (!talk.dictation || talk.muted || !seat) return TALK_CLOSED;
  if (talk.gate === 'open') return { audio: 'off', dictation: 'caption', reason: 'open', muted: false };
  if (talk.gate === 'turn' && Object.hasOwn(state.seats, seat) && isSeatActive(state, seat)) return { audio: 'off', dictation: 'caption', reason: 'turn', muted: false };
  return TALK_CLOSED;
}

/** A talk source from the stored talk mode and the turn (used while the session has no voice controls). */
function settingsTalk(settings: SettingsStore, session: Pick<TableSession, 'getState' | 'subscribe' | 'seat'>): Talk & { dispose(): void } {
  let talk: TalkSettings = DEFAULT_TALK;
  const listeners = new Set<(s: TalkState) => void>();
  let current: TalkState = TALK_CLOSED;
  const seat = (): SeatId | null => session.seat ?? null;
  const update = (): void => {
    const next = settingsDictation(talk, session.getState(), seat());
    if (next.dictation === current.dictation && next.reason === current.reason) return;
    current = next;
    for (const l of [...listeners]) l(current);
  };
  void settings
    .get('talk')
    .then((t) => {
      talk = { ...DEFAULT_TALK, ...t };
      update();
    })
    .catch(() => undefined);
  const unsub = session.subscribe(() => update());
  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsub();
      listeners.clear();
    },
  };
}

/** Create the session's caption controller (TableSession.captions). Call after the voice controls are mounted. */
export function mountCaptions(session: TableSession, voice: Pick<VoiceSessionOptions, 'settings' | 'engines'>, now: () => number = () => Date.now()): CaptionControls {
  const fallback = session.voice ? null : settingsTalk(voice.settings, session);
  const talk: Talk = session.voice ?? fallback!;
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
      fallback?.dispose();
    },
  });
}
