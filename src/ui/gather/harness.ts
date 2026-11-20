/**
 * The rejoin test page (`?harness=gather`, dev and test builds only; contracts.md Part C): Gathering, SeatMenu,
 * SeatBadge, the team prompt, the claim page and every refusal screen over a fake `SessionMuster` and a fixture table,
 * so M8-P5's screens are proven without another package's code. Playwright drives it through `window.__gather`.
 * Implementer: M8-P5.
 *
 * URL: `?harness=gather&scene=gathering|menus|claim|team` (default `gathering`).
 */
import { mount as mountSvelte, unmount } from 'svelte';
import { createTable } from '../../core/reducer';
import type { SeatId, TableState } from '../../core/types';
import { mtg } from '../../games/index';
import type { MusterStatus, SessionMuster, TeamControls } from '../../session/types';
import { designCssVars, lookTokens } from '../design/tokens';
import GatherHarness from './GatherHarness.svelte';

export interface GatherHarnessApi {
  /** Replace the muster verdict the fake session reports. */
  setStatus(patch: Partial<MusterStatus>): void;
  status(): MusterStatus;
  /** What the page asked the fake session to do, in order. */
  calls(): string[];
  /** Whether the table under the card is read-only (the frame's readOnly). */
  readOnly(): boolean;
  /** Make the next `invite` reject with this reason (null: succeed). */
  failInvite(reason: string | null): void;
  /** Switch the scene. */
  scene(name: 'gathering' | 'menus' | 'claim' | 'team'): void;
}

declare global {
  interface Window {
    __gather?: GatherHarnessApi;
  }
}

/** A four-seat table in its first game: Ann (me, s0), Ben (s1, away), Cy (s2), Dana (s3). */
export function fixtureTable(format: '1v1' | 'ffa4' | '2hg' = 'ffa4', matched = false): TableState {
  const names = ['Ann', 'Ben', 'Cy', 'Dana'];
  const n = format === '1v1' ? 2 : 4;
  const teams = format === '2hg' ? ['t0', 't0', 't1', 't1'] : [];
  const s = createTable({ game: mtg, format, seats: names.slice(0, n).map((name, i) => ({ name, colour: i, peer: `p${i}`, ...(teams[i] ? { team: teams[i] } : {}) })) });
  const st: TableState = { ...s, stage: 'match', games: 1, turn: { ...s.turn, number: 6 }, settings: { ...s.settings, ...(matched ? { matched: true } : {}) }, seats: { ...s.seats } };
  st.seats.s1 = { ...st.seats.s1!, away: true };
  return st;
}

function standby(): MusterStatus {
  return {
    live: false,
    rule: null,
    waitingFor: ['s1', 's2'],
    knownHead: null,
    playOnHere: false,
    seats: [
      { seat: 's0', name: 'Ann', me: true, state: 'here' },
      { seat: 's1', name: 'Ben', me: false, state: 'away' },
      { seat: 's2', name: 'Cy', me: false, state: 'connecting' },
      { seat: 's3', name: 'Dana', me: false, state: 'leftBefore' },
    ],
  };
}

export function mount(target: HTMLElement): () => void {
  const params = new URLSearchParams(location.search);
  // The design variables of the default look on the page root (the app frame does this through the look wiring).
  for (const [k, v] of Object.entries(designCssVars(lookTokens('kitchen')))) document.documentElement.style.setProperty(k, v);
  let status = standby();
  const listeners = new Set<(m: MusterStatus) => void>();
  const calls: string[] = [];
  let failNext: string | null = null;
  let readOnly = false;
  const muster: SessionMuster = {
    muster: () => status,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    playOn: (seats: SeatId[]) => {
      calls.push(`playOn ${seats.join(',')}`);
      status = { ...status, live: true, rule: 4, waitingFor: [], playOnHere: false };
      for (const l of [...listeners]) l(status);
      return Promise.resolve();
    },
    invite: (seat: SeatId) => {
      calls.push(`invite ${seat}`);
      if (failNext !== null) {
        const why = failNext;
        failNext = null;
        return Promise.reject(new Error(why));
      }
      return Promise.resolve(`${location.origin}${location.pathname}#/t/amber-fox-93/AAAAAAAAAAAAAAAAAAAAAA/rejoin/${seat}/Jf0c1x9mQ2uVb7Yt3LrKzg`);
    },
    takeInviteBack: (seat: SeatId) => {
      calls.push(`takeInviteBack ${seat}`);
      return Promise.resolve();
    },
    saveState: () => (params.get('saving') === 'no' ? 'notSaving' : 'saved'),
  };
  const teamListeners = new Set<() => void>();
  let withheld = [{ seat: 's3', name: 'Dana', by: 'Cy' }];
  const team: TeamControls = {
    teammates: () => ['s3'],
    hand: () => [],
    subscribe: (l) => {
      teamListeners.add(l);
      return () => teamListeners.delete(l);
    },
    chatLog: () => [],
    withheld: () => withheld,
    showHand: (seat) => {
      calls.push(`showHand ${seat}`);
      withheld = withheld.filter((w) => w.seat !== seat);
      for (const l of [...teamListeners]) l();
    },
    holdHand: (seat) => {
      calls.push(`holdHand ${seat}`);
      withheld = withheld.filter((w) => w.seat !== seat);
      for (const l of [...teamListeners]) l();
    },
  };
  let app: ReturnType<typeof mountSvelte> | null = null;
  const show = (scene: string): void => {
    if (app) void unmount(app);
    app = mountSvelte(GatherHarness, {
      target,
      props: {
        scene,
        muster,
        team,
        table: fixtureTable('ffa4'),
        teamTable: fixtureTable('2hg'),
        matchedTable: fixtureTable('1v1', true),
        onreadonly: (ro: boolean) => (readOnly = ro),
        log: (what: string) => calls.push(what),
      },
    });
  };
  show(params.get('scene') ?? 'gathering');
  window.__gather = {
    setStatus: (patch) => {
      status = { ...status, ...patch };
      for (const l of [...listeners]) l(status);
    },
    status: () => status,
    calls: () => [...calls],
    readOnly: () => readOnly,
    failInvite: (reason) => (failNext = reason),
    scene: (name) => show(name),
  };
  return () => {
    if (app) void unmount(app);
    delete window.__gather;
  };
}
