/**
 * A table for the caption controller's tests (voice/types.ts CaptionHost): shared state built through the reducer, a
 * log, presence with scripted peers, a talk state the test opens and closes, in-memory settings, and engine factories
 * that count what they create.
 */
import type { Action, ActionDraft } from '../../../src/core/actions';
import type { Anchor, LogEntry, SeatId, TableState } from '../../../src/core/types';
import type { PeerPresence } from '../../../src/net/types';
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '../../../src/store/types';
import { FakeSpeechEngine } from '../../../src/voice/fake';
import type { ProbedSpeechEngineFactory } from '../../../src/voice/speech/index';
import { TALK_CLOSED, type CaptionHost, type DictationTarget, type SpeechEngine, type SpeechEngineFactory, type SpeechEngineId, type TalkState } from '../../../src/voice/types';
import { act, ok } from '../core/helpers';

export const OPEN: TalkState = { audio: 'off', dictation: 'caption', reason: 'key', muted: false };

export function memorySettings(init: Partial<Settings> = {}): SettingsStore & { data: Settings } {
  const data: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...init };
  return {
    data,
    get: async (k) => structuredClone(data[k]),
    set: async (k, v) => {
      data[k] = v;
    },
    all: async () => structuredClone(data),
  };
}

/** A factory whose engines are counted (and, for 'local', loadable). */
export function countingFactory(id: SpeechEngineId, make: () => SpeechEngine = () => new FakeSpeechEngine()): ProbedSpeechEngineFactory & { created: SpeechEngine[] } {
  const created: SpeechEngine[] = [];
  return {
    created,
    info: { id, label: id, audio: id === 'local' ? 'device' : id === 'webspeech' ? 'vendor' : 'none', statement: `${id} statement` },
    create: async () => {
      const e = make();
      created.push(e);
      return e;
    },
    available: async () => true,
  };
}

export class TestTable {
  state: TableState;
  log: LogEntry[] = [];
  seq = 0;
  talkState: TalkState = TALK_CLOSED;
  readonly talkListeners = new Set<(s: TalkState) => void>();
  readonly stateListeners = new Set<(s: TableState) => void>();
  readonly presenceListeners = new Set<(p: PeerPresence[]) => void>();
  peers: PeerPresence[] = [];
  /** Own interim captions sent on presence. */
  readonly interims: { text: string | null; anchor: Anchor | null }[] = [];
  clock = 1000;

  constructor(
    state: TableState,
    readonly me: SeatId,
    readonly settings = memorySettings(),
    readonly engines: SpeechEngineFactory[] = [countingFactory('fake')],
  ) {
    this.state = state;
  }

  /** Apply an action as sequenced (by anyone) and tell the listeners. */
  apply(a: Action): Action {
    this.state = ok(this.state, a);
    const sequenced = { ...a, seq: ++this.seq };
    this.log.push({ kind: 'action', seq: this.seq, at: this.clock, action: sequenced });
    for (const l of [...this.stateListeners]) l(this.state);
    return sequenced;
  }

  dispatchDraft(d: ActionDraft, by = this.me): Action {
    return this.apply({ ...(d as object), by, cid: `${by}-c${this.seq + 1}` } as Action);
  }

  setTalk(s: TalkState): void {
    this.talkState = s;
    for (const l of [...this.talkListeners]) l(s);
  }

  setPeer(p: Partial<PeerPresence> & { peerId: string }): void {
    const prev = this.peers.find((x) => x.peerId === p.peerId);
    const next: PeerPresence = { seat: null, cursor: null, over: null, drag: [], speaking: false, typing: null, caption: null, at: this.clock, ...prev, ...p };
    this.peers = [...this.peers.filter((x) => x.peerId !== p.peerId), next];
    for (const l of [...this.presenceListeners]) l(this.peers);
  }

  captionsSent(): Extract<Action, { type: 'caption' }>[] {
    return this.log.flatMap((e) => (e.kind === 'action' && e.action.type === 'caption' ? [e.action] : []));
  }

  host(opts: { talk?: boolean } = {}): CaptionHost {
    return {
      self: () => this.me,
      state: () => this.state,
      log: () => this.log,
      onState: (l) => {
        this.stateListeners.add(l);
        return () => this.stateListeners.delete(l);
      },
      caption: (text, anchor, about) => {
        this.dispatchDraft({ type: 'caption', text, ...(anchor ? { anchor } : {}), ...(about !== undefined ? { about } : {}) });
      },
      note: (target: Exclude<DictationTarget, { kind: 'field' }>, text) => {
        if (target.kind === 'cardNote') this.dispatchDraft({ type: 'note', card: target.card, text });
        else this.dispatchDraft({ type: 'stackNote', item: target.item, note: text });
      },
      presence: {
        captionInterim: (text, anchor) => {
          this.interims.push({ text, anchor: anchor ?? null });
        },
        peers: () => this.peers,
        subscribe: (l) => {
          this.presenceListeners.add(l);
          return () => this.presenceListeners.delete(l);
        },
      },
      ...(opts.talk === false
        ? {}
        : {
            talk: {
              state: () => this.talkState,
              subscribe: (l: (s: TalkState) => void) => {
                this.talkListeners.add(l);
                return () => this.talkListeners.delete(l);
              },
            },
          }),
      engines: this.engines,
      settings: this.settings,
      now: () => Date.now(),
    };
  }
}

export { act };
