/**
 * What every keymap action does (DESIGN "Input and interaction design", Canonical default keymap; "Card manipulation";
 * "Combat and annotation"; "The effect stack"; "Turn flow and confirmation"; "Camera and navigation").
 * A bare key acts on the hovered card, or on the selection when the hovered card is part of it or nothing is hovered.
 * A gesture over several cards dispatches one action per card with a shared `group` (CLAUDE.md conventions).
 * Every action goes through TableSession or TableScene; nothing here touches the DOM.
 */
import type { ActionDraft } from '../core/actions';
import { GEOMETRY } from '../core/geometry';
import { sha256 } from '../core/hash';
import { parseZoneId } from '../core/ids';
import type { CardInstance, InstanceId, Pose, SeatId, StackItem, StackItemId, TableState, ZoneId } from '../core/types';
import type { ActionId, GameDefinition } from '../games/types';
import type { TableScene } from '../scene/types';
import type { TableSession } from '../session/types';
import { pendingAbout, roundPassed as coreRoundPassed } from '../core/reducer/confirm';
import { promptModel } from './confirm/model';
import { freeSlot, inZoneKind, layoutOf, offsetLocal, seatAngle, seatLayout } from './geometry';
import { tidyPoses } from './tidy';

/** Kind of counter that + and − change by default (DESIGN "Card manipulation": generic +1/+1 by default). */
export const DEFAULT_COUNTER = '+1/+1';
/** Named counter kinds offered in the context menu (DESIGN "Card manipulation": loyalty, −1/−1, charge, custom). */
export const COUNTER_KINDS = ['+1/+1', '-1/-1', 'loyalty', 'charge'] as const;
/** Die size for Ctrl+I (DESIGN "Card manipulation", Other table objects: dice of any size). */
export const DEFAULT_DIE = 6;
/** Window for the second R that resolves before everyone passed (DESIGN "Turn flow and confirmation", All passed). */
export const FORCE_RESOLVE_MS = 3000;

/** HUD surfaces the commands open (DESIGN "Input and interaction design": nothing modal, prompts are inline). */
export interface UiHooks {
  openNote(target: { card: InstanceId } | { item: StackItemId }): void;
  openRevealTo(cards: InstanceId[]): void;
  /** Open the inspect view for a card; null closes it. */
  inspect(card: InstanceId | null): void;
  openDrawN(): void;
  openTokenSearch(near: InstanceId | null): void;
  toggleCheatSheet(): void;
  focusChat(): void;
  /** Voice controls (milestone 3 wires the engine): hold to talk, team talk, mute toggle. */
  voice(action: 'talk' | 'teamTalk' | 'mute', phase: 'start' | 'end'): void;
  notify(text: string): void;
}

/** What the commands act through. */
export interface CommandHost {
  session: TableSession;
  game: GameDefinition;
  scene(): TableScene | null;
  view(): { hovered: InstanceId | null; selection: readonly InstanceId[] };
  ui: UiHooks;
  newId(prefix: string): string;
  now(): number;
}

type Phase = 'start' | 'end';

/**
 * Whether everyone who answers the open round has passed (OK or timeout), or there is none (DESIGN "Turn flow and
 * confirmation", All passed). Empty chairs and the asker do not answer (core/reducer/confirm.ts).
 */
export function roundPassed(state: TableState): boolean {
  return coreRoundPassed(state);
}

/** Whether the confirmation prompt shows for `seat`: it answers the open round and has not passed (holding included) (DESIGN "Turn flow and confirmation", Prompt). */
export function promptShowing(state: TableState, seat: SeatId): boolean {
  const mode = promptModel(state, seat)?.mode;
  return mode === 'respond' || mode === 'holding';
}

/** The stack item a card belongs to (a spell's card on the stack), or null. */
export function stackItemOfCard(state: TableState, card: InstanceId): StackItem | null {
  return state.stack.find((i) => i.card === card) ?? null;
}

/**
 * An empty chair: a seat nobody has taken (no name, no peer) that holds no cards, such as the second seat of a solo
 * goldfish table (DESIGN "Players, seats and formats"). The HUD shows no avatar for it.
 */
export function isEmptyChair(state: TableState, seat: SeatId): boolean {
  const s = state.seats[seat];
  if (!s || s.name !== '' || s.peer !== undefined) return false;
  return Object.values(state.zones).every((z) => z.owner !== seat || z.ids.length === 0);
}

const isPublicZone = (state: TableState, c: CardInstance): boolean => state.zones[c.zone]?.visibility === 'public';

/** Executes keymap actions against the session and scene (DESIGN "Input and interaction design"). */
export class Commands {
  private pendingForce: { item: StackItemId; at: number } | null = null;

  constructor(private readonly host: CommandHost) {}

  private get state(): TableState {
    return this.host.session.getState();
  }
  private get me(): SeatId {
    return this.host.session.seat;
  }

  /** Cards a bare key acts on (DESIGN "Input and interaction design", Hover plus key). */
  targets(): CardInstance[] {
    const st = this.state;
    const { hovered, selection } = this.host.view();
    const sel = selection.map((id) => st.cards[id]).filter((c): c is CardInstance => !!c);
    if (hovered && st.cards[hovered]) return sel.some((c) => c.id === hovered) ? sel : [st.cards[hovered]];
    return sel;
  }

  private hoveredCard(): CardInstance | null {
    const h = this.host.view().hovered;
    return (h && this.state.cards[h]) || null;
  }

  private dispatchAll(drafts: ActionDraft[]): void {
    if (drafts.length === 0) return;
    const group = drafts.length > 1 ? this.host.newId('g') : null;
    for (const d of drafts) this.host.session.dispatch(group ? { ...d, group } : d);
  }

  /** Whether `action` does something for `card` (context menu entries, DESIGN "Input and interaction design"). */
  applies(action: ActionId, card: CardInstance): boolean {
    const st = this.state;
    const pub = isPublicZone(st, card);
    const bf = inZoneKind(card, 'battlefield');
    // A hidden card can only be handled by the owner of its zone (whose browser holds its identity).
    const reachable = pub || st.zones[card.zone]?.owner === this.me;
    if (!reachable && action !== 'inspect') return false;
    switch (action) {
      case 'tap':
      case 'rotate180':
      case 'attack':
      case 'attackNoTap':
      case 'ability':
        return bf;
      case 'flip':
      case 'counterAdd':
      case 'counterRemove':
      case 'note':
      case 'ping':
      case 'zoomTo':
        return pub;
      case 'transform':
        return pub && this.faceCount(card) > 1;
      case 'copy':
        return pub && (bf || inZoneKind(card, 'stack')) && (!!card.identity || !!card.tokenLabel);
      case 'revealTo':
        return card.owner === this.me && (!pub || card.face === 'down') && !!this.host.session.secrets().identities[card.id];
      case 'peek':
        return pub && card.face === 'down' && !card.identity;
      case 'inspect':
        return true;
      case 'toGraveyard':
        return card.zone !== `graveyard:${card.owner}`;
      case 'toExile':
        return card.zone !== `exile:${card.owner}`;
      case 'toHand':
        return card.zone !== `hand:${card.owner}`;
      case 'toLibraryTop':
      case 'toLibraryBottom':
        // Also for a looked-at library card: scry is look, then top or bottom (DESIGN "Card manipulation", Library actions).
        return true;
      case 'cast':
        // From hand, or from graveyard, exile or command (flashback, foretell, commanders); not from play, the stack or the library.
        return !bf && !inZoneKind(card, 'stack') && !inZoneKind(card, 'library');
      default:
        return false;
    }
  }

  private faceCount(card: CardInstance): number {
    const ref = card.identity ?? this.host.session.secrets().identities[card.id]?.card;
    if (!ref) return 1;
    return this.host.session.cardData(ref)?.card_faces?.length ?? 1;
  }

  /** Run a keymap action; `phase` is 'end' only when a hold binding is released. */
  run(action: ActionId, phase: Phase = 'start'): void {
    if (phase === 'end') {
      if (action === 'inspect') this.host.ui.inspect(null);
      else if (action === 'talk' || action === 'teamTalk') this.host.ui.voice(action, 'end');
      return;
    }
    const st = this.state;
    const me = this.me;
    const scene = this.host.scene();
    const forCards = (fn: (c: CardInstance) => ActionDraft | null) =>
      this.dispatchAll(
        this.targets()
          .filter((c) => this.applies(action, c))
          .map(fn)
          .filter((d): d is ActionDraft => d !== null),
      );
    switch (action) {
      // --- Card
      case 'tap': {
        const cards = this.targets().filter((c) => this.applies('tap', c));
        const tapped = !cards.every((c) => c.tapped);
        this.dispatchAll(cards.filter((c) => c.tapped !== tapped).map((c) => ({ type: 'tap', card: c.id, tapped })));
        return;
      }
      case 'flip':
        return forCards((c) => ({ type: 'flip', card: c.id, face: c.face === 'up' ? 'down' : 'up' }));
      case 'transform':
        return forCards((c) => ({ type: 'transform', card: c.id, faceIndex: c.faceIndex === 0 ? 1 : 0 }));
      case 'rotate180':
        return forCards((c) => ({ type: 'rotate', card: c.id, delta: 180 }));
      case 'counterAdd':
        return forCards((c) => ({ type: 'counter', card: c.id, kind: DEFAULT_COUNTER, delta: 1 }));
      case 'counterRemove':
        return forCards((c) => {
          const kind = (c.counters[DEFAULT_COUNTER] ?? 0) > 0 ? DEFAULT_COUNTER : Object.keys(c.counters).sort().find((k) => (c.counters[k] ?? 0) !== 0);
          return kind ? { type: 'counter', card: c.id, kind, delta: -1 } : null;
        });
      case 'note': {
        const c = this.hoveredCard() ?? this.targets()[0];
        if (!c || !this.applies('note', c)) return;
        const item = stackItemOfCard(st, c.id);
        this.host.ui.openNote(item ? { item: item.id } : { card: c.id });
        return;
      }
      case 'copy': {
        const cards = this.targets().filter((c) => this.applies('copy', c));
        const layout = layoutOf(this.host.game, st);
        this.dispatchAll(
          cards.map((c): ActionDraft => {
            const item = stackItemOfCard(st, c.id);
            if (item) return { type: 'stackPush', item: this.host.newId('si'), kind: 'copy', copyOf: item.id, controller: me, round: this.host.newId('r') };
            const angle = seatAngle(layout, st, c.controller);
            // The copy enters untapped, at the controller's resting rotation.
            return { type: 'copy', card: this.host.newId('c'), of: c.id, pose: { ...offsetLocal(c.pose, GEOMETRY.card.w + GEOMETRY.gap, 0, angle), rot: angle } };
          }),
        );
        return;
      }
      case 'revealTo': {
        const cards = this.targets().filter((c) => this.applies('revealTo', c));
        if (cards.length) this.host.ui.openRevealTo(cards.map((c) => c.id));
        return;
      }
      case 'peek': {
        const c = this.hoveredCard();
        if (!c || !this.applies('peek', c)) return;
        const s = this.host.session.secrets();
        if (!s.identities[c.id] && !s.received[c.id]) {
          this.host.ui.notify('You may not look at that card');
          return;
        }
        this.host.session.dispatch({ type: 'lookAt', zone: c.zone, count: 1, card: c.id });
        this.host.ui.inspect(c.id);
        return;
      }
      case 'ping': {
        const c = this.hoveredCard();
        if (!c || !this.applies('ping', c)) return;
        const item = stackItemOfCard(st, c.id);
        this.host.session.dispatch({ type: 'ping', target: item ? { kind: 'stackItem', id: item.id } : { kind: 'card', id: c.id } });
        return;
      }
      case 'zoomTo': {
        const c = this.hoveredCard();
        if (!c) return;
        scene?.camera.zoomTo(c.pile?.id ?? c.id);
        return;
      }
      case 'inspect': {
        const c = this.hoveredCard();
        if (c) this.host.ui.inspect(c.id);
        return;
      }
      // --- Zones
      case 'toGraveyard':
      case 'toExile': {
        const kind = action === 'toGraveyard' ? 'graveyard' : 'exile';
        return forCards((c) => ({ type: 'move', card: c.id, to: `${kind}:${c.owner}` }));
      }
      case 'toHand':
        return forCards((c) => ({ type: 'toZone', card: c.id, to: `hand:${c.owner}`, position: 'any' }));
      case 'toLibraryTop':
      case 'toLibraryBottom':
        return forCards((c) => ({ type: 'toZone', card: c.id, to: `library:${c.owner}`, position: action === 'toLibraryTop' ? 'top' : 'bottom' }));
      case 'cast':
        return forCards((c) => ({ type: 'stackPush', item: this.host.newId('si'), kind: 'spell', card: c.id, controller: me, round: this.host.newId('r') }));
      // --- Library
      case 'draw':
        void this.host.session.draw(1);
        return;
      case 'drawN':
        this.host.ui.openDrawN();
        return;
      case 'shuffle':
        void this.host.session.shuffle();
        return;
      case 'mulligan':
        void this.host.session.mulligan();
        return;
      // --- Combat
      case 'attack':
      case 'attackNoTap': {
        const layout = layoutOf(this.host.game, st);
        return forCards((c) => {
          if (c.combat === 'attack') return null;
          const base = c.home ?? c.pose;
          const pose = offsetLocal(base, 0, GEOMETRY.attackDisplacement, seatAngle(layout, st, c.controller));
          return { type: 'moveTemp', card: c.id, pose, combat: 'attack', tap: action === 'attack' };
        });
      }
      case 'settle': {
        const sel = this.host.view().selection.filter((id) => st.cards[id]);
        this.host.session.dispatch(sel.length ? { type: 'settle', cards: [...sel] } : { type: 'settle' });
        return;
      }
      // --- Stack
      case 'ability':
        return forCards((c) => ({ type: 'stackPush', item: this.host.newId('si'), kind: 'ability', source: c.id, controller: me, round: this.host.newId('r') }));
      case 'resolve':
        this.resolveTop();
        return;
      case 'counterTop': {
        const top = st.stack[st.stack.length - 1];
        if (top) this.host.session.dispatch({ type: 'stackCounter', item: top.id });
        else this.host.ui.notify('The stack is empty');
        return;
      }
      // --- Turn
      case 'nextPhase': {
        const phases = this.host.game.phases;
        const i = phases.findIndex((p) => p.id === st.turn.phase);
        const next = phases[i + 1];
        if (next) this.host.session.dispatch({ type: 'phaseSet', phase: next.id });
        else this.host.ui.notify('Last step of the turn. Ctrl+Enter passes the turn');
        return;
      }
      case 'nextTurn': {
        const to = nextActive(st);
        // The new active player's client offers untap-and-draw when it sees the turn change (Hud.svelte).
        this.host.session.dispatch({ type: 'turnPass', to });
        return;
      }
      case 'untapAll':
        this.untapAll();
        return;
      case 'autoPass':
        this.host.session.dispatch({ type: 'autoPass', on: !st.seats[me]?.autoPass });
        return;
      // --- Confirm
      case 'ask':
        this.host.session.dispatch({ type: 'ask', round: this.host.newId('r') });
        return;
      case 'confirmOk': {
        const r = st.confirm;
        if (!r || !promptShowing(st, me)) return;
        const response = r.holder === me ? 'release' : 'ok';
        this.host.session.dispatch({ type: 'respond', round: r.id, seat: me, response });
        return;
      }
      case 'confirmHold': {
        const r = st.confirm;
        if (!r || !promptShowing(st, me) || r.holder === me) return;
        this.host.session.dispatch({ type: 'respond', round: r.id, seat: me, response: 'hold' });
        return;
      }
      // --- Table
      case 'tidy': {
        const poses = tidyPoses(st, me, layoutOf(this.host.game, st));
        if (Object.keys(poses).length) this.host.session.dispatch({ type: 'tidy', seat: me, poses });
        return;
      }
      case 'token':
        this.host.ui.openTokenSearch(this.hoveredCard()?.id ?? null);
        return;
      case 'rollDie':
        void this.publicRandom('die', DEFAULT_DIE);
        return;
      case 'flipCoin':
        void this.publicRandom('coin', 2);
        return;
      case 'undo':
        if (!this.host.session.undo()) this.host.ui.notify('Nothing to undo');
        return;
      // --- Talk
      case 'talk':
      case 'teamTalk':
        this.host.ui.voice(action, 'start');
        return;
      case 'mute':
        this.host.ui.voice('mute', 'start');
        return;
      case 'focusChat':
        this.host.ui.focusChat();
        return;
      // --- View
      case 'perspective':
        scene?.camera.setRig(scene.camera.rig() === 'birdseye' ? 'ego' : 'birdseye');
        return;
      case 'fitTable':
        scene?.camera.fit(true);
        return;
      case 'seat1':
      case 'ownSide':
        scene?.camera.goToSeat(me);
        return;
      case 'seat2':
      case 'seat3':
      case 'seat4': {
        const seat = clockwiseSeat(st, me, Number(action.slice(4)) - 1);
        if (seat) scene?.camera.goToSeat(seat);
        return;
      }
      case 'help':
        this.host.ui.toggleCheatSheet();
        return;
    }
  }

  /**
   * Resolve the top item (DESIGN "The effect stack", Resolving): to `to`, or to the game's default destination for
   * the card (permanents to the controller's battlefield, instants and sorceries to the owner's graveyard; markers
   * vanish). A card that resolves onto a battlefield lands in a free slot of that battlefield's territory, never in
   * the stack lane at the table centre (Resolving 2; "Table model"). Before everyone passed it needs a second press
   * within FORCE_RESOLVE_MS, which resolves with `force` ("Turn flow and confirmation", All passed).
   */
  resolveTop(to?: ZoneId): void {
    const st = this.state;
    const top = st.stack[st.stack.length - 1];
    if (!top) {
      this.host.ui.notify('The stack is empty');
      return;
    }
    const pending = pendingAbout(st, top.id);
    if (!pending) {
      this.pendingForce = null;
      this.host.session.dispatch({ type: 'stackResolve', item: top.id, ...this.resolveDestination(top, to) });
      return;
    }
    const now = this.host.now();
    if (this.pendingForce && this.pendingForce.item === top.id && now - this.pendingForce.at <= FORCE_RESOLVE_MS) {
      this.pendingForce = null;
      this.host.session.dispatch({ type: 'stackResolve', item: top.id, ...this.resolveDestination(top, to), force: true });
      return;
    }
    this.pendingForce = { item: top.id, at: now };
    this.host.ui.notify('Not everyone has passed. Resolve again to resolve anyway');
  }

  /** Where a resolving item goes: `to` or the game's default for its card, with a free-slot pose on a battlefield. */
  private resolveDestination(item: StackItem, to: ZoneId | undefined): { to?: ZoneId; pose?: Pose } {
    const st = this.state;
    const card = item.card ? st.cards[item.card] : undefined;
    if (!card) return to ? { to } : {};
    let dest = to ?? null;
    if (!dest) {
      const ref = card.identity ?? this.host.session.secrets().identities[card.id]?.card;
      const data = ref ? this.host.session.cardData(ref) : null;
      try {
        dest = this.host.game.defaultDestination(item, data ?? undefined, card);
      } catch {
        dest = null;
      }
    }
    if (!dest) return {};
    const { kind, seat } = parseZoneId(dest);
    const free = this.host.game.zones.find((z) => z.id === kind)?.presentation === 'free';
    if (!free || !seat || !st.zones[dest]) return { to: dest };
    return { to: dest, pose: freeSlot(st, seat, layoutOf(this.host.game, st), card.id) };
  }

  /** Mill N: the top `n` cards of the own library to the own graveyard, one move each with a shared group (DESIGN "Card manipulation", Library actions). */
  mill(n: number): void {
    const me = this.me;
    const k = Math.max(0, Math.floor(n));
    const ids = this.host.session.secrets().libraryOrder.slice(0, k);
    if (ids.length === 0) {
      this.host.ui.notify('Your library is empty');
      return;
    }
    this.dispatchAll(ids.map((id): ActionDraft => ({ type: 'move', card: id, to: `graveyard:${me}` })));
  }

  /**
   * Reveal top: show the top card of the own library to every other seat (DESIGN "Card manipulation", Library
   * actions). It goes through the targeted-reveal path, so the card stays hidden in shared state.
   */
  revealTop(): void {
    const st = this.state;
    const me = this.me;
    const top = this.host.session.secrets().libraryOrder[0];
    if (!top) {
      this.host.ui.notify('Your library is empty');
      return;
    }
    const seats = Object.values(st.seats)
      .filter((s) => s.id !== me)
      .sort((a, b) => a.index - b.index)
      .map((s) => s.id);
    if (seats.length === 0) {
      this.host.ui.notify('No other players to reveal to');
      return;
    }
    this.host.session.dispatch({ type: 'revealTo', instanceId: top, seats });
  }

  /** Ctrl+U: untap everything the local player controls (DESIGN "Card manipulation"). */
  untapAll(): void {
    const st = this.state;
    this.dispatchAll(
      Object.values(st.cards)
        .filter((c) => c.controller === this.me && c.tapped && inZoneKind(c, 'battlefield'))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((c): ActionDraft => ({ type: 'tap', card: c.id, tapped: false })),
    );
  }

  /** The new active player's single key: untap everything they control and draw a card (DESIGN "Turn flow and confirmation"). */
  untapAndDraw(): void {
    this.untapAll();
    void this.host.session.draw(1);
  }

  /** A counter of a named kind on a card (context menu, DESIGN "Card manipulation": named counter types). */
  counter(card: InstanceId, kind: string, delta: number): void {
    if (this.state.cards[card]) this.host.session.dispatch({ type: 'counter', card, kind, delta });
  }

  /** A trigger marker for a permanent (DESIGN "The effect stack", Trigger). */
  trigger(card: InstanceId): void {
    this.host.session.dispatch({ type: 'stackPush', item: this.host.newId('si'), kind: 'trigger', source: card, controller: this.me, round: this.host.newId('r') });
  }

  /** Create a token on the local battlefield beside `near`, or at `at`, or in the territory centre (DESIGN "Card manipulation", Create token). */
  createToken(sid: string, near: InstanceId | null, at: { x: number; y: number } | null): void {
    const st = this.state;
    const me = this.me;
    const layout = layoutOf(this.host.game, st);
    const angle = seatAngle(layout, st, me);
    const nearCard = near ? st.cards[near] : undefined;
    let pose;
    if (nearCard && inZoneKind(nearCard, 'battlefield')) pose = { ...offsetLocal(nearCard.pose, GEOMETRY.card.w + GEOMETRY.gap, 0, angle), rot: angle };
    else if (at) pose = { x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000, rot: angle };
    else {
      const t = seatLayout(layout, st, me)?.territory;
      pose = t ? { x: t.x, y: t.y, rot: angle } : offsetLocal({ x: 0, y: 0, rot: angle }, 0, -330, angle);
    }
    this.host.session.dispatch({ type: 'createToken', card: this.host.newId('c'), zone: `battlefield:${me}`, pose, ref: { sid }, controller: me });
  }

  /** Commit-reveal public randomness for dice and coins (DESIGN "Specification: network protocol and secrecy", Public randomness). */
  async publicRandom(purpose: 'die' | 'coin', n: number): Promise<void> {
    const rid = this.host.newId('rng');
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const h = await sha256(nonce);
    this.host.session.dispatch({ type: 'rngCommit', rid, purpose, n, h });
    this.host.session.dispatch({ type: 'rngReveal', rid, nonce });
  }
}

/** The seat (or Two-Headed Giant team) whose turn is next, clockwise (DESIGN "Turn flow and confirmation"). */
export function nextActive(st: TableState): SeatId {
  const teams = Object.values(st.teams);
  if (teams.length) {
    const order = teams.map((t) => ({ id: t.id, index: Math.min(...t.seats.map((s) => st.seats[s]?.index ?? 99)) })).sort((a, b) => a.index - b.index);
    const i = order.findIndex((t) => t.id === st.turn.active);
    return order[(i + 1) % order.length]!.id;
  }
  const seats = Object.values(st.seats).sort((a, b) => a.index - b.index);
  if (seats.length === 0) return st.turn.active;
  const i = seats.findIndex((s) => s.id === st.turn.active);
  return seats[(i + 1) % seats.length]!.id;
}

/** The seat `steps` places clockwise from `from`, or null when the table has fewer seats (DESIGN "Camera and navigation": 2, 3, 4 clockwise from you). */
export function clockwiseSeat(st: TableState, from: SeatId, steps: number): SeatId | null {
  const seats = Object.values(st.seats).sort((a, b) => a.index - b.index);
  if (steps >= seats.length) return null;
  const i = seats.findIndex((s) => s.id === from);
  return seats[(Math.max(i, 0) + steps) % seats.length]!.id;
}
