/**
 * The identity a networked session joins with, kept in step with the lobby (DESIGN "Players, seats and formats",
 * Identity: nickname plus key pair). The lobby renames through the IdentityStore and then calls `takeSeat`, which must
 * use the new nickname (decision M1-P5), while `takeSeat` itself is synchronous: so the app hands the lobby a wrapped
 * store whose `setNickname` also updates the nickname the session reads at every `takeSeat`.
 */
import type { IdentityStore } from '../store/types';
import type { SessionIdentity } from './types';

export interface LiveIdentity {
  /** The store to hand the lobby and the start page (renames reach the session's identity too). */
  readonly store: IdentityStore;
  /** The session identity: key pair, peer id and seat colour from the store, nickname always the current one. */
  identity(): Promise<SessionIdentity>;
}

/** Wrap `store` so that its nickname changes reach the session identity it hands out. */
export function liveIdentity(store: IdentityStore): LiveIdentity {
  let nickname: string | null = null;
  let colour: number | null = null;
  const wrapped: IdentityStore = {
    get: async () => {
      const r = await store.get();
      return { ...r, nickname: nickname ?? r.nickname, seatColour: colour ?? r.seatColour };
    },
    async setNickname(name) {
      nickname = name;
      await store.setNickname(name);
    },
    async setSeatColour(c) {
      colour = c;
      await store.setSeatColour(c);
    },
  };
  return {
    store: wrapped,
    async identity() {
      const r = await wrapped.get();
      nickname ??= r.nickname;
      return {
        keyPair: r.keyPair,
        peerId: r.peerId,
        get nickname(): string {
          return nickname ?? r.nickname;
        },
        get seatColour(): number {
          return colour ?? r.seatColour;
        },
      };
    },
  };
}
