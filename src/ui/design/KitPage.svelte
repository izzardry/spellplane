<!--
  The kit page (?harness=kit): board 0 of docs/design/m8/mock.html from the kit's own components, in one look.
  Sections: controls, paper and depth, type, feedback, identity, deck parts, play parts, history and table parts.
  Card faces are neutral placeholders drawn here (no card data, no card image). Added by M8-P1.
-->
<script lang="ts">
  import Badge from './Badge.svelte';
  import BoosterFan from './BoosterFan.svelte';
  import BoosterPack from './BoosterPack.svelte';
  import Button from './Button.svelte';
  import CardFan from './CardFan.svelte';
  import CardImage from './CardImage.svelte';
  import Chip from './Chip.svelte';
  import CoachMark from './CoachMark.svelte';
  import ColourBar from './ColourBar.svelte';
  import Countdown from './Countdown.svelte';
  import CurveChart from './CurveChart.svelte';
  import Dialog from './Dialog.svelte';
  import Field from './Field.svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import MenuPopover from './MenuPopover.svelte';
  import ModeCard from './ModeCard.svelte';
  import Panel from './Panel.svelte';
  import PileStack from './PileStack.svelte';
  import Pip from './Pip.svelte';
  import PresenceDot from './PresenceDot.svelte';
  import QrPlate from './QrPlate.svelte';
  import SealBand from './SealBand.svelte';
  import SeatGlyph from './SeatGlyph.svelte';
  import Segmented from './Segmented.svelte';
  import Sheet from './Sheet.svelte';
  import Sparkline from './Sparkline.svelte';
  import StatusLine from './StatusLine.svelte';
  import Stepper from './Stepper.svelte';
  import StrengthPips from './StrengthPips.svelte';
  import TableThumb from './TableThumb.svelte';
  import ToastHost from './ToastHost.svelte';
  import Toast from './Toast.svelte';
  import type { LookId } from '../../themes/types';
  import { LOOK_IDS, LOOK_LABELS } from '../../themes/index';
  import { designCssVars, lookTokens } from './tokens';

  let { look, log, accept = () => true }: { look: LookId; log: (e: string) => void; accept?: () => boolean } = $props();

  /** A neutral placeholder face, 63:88 (no card data, no art). */
  function face(name: string, tone: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="630" height="880" viewBox="0 0 630 880"><rect width="630" height="880" rx="30" fill="#171717"/><rect x="28" y="28" width="574" height="824" rx="14" fill="#f5f5f3"/><rect x="52" y="120" width="526" height="360" fill="${tone}"/><text x="56" y="92" font-family="sans-serif" font-size="40" fill="#1a1a1a">${name}</text><rect x="56" y="530" width="500" height="14" fill="#d5d5d2"/><rect x="56" y="570" width="440" height="14" fill="#d5d5d2"/><rect x="56" y="610" width="300" height="14" fill="#d5d5d2"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  const FACES = [
    { src: face('Llanowar Elves', '#cfd8cc'), alt: 'Llanowar Elves' },
    { src: face('Grizzly Bears', '#d8d0c4'), alt: 'Grizzly Bears' },
    { src: face('Giant Growth', '#dcdcd6'), alt: 'Giant Growth' },
    { src: face('Forest', '#c9d3c6'), alt: 'Forest' },
    { src: null, alt: 'A card without data' },
  ];

  let seg = $state('ffa4');
  let filter = $state('all');
  let field = $state('');
  let mode = $state('quick');
  let step = $state(0);
  const STEPS = ['Quick match', 'Private table', 'Solo', 'Draft night'];
  let dialogOpen = $state(false);
  let menuOpen = $state(false);
  let menuAnchor = $state<HTMLElement | null>(null);
  let coach = $state(false);
  let coachAnchor = $state<HTMLElement | null>(null);
  let chipOn = $state(true);
  let seconds = $state(17);

  const QR: boolean[][] = Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => {
    const finder = (cx: number, cy: number) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7 && (x === cx || x === cx + 6 || y === cy || y === cy + 6 || (x >= cx + 2 && x <= cx + 4 && y >= cy + 2 && y <= cy + 4));
    if (finder(0, 0) || finder(14, 0) || finder(0, 14)) return true;
    return ((x * 7 + y * 13 + x * y) % 5) < 2 && !(x < 8 && y < 8) && !(x > 12 && y < 8) && !(x < 8 && y > 12);
  }));
  /** The other three looks, each drawn with its own variables (visual.md 2.2: looks change materials, never structure). */
  const SAMPLES = $derived(LOOK_IDS.filter((id) => id !== look));
  function sampleStyle(id: LookId): string {
    return Object.entries(designCssVars(lookTokens(id)))
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
  }
  // A GameThumb in table space (y away from seat 0, as summary.ts's thumbOf writes it): seat 0's cards low, seat 1's high.
  const THUMB = { w: 1280, h: 720, cards: [[400, 200, 0, 0], [480, 200, 1, 0], [560, 200, 0, 0], [700, 520, 0, 1], [780, 520, 1, 1]] as [number, number, 0 | 1, number][] };
</script>

<main class="kit" data-testid="kit-page" data-look={look}>
  <header class="kit-head">
    <span class="ds-t-word" style:font-size="18px">Spellplane</span>
    <span class="ds-t-eyebrow">Kit · {LOOK_LABELS[look]}</span>
  </header>

  <section class="kit-grid">
    <!-- 1. Controls: the four heights, the variants, one row one height, segmented, field, chips, pips -->
    <Sheet label="Controls" data-testid="kit-controls" class="span-4">
      {#snippet header()}<span class="ds-t-eyebrow">Control heights · 28 · 36 · 44 · 56</span>{/snippet}
      <div class="kit-scale" data-testid="scale">
        <Button size="xs">xs 28</Button><Button size="sm">sm 36</Button><Button>md 44</Button><Button size="lg" variant="primary" class="kit-lg-sample" data-testid="scale-lg">lg 56</Button>
      </div>
      <div class="kit-scale">
        <IconButton size="xs" label="Add" icon="plus" /><IconButton size="sm" label="Edit" icon="edit" /><IconButton label="Menu" icon="menu" /><IconButton size="lg" label="Talk" icon="mic" />
        <span class="ds-t-meta kit-note">icon buttons are circles of the same four heights</span>
      </div>
      <span class="ds-t-eyebrow">One row, one height</span>
      <div class="ds-row" data-testid="row-xs"><Button size="xs">Undo</Button><Button size="xs" variant="ghost">Decline</Button><IconButton size="xs" label="More" icon="more" /><Chip>Counter 3</Chip></div>
      <div class="ds-row" data-testid="row-sm"><Button size="sm">Edit</Button><Button size="sm" variant="quiet">Sort</Button><IconButton size="sm" label="Copy" icon="copy" /><Chip size="sm" onclick={() => (chipOn = !chipOn)} pressed={chipOn}>Creatures</Chip></div>
      <div class="ds-row" data-testid="row-md"><Button data-testid="btn-secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="quiet">Quiet</Button><Button variant="danger">Remove</Button><IconButton label="Settings" icon="settings" /></div>
      <div class="ds-row" data-testid="row-md-2"><Button pressed data-testid="btn-pressed">Pressed</Button><Button disabled>Disabled</Button><Button href="#kit">A link</Button></div>
      <div class="ds-row" data-testid="row-seg">
        <Segmented label="Format" options={[{ value: 'v1', label: '1v1' }, { value: 'ffa3', label: '3 FFA' }, { value: 'v2', label: '2v2', disabled: true, hint: 'Not in this build yet' }, { value: 'ffa4', label: '4 FFA' }]} value={seg} onchange={(v) => { log(`segment:${v}`); if (accept()) seg = v; }} data-testid="seg-format" />
        <Field label="Search cards" placeholder="Search" bind:value={field} data-testid="field-search">{#snippet icon()}<Icon name="search" size={16} />{/snippet}</Field>
      </div>
      <div class="ds-row">
        <Segmented size="sm" label="Filter" options={[{ value: 'all', label: 'All' }, { value: 'custom', label: 'Custom' }, { value: 'booster', label: 'Booster' }]} bind:value={filter} data-testid="seg-filter" />
        <Button size="sm" variant="ghost">Sort</Button>
      </div>
      <div class="ds-row"><Chip>Creature</Chip><Chip variant="on">Instant</Chip><Chip variant="line">Land</Chip><span class="ds-pips"><Pip colour="W" /><Pip colour="U" /><Pip colour="B" /><Pip colour="R" /><Pip colour="G" /><Pip colour="C" /></span></div>
      <div class="ds-row"><Field label="Room link" value="https://example.invalid/#/t/amber-fox-93" readonly square data-testid="field-link" /></div>
      <Stepper eyebrow="Mode" value={STEPS[step] ?? ''} prevLabel="Previous mode" nextLabel="Next mode" onprev={() => (step = (step + STEPS.length - 1) % STEPS.length)} onnext={() => (step = (step + 1) % STEPS.length)} data-testid="stepper" />
    </Sheet>

    <!-- 2. Paper and depth, the same chrome in the other looks, type -->
    <Sheet label="Paper and type" data-testid="kit-paper" class="span-4">
      {#snippet header()}<span class="ds-t-eyebrow">Four paper layers · five elevations</span>{/snippet}
      <div class="layers">
        <div class="layer ds-page"><span class="ds-t-eyebrow">Page</span></div>
        <div class="layer ds-well"><span class="ds-t-eyebrow">Well</span></div>
        <div class="layer sheet-like"><span class="ds-t-eyebrow">Sheet</span></div>
        <div class="layer raised"><span class="ds-t-eyebrow">Raised</span></div>
      </div>
      <div class="layers">
        {#each ['sheet', 'raised', 'pop', 'dialog', 'pressed'] as e (e)}<div class="layer elev" class:pressed={e === 'pressed'} style:box-shadow="var(--ds-elevation-{e})"><span class="ds-t-eyebrow">{e}</span></div>{/each}
      </div>
      <hr class="ds-hr" />
      <span class="ds-t-eyebrow">Same chrome over the other looks</span>
      <div class="samples" data-testid="look-samples">
        {#each SAMPLES as id (id)}
          <div class="sample ds-page" data-ds-layer="sample" data-look={id} style={sampleStyle(id)}>
            <span class="ds-t-eyebrow sample__name">{LOOK_LABELS[id]}</span>
            <div class="ds-plate sample__plate"><SeatGlyph seat={0} colour="var(--ds-seat-a)" size={40} /><span class="ds-plate__name">Ann</span><span class="ds-plate__life">20</span></div>
            <CardImage src={FACES[3]!.src} alt={FACES[3]!.alt} width={36} />
            <Button size="sm" variant="primary">To combat</Button>
          </div>
        {/each}
      </div>
      <hr class="ds-hr" />
      <span class="ds-t-eyebrow">Type · {look === 'plain' ? 'Fira Code for the chrome' : 'the look\'s faces'}</span>
      <span class="ds-t-word">Spellplane</span>
      <span class="ds-t-display">0:42</span>
      <h3 class="ds-t-heading">Green Stompy</h3>
      <span class="ds-t-title">Section title 18</span>
      <span class="ds-t-list">Cleo, Dev, Ben</span>
      <span class="ds-t-body">Body and buttons 14 · <span class="ds-t-meta">meta 12</span> · <span class="ds-t-eyebrow">eyebrow 11</span></span>
      <p class="ds-t-reading" style:margin="0">Card rules text and help longer than two lines use the reading face, so a paragraph stays easy to read.</p>
    </Sheet>

    <!-- 3. Identity, deck tiles, boosters -->
    <Sheet label="Identity" data-testid="kit-identity" class="span-4">
      {#snippet header()}<span class="ds-t-eyebrow">Identity</span>{/snippet}
      <div class="kit-scale">
        <SeatGlyph seat={0} colour="var(--ds-seat-a)" size={44} /><SeatGlyph seat={1} colour="var(--ds-seat-b)" size={44} /><SeatGlyph seat={2} colour="#3d6b35" size={44} /><SeatGlyph seat={3} colour="#9a6a1f" size={44} /><SeatGlyph seat={3} colour="var(--ds-ink)" size={44} computer label="Sparring" />
        <span class="ds-t-meta kit-note">seat colour + shape, never colour alone</span>
      </div>
      <div class="kit-scale"><PresenceDot state="here" /><PresenceDot state="connecting" /><PresenceDot state="away" label="away 2:10" /><StrengthPips band={3} score={54} /><StrengthPips band={null} /></div>
      <div class="kit-scale"><Badge>3</Badge><Badge tone="muted">12</Badge><Badge tone="success">Ready</Badge><Badge tone="danger">Lost</Badge><Badge onCard>4</Badge></div>
      <StatusLine>{#snippet icon()}<span class="ds-dot ds-dot--here"></span>{/snippet}14 players online</StatusLine>
      <StatusLine tone="danger">Connection lost</StatusLine>
      <hr class="ds-hr" />
      <span class="ds-t-eyebrow">Boosters are drawn from the set code, no official art</span>
      <div class="kit-scale boosters">
        {#each ['COR', 'ALP', 'M19', 'DOM'] as s (s)}<BoosterPack set={s} width={80} data-testid="booster-{s}" />{/each}
      </div>
      <hr class="ds-hr" />
      <span class="ds-t-eyebrow">Paper QR plate</span>
      <div class="kit-scale" style:align-items="flex-start">
        <QrPlate matrix={QR} size={124} label="QR code of Ben's link" data-testid="qr" />
        <p class="ds-t-reading" style:margin="0" style:max-width="200px">Black modules on a white plate in every look, so any camera reads it.</p>
      </div>
    </Sheet>

    <!-- 5. Deck parts -->
    <Sheet label="Deck parts" data-testid="kit-decks" class="span-12">
      {#snippet header()}<span class="ds-t-eyebrow">Deck tiles · custom, sealed, not allowed, new</span>{/snippet}
      <div class="tiles">
        <article class="ds-tile is-selected" data-testid="tile-custom" tabindex="-1">
          <div class="ds-tile__stage"><div class="ds-tile__cover"><CardImage src={null} alt="" width={96} aria-hidden="true" /><CardImage src={FACES[0]!.src} alt={FACES[0]!.alt} width={96} pile data-testid="tile-face" /></div></div>
          <div class="ds-tile__acts"><Button size="sm">Edit</Button><IconButton size="sm" label="More" icon="more" /></div>
          <div class="ds-tile__info">
            <div class="ds-tile__row"><span class="ds-tile__name">Green Stompy</span><Chip variant="on">Selected</Chip></div>
            <div class="ds-tile__row"><span class="ds-row" style:gap="4px"><Pip colour="G" size={14} /><span class="ds-t-eyebrow">40 · Custom</span></span><StrengthPips band={3} text={false} /></div>
            <div class="ds-tile__row"><span class="ds-t-meta">played 2 h ago</span><Sparkline values={[1, 6, 7, 5, 3, 2, 1]} label="Curve" /></div>
          </div>
        </article>
        <article class="ds-tile" data-testid="tile-booster" tabindex="-1">
          <div class="ds-tile__stage"><div class="ds-tile__cover"><CardImage src={null} alt="" width={96} aria-hidden="true" /><CardImage src={FACES[1]!.src} alt={FACES[1]!.alt} width={96} pile data-testid="sealed-face" /></div><SealBand packs="M19 × 6" data-testid="seal" /></div>
          <div class="ds-tile__info">
            <span class="ds-tile__name">Sealed pool</span>
            <div class="ds-tile__row"><span class="ds-row" style:gap="4px"><Pip colour="R" size={14} /><Pip colour="G" size={14} /><span class="ds-t-eyebrow">40 · Booster</span></span><StrengthPips band={2} text={false} /></div>
            <div class="ds-tile__row"><span class="ds-t-meta">opened today</span><Sparkline values={[0, 4, 6, 5, 4, 2, 1]} label="Curve" /></div>
          </div>
        </article>
        <article class="ds-tile is-locked" data-testid="tile-locked" tabindex="-1">
          <span class="ds-tile__reason"><Badge tone="ink">Booster decks only</Badge></span>
          <div class="ds-tile__stage"><div class="ds-tile__cover"><CardImage src={null} alt="" width={96} aria-hidden="true" /><CardImage src={FACES[2]!.src} alt={FACES[2]!.alt} width={96} pile data-testid="locked-face" /></div></div>
          <div class="ds-tile__info">
            <span class="ds-tile__name">Elves</span>
            <div class="ds-tile__row"><span class="ds-t-eyebrow">40 · Custom</span></div>
            <div class="ds-tile__row"><span class="ds-t-meta">Not allowed at this table</span></div>
          </div>
        </article>
        <div class="ds-tile ds-tile--new" data-testid="tile-new"><Icon name="plus" size={24} /><span class="ds-t-body">New deck</span><span class="ds-t-meta">boosters, custom, simple</span></div>
      </div>
      <hr class="ds-hr" />
      <div class="deck-split">
        <div class="deck-hero">
          <span class="ds-t-eyebrow">Your deck · 3 of 7</span>
          <CardFan cards={FACES} width={140} label="Green Stompy, five cards" data-testid="fan" />
          <span class="ds-t-heading">Green Stompy</span>
          <span class="ds-row" style:gap="8px"><Pip colour="G" size={14} /><span class="ds-t-eyebrow">Custom · 40</span><Sparkline values={[0, 4, 6, 4, 2, 1, 1]} label="Curve" /><StrengthPips band={3} score={54} /></span>
        </div>
        <div class="deck-rail">
          <span class="ds-t-eyebrow">Mana curve</span>
          <CurveChart creatures={[0, 4, 6, 4, 2, 1, 0, 0]} others={[0, 2, 3, 2, 1, 0, 1, 0]} target={[0, 5, 7, 6, 4, 2, 1, 0]} label="Mana curve of Green Stompy" data-testid="curve" />
          <ColourBar symbols={{ G: 18, R: 6 }} sources={{ G: 11, R: 6 }} />
          <div class="ds-lands"><span>22 lands · 24 suggested</span><Button size="xs">+2 lands</Button></div>
          <div><div class="ds-drow"><b>4</b><span>Llanowar Elves</span><span class="ds-pips"><Pip colour="G" size={14} /></span><span class="ds-t-meta">1</span></div><div class="ds-drow"><b>2</b><span>Giant Growth</span><span class="ds-pips"><Pip colour="G" size={14} /></span><span class="ds-t-meta">1</span></div></div>
          <div class="kit-scale" style:align-items="flex-end">
            <CurveChart size="small" creatures={[0, 4, 6, 4, 2, 1, 0, 0]} others={[0, 2, 3, 2, 1, 0, 1, 0]} label="Small curve" data-testid="curve-small" />
            <PileStack count={40}><CardImage src={null} alt="Library, 40 cards" width={63} /></PileStack>
          </div>
        </div>
      </div>
    </Sheet>

    <!-- 6. Play parts -->
    <Sheet label="Play parts" data-testid="kit-play" class="span-8 tall">
      {#snippet header()}<span class="ds-t-eyebrow">Play · what, how, with whom, go</span>{/snippet}
      <div class="ds-modes" role="radiogroup" aria-label="Mode" data-testid="modes">
        {#each [{ v: 'quick', n: 'Quick match', m: '3 looking now', i: 'globe' }, { v: 'private', n: 'Private table', m: 'Invite friends', i: 'userPlus' }, { v: 'solo', n: 'Solo', m: 'Against Sparring', i: 'cpu' }, { v: 'draft', n: 'Draft night', m: 'Open boosters', i: 'deck' }] as m (m.v)}
          <ModeCard value={m.v} name={m.n} meta={m.m} selected={mode === m.v} onselect={() => ((mode = m.v), log(`select:${m.v}`))}>{#snippet icon()}<Icon name={m.i as 'globe'} size={20} />{/snippet}</ModeCard>
        {/each}
      </div>
      <div class="ds-row kit-centre"><Segmented size="sm" label="Format" value="v1" options={[{ value: 'v1', label: '1v1' }, { value: 'v2', label: '2v2' }, { value: 'ffa4', label: '4 FFA' }]} /><Segmented size="sm" label="Ranked" value="casual" options={[{ value: 'casual', label: 'Casual' }, { value: 'ranked', label: 'Ranked' }]} /></div>
      <div class="ds-row kit-centre" data-testid="row-lg">
        <Button size="lg" variant="primary" data-testid="btn-primary" onclick={() => log('primary')}>Find match</Button>
      </div>
      <div class="ds-row kit-centre" data-testid="row-waiting">
        <Button size="lg" waiting data-testid="btn-waiting">Searching{#snippet trailing()}0:42{/snippet}</Button>
        <IconButton size="lg" variant="ghost" label="Cancel the search" icon="close" />
      </div>
      <div class="kit-centre"><StatusLine>{#snippet icon()}<span class="ds-dot ds-dot--here"></span>{/snippet}3 looking now</StatusLine></div>
      <div class="kit-centre"><div class="ds-qbar" data-testid="qbar"><span class="ds-ring" aria-hidden="true"></span><span>Searching</span><span class="ds-qbar__sep">·</span><span>Quick match · 1v1</span><span class="ds-qbar__sep">·</span><span class="ds-qbar__time">0:42</span><Button size="sm" variant="ghost">Cancel</Button></div></div>
      <div class="kit-centre"><div class="ds-tracker"><SeatGlyph seat={0} colour="var(--ds-seat-a)" size={24} /><span>Your turn · 7</span><Segmented size="sm" label="Step" value="main" options={[{ value: 'untap', label: 'Untap' }, { value: 'main', label: 'Main' }, { value: 'combat', label: 'Combat' }, { value: 'main2', label: 'Main 2' }, { value: 'end', label: 'End' }]} /></div></div>
      <hr class="ds-hr" />
      <div class="play-split">
        <div class="kit-centre" style:flex-direction="column" style:gap="12px">
          <span class="ds-t-eyebrow">Draft night · 3 boosters each</span>
          <BoosterFan sets={['COR', 'COR', 'COR']} count={3} width={120} label="Boosters of COR" data-testid="booster-fan" />
        </div>
        <div class="play-list">
          <span class="ds-t-eyebrow">Match found · seats</span>
          <div class="kit-scale"><Countdown seconds={seconds} total={20} label="Match found" data-testid="countdown" /><Button size="sm" onclick={() => (seconds = Math.max(0, seconds - 1))} data-testid="tick">Step</Button></div>
          <div class="ds-seat-row"><SeatGlyph seat={0} colour="var(--ds-seat-a)" size={44} /><span class="grow"><b>Ann</b> <span class="ds-t-meta">you · host</span></span><PresenceDot state="here" label="ready" /></div>
          <div class="ds-seat-row"><SeatGlyph seat={1} colour="var(--ds-seat-b)" size={44} /><span class="grow"><b>Ben</b></span><PresenceDot state="connecting" label="joining" /></div>
          <div class="ds-seat-row ds-seat-row--open"><Icon name="plus" size={20} /><span>Open seat</span></div>
        </div>
      </div>
    </Sheet>

    <!-- 4. Feedback and surfaces -->
    <Sheet label="Feedback" data-testid="kit-feedback" class="span-4">
      {#snippet header()}<span class="ds-t-eyebrow">Feedback · undo instead of “are you sure?”</span>{/snippet}
      <Toast kind="undo" text="Green Stompy" detail="removed" actions={[{ label: 'Undo', primary: true, run: () => log('static-undo') }]} onclose={() => undefined} />
      <Toast kind="request" text="Let Cleo in?" actions={[{ label: 'Decline', run: () => undefined }, { label: 'Allow', primary: true, run: () => undefined }]} />
      <Toast kind="status" text="Ben is back" />
      <div class="ds-row">
        <span bind:this={menuAnchor} style:display="inline-flex"><IconButton label="Ben's menu" icon="more" data-testid="open-menu" onclick={() => (menuOpen = !menuOpen)} pressed={menuOpen} /></span>
        <Button data-testid="open-dialog" onclick={() => (dialogOpen = true)}>Open dialog</Button>
        <span bind:this={coachAnchor} style:display="inline-flex"><Button data-testid="open-coach" onclick={() => (coach = true)}>Show a tip</Button></span>
      </div>
      <Panel eyebrow="Ben · seat 2" title="Away 2:10">
        {#snippet actions()}<IconButton size="sm" variant="quiet" label="Show the code large" icon="qr" />{/snippet}
        <p class="ds-t-reading" style:margin="0">Ben's browser lost the game. Send him his link; he sits down where he was.</p>
        {#snippet footer()}<Button size="sm">Copy Ben's link</Button>{/snippet}
      </Panel>
    </Sheet>

    <!-- 7. History and table parts -->
    <Sheet label="History and table parts" data-testid="kit-table" class="span-4">
      {#snippet header()}<span class="ds-t-eyebrow">History and the table</span>{/snippet}
      <span class="ds-glabel ds-t-eyebrow">Today</span>
      <div class="ds-hrow" data-testid="hrow">
        <TableThumb thumb={THUMB} seats={[{ colour: 'var(--ds-seat-a)', life: 18, me: true }, { colour: 'var(--ds-seat-b)', life: 12, away: true }]} data-testid="thumb" />
        <div><div class="ds-row" style:gap="8px"><span class="ds-t-list">VS Ben</span><PresenceDot state="away" /></div><span class="ds-t-eyebrow">Private · 1v1</span><div class="ds-t-body">Turn 3 · Ben's turn</div></div>
        <div class="ds-hrow__right"><span class="ds-t-meta">2 h ago</span><Button size="sm">Open</Button></div>
      </div>
      <div class="ds-continue"><span class="ds-t-eyebrow">Continue</span><span class="ds-t-body">VS Sparring · turn 5</span><span class="ds-t-meta">5 min ago</span><Icon name="chevronRight" size={16} /></div>
      <hr class="ds-hr" />
      <div class="ds-plate" data-testid="plate-me">
        <SeatGlyph seat={0} colour="var(--ds-seat-a)" size={56} />
        <div class="ds-plate__who"><span class="ds-plate__name">Ann <span class="ds-dot ds-dot--here"></span></span><span class="ds-t-meta">you</span></div>
        <span class="ds-plate__life">20</span>
      </div>
      <div class="ds-plate is-away" data-testid="plate">
        <SeatGlyph seat={1} colour="var(--ds-seat-b)" size={56} />
        <div class="ds-plate__who"><span class="ds-plate__name">Ben <span class="ds-dot ds-dot--away"></span></span><span class="ds-t-meta">away 2:10 · hand 5</span></div>
        <span class="ds-plate__life">12</span>
        <Button size="xs">Re-invite</Button>
      </div>
    </Sheet>
  </section>
</main>

<MenuPopover bind:open={menuOpen} anchor={menuAnchor} label="Ben's menu" testid="kit-menu" groups={[{ title: 'Seat', items: [{ id: 'invite', label: 'Bring Ben back…', run: () => log('menu:invite') }, { id: 'life', label: 'Set life', hint: 'L', run: () => log('menu:life') }] }, { title: 'Game', items: [{ id: 'concede', label: 'Concede', danger: true, run: () => log('menu:concede') }, { id: 'off', label: 'Not now', disabled: true, run: () => undefined }] }]}>
  {#snippet top(close)}<span class="ds-t-eyebrow">Ben · seat 2</span><Button size="sm" variant="primary" onclick={() => (log('menu:top'), close())}>Bring Ben back</Button>{/snippet}
</MenuPopover>
<Dialog bind:open={dialogOpen} label="Leave the table?" testid="kit-dialog" onclose={() => log('dialog:close')}>
  <p class="ds-t-reading" style:margin="0">The game goes on; your seat is kept.</p>
  {#snippet footer()}<Button variant="quiet" onclick={() => (dialogOpen = false)}>Stay</Button><Button variant="primary" onclick={() => ((dialogOpen = false), log('dialog:leave'))}>Leave</Button>{/snippet}
</Dialog>
{#if coach}<CoachMark anchor={coachAnchor} title="Press ATTACK" text="Sparring blocks and counts the damage." ondismiss={() => (log('coach:dismiss'), (coach = false))} data-testid="coach" />{/if}
<ToastHost />

<style>
  .kit {
    box-sizing: border-box;
    max-width: 1440px;
    margin: 0 auto;
    padding: var(--ds-space-xl) var(--ds-space-xxl) var(--ds-space-huge);
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-xl);
  }
  .kit-head {
    display: flex;
    align-items: baseline;
    gap: var(--ds-space-lg);
  }
  .kit-grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-auto-flow: row dense;
    gap: var(--ds-space-xl);
    align-items: start;
  }
  .kit-grid > :global(.span-4) {
    grid-column: span 4;
  }
  .kit-grid > :global(.span-8) {
    grid-column: span 8;
  }
  .kit-grid > :global(.span-12) {
    grid-column: 1 / -1;
  }
  .kit-grid > :global(.tall) {
    grid-row: span 2;
  }
  @media (max-width: 1100px) {
    .kit-grid > :global(.ds-sheet) {
      grid-column: 1 / -1;
    }
  }
  .ds-row,
  .kit-scale {
    flex-wrap: wrap;
  }
  /* The height scale and other demonstrations of several sizes side by side: not a row of controls (no .ds-row). */
  .kit-scale {
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
  }
  .kit-scale :global(.kit-lg-sample) {
    min-width: 0;
  }
  .kit-note {
    flex: 1 1 140px;
  }
  .kit-centre {
    display: flex;
    justify-content: center;
  }
  .layers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: var(--ds-space-md);
  }
  .layer {
    height: 56px;
    border-radius: var(--ds-radius-card);
    display: flex;
    align-items: flex-end;
    padding: var(--ds-space-sm);
  }
  .layer.ds-page {
    box-shadow: inset 0 0 0 1px var(--ds-line);
  }
  .sheet-like {
    background: var(--ds-panel);
    box-shadow: var(--ds-elevation-sheet);
  }
  .raised,
  .elev {
    background: var(--ds-panel-raised);
  }
  .elev.pressed {
    background: var(--ds-chip);
  }
  .raised {
    box-shadow: var(--ds-elevation-raised);
  }
  .samples {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-sm);
  }
  .sample {
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
    height: 72px;
    padding: 0 var(--ds-space-lg);
    border-radius: var(--ds-radius-card);
    box-shadow: inset 0 0 0 4px var(--ds-frame);
    font-family: var(--ds-font-body);
  }
  .sample__name {
    width: 72px;
    white-space: normal;
  }
  .sample__plate {
    height: 52px;
    padding: 6px 16px 6px 6px;
  }
  .sample__plate :global(.ds-plate__life) {
    font-size: 24px;
  }
  .tiles {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ds-space-xl);
  }
  .deck-split,
  .play-split {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ds-space-xxl);
    align-items: flex-start;
  }
  .deck-hero {
    flex: 1 1 340px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--ds-space-md);
  }
  .deck-rail,
  .play-list {
    flex: 1 1 300px;
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-md);
  }
  .play-split > :first-child {
    flex: 1 1 300px;
  }
  .boosters {
    gap: var(--ds-space-lg);
  }
  .grow {
    flex: 1;
  }
</style>
