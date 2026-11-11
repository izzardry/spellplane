/**
 * Confirmation and stack test page (`?harness=confirm`, dev and test builds only; see src/main.ts). Mounts the real
 * HUD and the real table scene for one seat over an in-page sequenced table: every action, the local player's and the
 * scripted remote player's, goes through one sequencer that stamps `seq`, applies the real reducer and runs the
 * confirmation deadlines on its own clock (core/deadlines.ts), as the networked session's sequencer does (DESIGN
 * "Specification: network protocol and secrecy", Timers). Playwright drives the remote player through
 * `window.__confirmHarness` and the local player with real keys (PLAN M1-P3 browser tests).
 *
 * URL: `?harness=confirm&seat=s0|s1&timer=<ms>&seats=Anna,Ben[,Cleo]&faces=placeholder`.
 */
import { mount as mountSvelte } from 'svelte';
import type { Action, ActionDraft } from '../../core/actions';
import { deadlines } from '../../core/deadlines';
import { explain, reduce } from '../../core/reducer';
import type { LogEntry, SeatId, SecretStore, TableState } from '../../core/types';
import { createTableScene } from '../../scene/index';
import { paper } from '../../themes/paper/index';
import { registerDebug } from '../../util/debug';
import { FakeCardData, FakeFaces, FakeSession, MemorySettings, fakeGame, tableWith, type FakeCardSpec } from '../fakes';
import Hud from '../Hud.svelte';
import type { HudProps } from '../props';

export interface ConfirmHarness {
  /** Dispatch a draft as another seat (a remote player's proposal); returns the stamped action, or the refusal. */
  remote(seat: SeatId, draft: ActionDraft): { action: Action; refused: string | null };
  /** Mark a seat away or back, as the sequencer's liveness rule does (M1-P7's `away`; patched in here). */
  away(seat: SeatId, away: boolean): void;
  state(): TableState;
  /** Every sequenced action, in order. */
  log(): Action[];
  /** Refusals (nacks), in order. */
  refused(): { action: Action; reason: string }[];
  /** Deadlines that fired on the sequencer's clock: key, local time and the seq they fired at. */
  fired(): { key: string; seq: number }[];
}

declare global {
  interface Window {
    __confirmHarness?: ConfirmHarness;
  }
}

const CARDS: FakeCardSpec[] = [
  { id: 'abear', zone: 'battlefield:s0', sid: 'sid-bear', pose: { x: -200, y: -300, rot: 0 } },
  { id: 'abolt', zone: 'hand:s0', sid: 'sid-bolt' },
  { id: 'acaller', zone: 'hand:s0', sid: 'sid-caller' },
  { id: 'bbear', zone: 'battlefield:s1', sid: 'sid-bear', pose: { x: 200, y: 300, rot: 180 } },
  { id: 'bbolt', zone: 'hand:s1', sid: 'sid-bolt' },
  { id: 'bcaller', zone: 'hand:s1', sid: 'sid-caller' },
  { id: 'cbear', zone: 'battlefield:s2', sid: 'sid-bear', pose: { x: 400, y: 300, rot: 180 } },
];

/** The one sequencer of the page: stamps, applies, logs, and fires confirmation deadlines on its clock. */
class Sequencer {
  readonly actions: Action[] = [];
  readonly entries: LogEntry[] = [];
  readonly refusals: { action: Action; reason: string }[] = [];
  readonly fired: { key: string; seq: number }[] = [];
  private readonly appliedAt = new Map<number, number>();
  private readonly armed = new Map<string, ReturnType<typeof setTimeout>>();
  private cid = 0;
  onChange: (state: TableState) => void = () => undefined;

  constructor(
    public state: TableState,
    readonly sequencerSeat: SeatId,
  ) {}

  submit(action: Action): { action: Action; refused: string | null } {
    const why = explain(this.state, action);
    if (why !== null) {
      this.refusals.push({ action, reason: why });
      return { action, refused: why };
    }
    const stamped = { ...action, seq: this.state.seq + 1 } as Action;
    this.state = reduce(this.state, stamped);
    this.appliedAt.set(stamped.seq!, performance.now());
    this.actions.push(stamped);
    this.entries.push({ kind: 'action', seq: stamped.seq!, at: Date.now(), action: stamped });
    this.onChange(this.state);
    this.arm();
    return { action: stamped, refused: null };
  }

  /** Patch a seat's away flag (stand-in for M1-P7's sequenced `away`). */
  setAway(seat: SeatId, away: boolean): void {
    const s = this.state.seats[seat];
    if (!s) return;
    const next = { ...s };
    if (away) next.away = true;
    else delete next.away;
    this.state = { ...this.state, seats: { ...this.state.seats, [seat]: next } };
    this.onChange(this.state);
    this.arm();
  }

  private arm(): void {
    const live = deadlines(this.state);
    const keys = new Set(live.map((d) => d.key));
    for (const [key, t] of this.armed) {
      if (keys.has(key)) continue;
      clearTimeout(t);
      this.armed.delete(key);
    }
    for (const d of live) {
      if (this.armed.has(d.key)) continue;
      const from = this.appliedAt.get(d.fromSeq) ?? performance.now();
      const wait = Math.max(0, from + d.afterMs - performance.now());
      this.armed.set(
        d.key,
        setTimeout(() => {
          this.armed.delete(d.key);
          const still = deadlines(this.state).find((x) => x.key === d.key);
          if (!still) return;
          this.fired.push({ key: d.key, seq: this.state.seq });
          for (const e of still.emit) this.submit({ ...e, by: this.sequencerSeat, cid: `clock-${++this.cid}` } as Action);
        }, wait),
      );
    }
  }
}

/** The local player's TableSession: the fake session's private effects, with dispatch through the sequencer. */
class HarnessSession extends FakeSession {
  private n = 0;
  constructor(
    private readonly sequencer: Sequencer,
    secrets: SecretStore,
    seat: SeatId,
  ) {
    super(sequencer.state, secrets, new FakeCardData(), seat);
    sequencer.onChange = (state) => {
      const sec = this.secrets();
      const hand = sec.hand.filter((id) => state.cards[id]?.zone === `hand:${seat}`);
      this.setState(state, hand.length === sec.hand.length ? undefined : { ...sec, hand });
    };
  }

  override dispatch(draft: ActionDraft): Action {
    // Like the solo session: a hidden own card that goes onto the stack is revealed first.
    if (draft.type === 'stackPush' && draft.card) {
      const c = this.getState().cards[draft.card];
      const id = this.secrets().identities[draft.card];
      if (c && !c.identity && id) this.sequencer.submit({ type: 'reveal', instanceId: c.id, ref: id.card, salt: id.salt, by: this.seat, cid: `${this.seat}-h${++this.n}` });
    }
    return this.sequencer.submit({ ...draft, by: this.seat, cid: `${this.seat}-h${++this.n}` } as Action).action;
  }

  override log(): LogEntry[] {
    return this.sequencer.entries;
  }
}

export function mount(target: HTMLElement): void {
  target.textContent = '';
  document.documentElement.style.cssText = 'margin:0;height:100%;overflow:hidden';
  document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#fff';

  const params = new URLSearchParams(location.search);
  const names = (params.get('seats') ?? 'Anna,Ben').split(',').filter(Boolean);
  const me = params.get('seat') === 's0' ? 's0' : 's1';
  const timer = Number(params.get('timer') ?? 2000);
  const { state: initial, secrets } = tableWith(
    names,
    CARDS.filter((c) => Number(c.zone.split(':s')[1] ?? 0) < names.length),
    me,
  );
  // Players are seated (each seat has a peer) and the host set the pass timer.
  const state: TableState = {
    ...initial,
    seats: Object.fromEntries(Object.entries(initial.seats).map(([id, s]) => [id, { ...s, peer: `peer-${id}` }])),
    settings: { ...initial.settings, passTimerMs: timer },
  };
  // The lowest seat sequences (DESIGN Sequencing 1).
  const sequencer = new Sequencer(state, 's0');
  const session = new HarnessSession(sequencer, secrets, me);
  const data = new FakeCardData();
  let n = 0;
  const host = document.createElement('div');
  target.appendChild(host);
  const props: HudProps = {
    session,
    createScene: createTableScene,
    faces: new FakeFaces(data),
    cardData: data,
    game: fakeGame(),
    theme: paper,
    settings: new MemorySettings({}, null),
    newId: (p) => `${p}${me}${++n}`,
  };
  mountSvelte(Hud, { target: host, props });

  let remoteCid = 0;
  window.__confirmHarness = {
    remote: (seat, draft) => {
      const r = sequencer.submit({ ...draft, by: seat, cid: `${seat}-r${++remoteCid}` } as Action);
      return JSON.parse(JSON.stringify(r)) as { action: Action; refused: string | null };
    },
    away: (seat, away) => sequencer.setAway(seat, away),
    state: () => JSON.parse(JSON.stringify(sequencer.state)) as TableState,
    log: () => JSON.parse(JSON.stringify(sequencer.actions)) as Action[],
    refused: () => JSON.parse(JSON.stringify(sequencer.refusals)) as { action: Action; reason: string }[],
    fired: () => [...sequencer.fired],
  };
  registerDebug({ state: () => sequencer.state });
}
