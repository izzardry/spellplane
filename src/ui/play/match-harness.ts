/**
 * Matchmaking UI test page (`?harness=match`, dev and test builds; contracts.md Part C): the queue chip and the
 * match-found card over a fake matchmaker whose status a test sets. Playwright drives it through
 * `window.__matchHarness`. M8-P7.
 */
import { mount as mountSvelte, unmount } from 'svelte';
import type { QueueId } from '../../core/types';
import type { LobbyView } from '../../net/lobby/types';
import type { Matchmaker, MatchmakerStatus } from '../../session/types';
import MatchHarness from './MatchHarness.svelte';

export interface MatchHarnessApi {
  /** Set the fake status: `seeking` (with `waitedMs`, `alone`), `check` (with `secondsLeft`, `accepted`, `mine`), or any other phase. */
  set(phase: MatchmakerStatus['phase'], o?: { waitedMs?: number; alone?: boolean; secondsLeft?: number; accepted?: string[]; mine?: boolean; queue?: QueueId; looking?: number }): void;
  /** Move the fake clock. */
  advance(ms: number): void;
  answers(): boolean[];
  cancels(): number;
  homes(): number;
  chimes(): number;
  title(): string;
}

declare global {
  interface Window {
    __matchHarness?: MatchHarnessApi;
  }
}

const lobby = (looking: number, queue: QueueId): LobbyView => ({
  shard: 0,
  nat: 'unknown',
  seekers: Array.from({ length: looking }, (_, i) => ({ tid: `t${i}`, peerId: `p${i}`, name: `Seeker ${i + 1}`, queues: [queue], rating: 1500, band: 3, waitedMs: 1000, inRange: true, avoided: false, met: null })),
  byQueue: looking > 0 ? { [queue]: looking } : {},
  unreachable: 0,
  otherVersion: 0,
  full: false,
});

export function mount(target: HTMLElement): void {
  let now = 1_000_000;
  let status: MatchmakerStatus = { phase: 'off' };
  const listeners = new Set<(s: MatchmakerStatus) => void>();
  const answers: boolean[] = [];
  let cancels = 0;
  let homes = 0;
  let chimes = 0;
  const emit = (): void => {
    for (const l of listeners) l(status);
  };
  const fake: Matchmaker & { now(): number; notice(): string | null } = {
    status: () => status,
    subscribe(l) {
      listeners.add(l);
      l(status);
      return () => void listeners.delete(l);
    },
    watch: () => undefined,
    seek: () => undefined,
    widen: () => undefined,
    cancel() {
      cancels++;
      status = { phase: 'watching', lobby: lobby(0, '1v1.constructed.casual') };
      emit();
    },
    answer(a) {
      answers.push(a);
      if (status.phase === 'check') {
        if (a) {
          status = { ...status, mine: true, accepted: [...status.accepted, status.match.players.find((p) => p.me)!.name] };
        } else status = { phase: 'watching', lobby: lobby(0, status.match.queue) };
        emit();
      }
    },
    avoid: () => Promise.resolve(),
    dispose: () => undefined,
    now: () => now,
    notice: () => null,
  };
  const api: MatchHarnessApi = {
    set(phase, o = {}) {
      const queue = o.queue ?? '1v1.constructed.ranked';
      const looking = o.looking ?? 0;
      if (phase === 'seeking') {
        status = { phase, lobby: lobby(looking, queue), since: now - (o.waitedMs ?? 0), window: { rating: 100, band: 0 }, alone: o.alone ?? false, deckId: 'deck-1', queues: [queue] };
      } else if (phase === 'check') {
        status = {
          phase,
          lobby: lobby(looking, queue),
          match: {
            matchId: `m${now}`,
            queue,
            players: [
              { name: 'Ann', rating: 1512, band: 3, me: true },
              { name: 'Ben', rating: 1540, band: 4, me: false },
            ],
          },
          deadline: now + (o.secondsLeft ?? 20) * 1000,
          accepted: o.accepted ?? [],
          mine: o.mine ?? false,
        };
      } else if (phase === 'watching') status = { phase, lobby: lobby(looking, queue) };
      else if (phase === 'failed') status = { phase, problem: 'relays', text: 'Cannot reach the public relays that introduce players to each other. Check your internet connection.' };
      else if (phase === 'connecting' || phase === 'off') status = { phase };
      emit();
    },
    advance(ms) {
      now += ms;
      emit();
    },
    answers: () => [...answers],
    cancels: () => cancels,
    homes: () => homes,
    chimes: () => chimes,
    title: () => document.title,
  };
  window.__matchHarness = api;
  document.title = 'Spellplane';
  const app = mountSvelte(MatchHarness, { target, props: { matchmaker: fake, onhome: () => homes++, chime: () => chimes++ } });
  void app;
  void unmount;
}
