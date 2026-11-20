/**
 * The lobby module test page, `?harness=lobby` (docs/design/m8/contracts.md Part C "Harness pages"; PLAN M8-P4): the
 * waiting room, the invite and join sheets, the versus screen, the 0-life chip and the game-over overlay over a fake
 * room model (a table that applies actions through core's reducer, a fake identity, deck library and network status),
 * with stand-ins for M8-P3's deck picker and booster setup sheets. Query options:
 * `view` room | invite | join | versus | over | chip; `me` s0 | s1 | spec; `ben` (Ben sits in s1), `annReady`,
 * `benReady`, `rule=booster` (the table's deck rule), `draft` (lobby settings with a live draft), `auto` (automatic
 * setup), `format`, `kind` private | matched | draft, `rated` (a rating change), `low` (Ben at 0 life), `poison`,
 * `apart` (the other browser not connected), `deck=<id>` (Home's selected deck).
 * Test API: window.__lobbyHarness.
 */
import { mount as mountSvelte, unmount, type Component } from 'svelte';
import '../design/base.css';
import type { Action, ActionDraft } from '../../core/actions';
import { createTable, explain, reduce } from '../../core/reducer/index';
import type { CardRef, Format, MatchRecord, SeatId, SecretStore, TableState } from '../../core/types';
import { mtg } from '../../games/index';
import type { BoosterSetup, DeckRecord, DeckStore, HomePrefs, IdentityStore, SettingsStore } from '../../store/types';
import { DEFAULT_HOME_PREFS } from '../../store/types';
import type { EveningControls, NetStatusListener, SessionNetStatus } from '../../session/types';
import { cssText } from '../../themes/index';
import { DEFAULT_LOOK } from '../../themes/types';
import { designCssVars, lookTokens } from '../design/tokens';
import { FakeCardData, FakeSession } from '../fakes';
import ConcedeChip from '../play/ConcedeChip.svelte';
import GameOver from '../play/GameOver.svelte';
import Versus from '../play/Versus.svelte';
import HarnessBoosters from './HarnessBoosters.svelte';
import HarnessPicker from './HarnessPicker.svelte';
import InviteSheet from './InviteSheet.svelte';
import JoinSheet from './JoinSheet.svelte';
import { roomLink } from './room';
import { codeLabel, type EndKind } from './waiting';
import WaitingRoom from './WaitingRoom.svelte';

const ANN = 'aaaaaaaaaaaaaaaa';
const BEN = 'bbbbbbbbbbbbbbbb';
const refs = (n: number, sid: string): CardRef[] => Array.from({ length: n }, () => ({ sid }));
const AT = 1_700_000_000_000;

/** The fake library: a custom deck and a booster (sealed) deck. Their names never reach the other seat. */
export const HARNESS_DECKS: DeckRecord[] = [
  { id: 'deck-gruul', name: 'Gruul Stompy', main: refs(60, 'sid-caller'), side: [], source: 'pasted', kind: 'custom', createdAt: AT, updatedAt: AT + 2 },
  { id: 'deck-m19', name: 'M19 Booster Deck', main: refs(40, 'sid-dfc'), side: [], source: 'built', kind: 'sealed', createdAt: AT, updatedAt: AT + 1 },
];

/** What the page exposes to Playwright. */
export interface LobbyHarness {
  state(): TableState;
  sent(): Action[];
  library(): Promise<DeckRecord[]>;
  setConnected(on: boolean): void;
  /** Apply an action as another seat (through core's reducer). */
  dispatchAs(by: SeatId, draft: ActionDraft): void;
  joined: string | null;
  homeCalls: number;
  proposals: string[];
}

declare global {
  interface Window {
    __lobbyHarness?: LobbyHarness;
  }
}

/** A fake room: actions go through core's reducer; `settings { decks }`, which the reducer does not take yet, is set directly. */
export class RoomModel extends FakeSession {
  private net: SessionNetStatus;
  private readonly netListeners = new Set<NetStatusListener>();
  readonly sent: Action[] = [];
  readonly proposals: string[] = [];
  readonly role: 'player' | 'spectator';
  readonly evening: EveningControls;
  constructor(state: TableState, seat: SeatId, connected: boolean, spectator: boolean) {
    const secrets = { identities: {}, hand: [], libraryOrder: [] } as unknown as SecretStore;
    super(state, secrets, new FakeCardData(), seat);
    this.role = spectator ? 'spectator' : 'player';
    this.net = { mode: 'net', connection: 'connected', peers: [], sequencer: ANN, seq: state.seq };
    this.setConnected(connected);
    this.evening = {
      setLobby: (lobby) => this.dispatch({ type: 'lobbySet', lobby }),
      start: () => this.dispatch({ type: 'stageSet', stage: 'draft' }),
      propose: (event) => {
        this.proposals.push(event);
        return Promise.resolve(false);
      },
    };
  }
  override dispatch(draft: ActionDraft): Action {
    const st = this.getState();
    const action = { ...draft, by: this.seat, cid: `h-${this.sent.length + 1}`, seq: st.seq + 1 } as Action;
    if (action.type === 'settings' && 'decks' in action.settings) {
      this.sent.push(action);
      this.setState({ ...st, seq: st.seq + 1, settings: { ...st.settings, ...action.settings } });
      return action;
    }
    const reason = explain(st, action);
    if (reason) throw new Error(reason);
    this.sent.push(action);
    this.setState(reduce(st, action));
    return action;
  }
  override netStatus(): SessionNetStatus {
    return this.net;
  }
  override subscribeNet(listener: NetStatusListener): () => void {
    this.netListeners.add(listener);
    return () => this.netListeners.delete(listener);
  }
  setConnected(on: boolean): void {
    const others = Object.values(this.getState().seats).filter((s) => s.peer && s.id !== this.seat);
    this.net = { ...this.net, peers: others.map((s, i) => ({ transportId: `t-${i}`, peerId: s.peer!, nickname: s.name, seat: s.id, role: 'player', status: on ? 'connected' : 'handshake', lastSeq: 0 })) };
    for (const l of this.netListeners) l(this.net);
  }
}

function act(state: TableState, by: SeatId, draft: ActionDraft): TableState {
  const action = { ...draft, by, cid: `x-${state.seq}`, seq: state.seq + 1 } as Action;
  const reason = explain(state, action);
  if (reason) throw new Error(reason);
  return reduce(state, action);
}

/** The table the options describe. */
export function harnessTable(q: URLSearchParams): TableState {
  const format = (q.get('format') as Format | null) ?? '1v1';
  const n = format === '1v1' ? 2 : format === 'ffa3' ? 3 : 4;
  const view = q.get('view') ?? 'room';
  let t = createTable({ game: mtg, format, seats: Array.from({ length: n }, (_, i) => ({ name: '', colour: i })) });
  t = act(t, 's0', { type: 'seatTake', seat: 's0', name: 'Ann', colour: 0, peer: ANN });
  if (q.has('ben') || view !== 'room') t = act(t, 's1', { type: 'seatTake', seat: 's1', name: 'Ben', colour: 1, peer: BEN });
  if (q.has('draft')) t = act(t, 's0', { type: 'lobbySet', lobby: { draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19'], pickTimer: false } });
  if (q.has('auto')) t = act(t, 's0', { type: 'settings', settings: { autoSetup: true } });
  if (q.get('rule') === 'booster') t = { ...t, settings: { ...t.settings, decks: 'booster' } as TableState['settings'] };
  const ids = (seat: SeatId, k: number) => Array.from({ length: k }, (_, i) => `${seat}c${String(i).padStart(2, '0')}`);
  const ready = (seat: SeatId, k: number) => {
    t = act(t, seat, { type: 'ready', commits: ids(seat, k).map((id) => `h-${id}`), instanceIds: ids(seat, k), zone: `library:${seat}` });
  };
  if (q.has('annReady')) ready('s0', 60);
  if (q.has('benReady')) ready('s1', 40);
  if (view === 'over' || view === 'chip' || view === 'versus') {
    if (!q.has('annReady')) ready('s0', 60);
    if (!q.has('benReady')) ready('s1', 40);
    t = act(t, 's0', { type: 'stageSet', stage: 'match' });
  }
  if (view === 'over') {
    t = act(t, 's1', { type: 'concede' });
    t = { ...t, turn: { ...t.turn, number: 9 } };
  }
  if (view === 'chip' && q.has('low')) t = act(t, 's1', { type: 'life', seat: 's1', delta: -20 });
  if (view === 'chip' && q.has('poison')) t = act(t, 's1', { type: 'playerCounter', seat: 's1', kind: 'poison', delta: 10 });
  return t;
}

export function mount(target: HTMLElement): { destroy(): void } {
  const q = new URLSearchParams(location.search);
  const view = q.get('view') ?? 'room';
  const meParam = q.get('me') ?? 's0';
  const seat: SeatId = meParam === 's1' ? 's1' : 's0';
  const session = new RoomModel(harnessTable(q), seat, !q.has('apart'), meParam === 'spec');
  const link = roomLink(location.href, 'amber-fox-93', 'AAAAAAAAAAAAAAAAAAAAAA');
  let library = [...HARNESS_DECKS];
  const decks: DeckStore = {
    list: async () => library,
    get: async (id) => library.find((d) => d.id === id) ?? null,
    put: async (d) => void (library = [...library.filter((x) => x.id !== d.id), d]),
    delete: async (id) => void (library = library.filter((x) => x.id !== id)),
  } as DeckStore;
  const mine = seat === 's0' ? { peerId: ANN, nickname: 'Ann', seatColour: 0 } : { peerId: BEN, nickname: 'Ben', seatColour: 1 };
  const identity = {
    get: async () => ({ id: 'me', keyPair: null, ...mine }),
    setNickname: async () => undefined,
    setSeatColour: async () => undefined,
  } as unknown as IdentityStore;
  const home: HomePrefs = { ...DEFAULT_HOME_PREFS, mode: 'private', deckId: q.get('deck') ?? null, private: { format: '1v1', decks: 'any' } };
  const settings = { get: async (k: string) => (k === 'home' ? home : undefined), set: async () => undefined } as unknown as SettingsStore;

  const host = document.createElement('div');
  host.className = 'ds-root';
  host.setAttribute('style', `${cssText(designCssVars(lookTokens(DEFAULT_LOOK)))}; position: fixed; inset: 0; overflow: auto; background: var(--ds-mat);`);
  host.dataset.testid = 'lobby-harness';
  target.appendChild(host);
  const api: LobbyHarness = {
    state: () => session.getState(),
    sent: () => session.sent,
    library: async () => library,
    setConnected: (on) => session.setConnected(on),
    dispatchAs: (by, draft) => session.setState(act(session.getState(), by, draft)),
    joined: null,
    homeCalls: 0,
    proposals: session.proposals,
  };
  window.__lobbyHarness = api;
  const kind = (q.get('kind') as EndKind | null) ?? undefined;
  const record = q.has('rated') ? ({ rated: { key: 'ranked:1v1', before: 1500, after: 1512 } } as unknown as MatchRecord) : null;
  const onhome = () => void (api.homeCalls += 1);
  const app =
    view === 'invite'
      ? mountSvelte(InviteSheet, {
          target: host,
          props: { title: 'Invite players', text: 'Send this link, or let them scan the code. Whoever opens it sits down at your table.', link: link.url, code: codeLabel(link.roomId), status: 'Waiting for players · 1 of 2 here', spectatorLink: `${link.url}/watch` },
        })
      : view === 'join'
        ? mountSvelte(JoinSheet, { target: host, props: { onjoin: (hash: string) => void (api.joined = hash), onclose: () => undefined } })
        : view === 'versus'
          ? mountSvelte(Versus, { target: host, props: { session, creator: seat === 's0', onhome } })
          : view === 'over'
            ? mountSvelte(GameOver, { target: host, props: { session, kind, record, onhome } })
            : view === 'chip'
              ? mountSvelte(ConcedeChip, { target: host, props: { session } })
              : mountSvelte(WaitingRoom, {
                  target: host,
                  props: {
                    session,
                    game: mtg,
                    link,
                    identity,
                    decks,
                    cardData: new FakeCardData(),
                    settings,
                    picker: HarnessPicker as unknown as Component<{ allow?: ((deck: DeckRecord) => true | string) | undefined; onpick: (deck: DeckRecord) => void; onclose?: (() => void) | undefined }>,
                    boosterSheet: HarnessBoosters as unknown as Component<{ value: BoosterSetup; mode: 'deck' | 'draft'; onchange?: ((value: BoosterSetup) => void) | undefined; onclose?: (() => void) | undefined }>,
                  },
                });
  return {
    destroy: () => {
      void unmount(app);
      host.remove();
    },
  };
}
