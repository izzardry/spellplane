<!--
  The scenes of the rejoin test page (src/ui/gather/harness.ts): Gathering over a stand-in table, the seat menu for an
  own, a present, an away and a team seat (and a matched table), the claim page and its refusal screens, and the team
  prompt. Dev and test builds only. Implementer: M8-P5.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { TableState } from '../../core/types';
  import type { SessionMuster, TeamControls } from '../../session/types';
  import SeatBadge from '../seat/SeatBadge.svelte';
  import SeatMenu from '../seat/SeatMenu.svelte';
  import TeamPrompt from '../seat/TeamPrompt.svelte';
  import ClaimPage from './ClaimPage.svelte';
  import Gathering from './Gathering.svelte';
  import { refusalScreens } from './model';

  let {
    scene,
    muster,
    team,
    table,
    gatherTable,
    switchMuster,
    switchTable,
    bindSwitch,
    teamTable,
    matchedTable,
    onreadonly,
    log,
  }: {
    scene: string;
    muster: SessionMuster;
    team: TeamControls;
    table: TableState;
    /** The table under the Gathering scene (its away marks agree with the rows). */
    gatherTable: TableState;
    /** Scene `teamswitch`: a live muster whose team view follows the table's format. */
    switchMuster: SessionMuster;
    switchTable: TableState;
    bindSwitch: (set: (t: TableState) => void) => void;
    teamTable: TableState;
    matchedTable: TableState;
    onreadonly: (ro: boolean) => void;
    log: (what: string) => void;
  } = $props();

  let claimPhase = $state<'looking' | 'ready' | 'sitting' | 'refused'>('ready');
  let switched = $state.raw(untrack(() => switchTable));
  untrack(() => bindSwitch((t) => (switched = t)));
  const screens = refusalScreens('Ben', 'Ann');
  const now = (): number => Date.now();
  // Ben was seen away three minutes ago.
  const awaySince = Date.now() - 3 * 60_000;
</script>

<main class="ds-root page" data-testid="gather-harness" data-scene={scene}>
  {#if scene === 'gathering'}
    <div class="stage" data-testid="gather-stage">
      <Gathering {muster} table={gatherTable} code="amber-fox-93" onhome={() => log('home')} onbringback={(seat) => log(`bring ${seat}`)} {onreadonly}>
        <div class="fake-table" data-testid="fake-table">The saved table</div>
      </Gathering>
    </div>
  {:else if scene === 'menus'}
    <div class="menus">
      <section class="menu" data-testid="menu-own"><SeatMenu table={table} seat="s0" me="s0" {muster} {now} savedAt={Date.now() - 4000} onleave={() => log('leave')} /></section>
      <section class="menu" data-testid="menu-here"><SeatMenu table={table} seat="s2" me="s0" {muster} {now} /></section>
      <section class="menu" data-testid="menu-away"><SeatMenu table={table} seat="s1" me="s0" {muster} {now} {awaySince} /></section>
      <section class="menu" data-testid="menu-team"><SeatMenu table={{ ...teamTable, seats: { ...teamTable.seats, s2: { ...teamTable.seats.s2!, away: true } } }} seat="s2" me="s0" {muster} {now} {awaySince} /></section>
      <section class="menu" data-testid="menu-teammate"><SeatMenu table={{ ...teamTable, seats: { ...teamTable.seats, s1: { ...teamTable.seats.s1!, away: true } } }} seat="s1" me="s0" {muster} {now} {awaySince} /></section>
      <section class="menu" data-testid="menu-matched"><SeatMenu table={matchedTable} seat="s1" me="s0" {muster} {now} {awaySince} /></section>
      <section class="menu" data-testid="badges">
        <SeatBadge table={table} seat="s1" me="s0" onopen={() => log('badge s1')} />
        <SeatBadge table={table} seat="s0" me="s0" saveState={muster.saveState()} />
      </section>
    </div>
  {:else if scene === 'claim'}
    <div class="claims">
      <div data-testid="claim-live">
        <ClaimPage phase={claimPhase} seatName="Ben" onsit={(name) => { log(`sit ${name}`); claimPhase = 'sitting'; }} onnotnow={() => log('notnow')} onwatch={() => log('watch')} />
      </div>
      <div data-testid="claim-looking"><ClaimPage phase="looking" seatName="Ben" onsit={() => {}} onnotnow={() => log('notnow')} /></div>
      {#each screens as r (r.kind)}
        <div data-testid="claim-refused-{r.kind}">
          <ClaimPage phase="refused" seatName="Ben" refusal={r} onsit={() => {}} onnotnow={() => log(`home ${r.kind}`)} onwatch={() => log(`watch ${r.kind}`)} onopenmine={() => log('open mine')} />
        </div>
      {/each}
    </div>
  {:else if scene === 'team'}
    <TeamPrompt {team} />
  {:else if scene === 'teamswitch'}
    <div class="stage" data-testid="gather-stage">
      <Gathering muster={switchMuster} table={switched} onhome={() => log('home')} {onreadonly}>
        <div class="fake-table" data-testid="fake-table" data-format={switched.format}>The table</div>
      </Gathering>
    </div>
  {/if}
</main>

<style>
  .page {
    min-height: 100vh;
    box-sizing: border-box;
    padding: 16px;
    background: var(--ds-panel-raised, var(--ds-panel));
    color: var(--ds-ink);
  }
  .stage {
    position: relative;
    height: calc(100vh - 32px);
    min-height: 480px;
    border-radius: var(--ds-radius-panel);
    overflow: hidden;
  }
  .fake-table {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--ds-chip);
    color: var(--ds-muted);
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-title);
    font-weight: var(--ds-heading-weight);
  }
  .menus {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
  }
  .menu {
    background: var(--ds-panel);
    border-radius: var(--ds-radius-panel);
    box-shadow: var(--ds-elevation-pop);
    padding: 8px 0;
  }
  .claims {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
