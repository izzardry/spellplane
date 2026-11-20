<!--
  Play without keys (PLAN Milestone 7, Owner decisions after the first design round: "Every everyday action is reachable
  by direct manipulation with visible affordances … Keys stay as optional accelerators and leave the primary UI"; PLAN
  M7-P5). The HUD's on-card and on-pile controls in one place: the selection strip beside the selected cards, the pile
  actions beside a pile, and the facts the gesture coach marks follow (ui/hints/coach.ts). The table scene reports
  where they stand (SceneEvents.selectionAnchor, pileHover) on change and when the camera settles, never per frame.
  Every control runs an action the keys already run (ui/commands.ts), so the reducer and hidden information are
  unchanged. Added by M7-P5.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { CardInstance, InstanceId, SeatId, TableState } from '../../core/types';
  import type { CardData } from '../../data/types';
  import type { PileHover, SelectionAnchor } from '../../scene/types';
  import { registerDebug } from '../../util/debug';
  import { isOwnTurn, type Commands } from '../commands';
  import { inZoneKind } from '../geometry';
  import { coachFacts, type CoachController } from '../hints/coach';
  import { counterChips, pileButtons, stripItems, type PileButton, type StripItem } from './affordances';
  import PileActions from './PileActions.svelte';
  import SelectionStrip from './SelectionStrip.svelte';

  let {
    state: st,
    me,
    selection,
    commands,
    anchor,
    pile,
    touch = false,
    spectator = false,
    readOnly = false,
    vw,
    vh,
    coach,
    identity,
    onmore,
    onpile,
  }: {
    state: TableState;
    me: SeatId | null;
    selection: readonly InstanceId[];
    commands: Commands;
    anchor: SelectionAnchor | null;
    pile: PileHover | null;
    touch?: boolean;
    spectator?: boolean;
    /** Look, do not touch (TableScene.setReadOnly): no strip, no pile actions, no coach mark. */
    readOnly?: boolean;
    vw: number;
    vh: number;
    coach: CoachController;
    /** The card data this browser may know for a card (public identity, own hand), else null. */
    identity: (card: CardInstance) => CardData | null;
    /** "More…": the card's full context menu at a screen point. */
    onmore: (card: InstanceId, x: number, y: number) => void;
    /** A pile action button. */
    onpile: (button: PileButton, hover: PileHover) => void;
  } = $props();

  /** The selected cards the strip acts on: those the anchor names that are still on the table. */
  const cards = $derived(anchor && !spectator && !readOnly ? anchor.cards.map((id) => st.cards[id]).filter((c): c is CardInstance => !!c) : []);
  const items = $derived(
    stripItems({
      cards,
      me,
      phase: st.turn.phase,
      myTurn: me !== null && isOwnTurn(st, me),
      applies: (a, c) => commands.applies(a, c),
      battlefield: (c) => inZoneKind(c, 'battlefield'),
    }),
  );
  const chips = $derived(counterChips(cards));

  function run(item: StripItem): void {
    if (!item.action) return;
    commands.runFor(
      cards.map((c) => c.id),
      item.action,
    );
  }

  // The coach marks follow the table, the selection and the pile actions (ui/hints/coach.ts).
  $effect(() => {
    const facts = coachFacts(st, me, {
      identity,
      selected: selection,
      pileActions: pile !== null,
      spectator,
      myTurn: me !== null && isOwnTurn(st, me),
    });
    // A read-only table pauses the marks: none shows and nothing is taught by what changes meanwhile.
    const ro = readOnly;
    untrack(() => {
      coach.pause(ro, facts);
      coach.update(facts);
    });
  });

  onMount(() => {
    void coach.load();
    registerDebug({ coach: { current: () => coach.current(), seen: () => coach.done(), saved: () => coach.saved() } });
  });
</script>

<SelectionStrip
  anchor={cards.length ? anchor : null}
  {items}
  {chips}
  {touch}
  {vw}
  {vh}
  onrun={run}
  oncounter={(kind, delta) =>
    commands.counterOn(
      cards.map((c) => c.id),
      kind,
      delta,
    )}
  onmore={(x, y) => cards[0] && onmore(cards[0].id, x, y)}
/>
{#if !spectator && !readOnly}
  <PileActions hover={pile} buttons={(h) => pileButtons(h, st, me)} {touch} {vw} {vh} onaction={onpile} />
{/if}
