# M8 — Visual language (Ztyle adoption) and mocks

*Topic "visual" of the M8 design round, 20 Nov 2026. Written for the owner and for the agents who build it.*
*Source of every requirement: `docs/design/m8/owner-request.md`. The mock is `docs/design/m8/mock.html` (eight boards at 1440 × 900 in the Plain look; open it in a browser, `?only=<n>` shows one board at full size).*

This document defines how Spellplane looks and feels in M8: which parts of Ztyle are adopted, the tokens, the size and spacing system, the component recipes and the motion. `journey.md` decides where things are and what they are called on screen. `m7-adjustments.md` decides who owns which file and says in its section 3: "If the M8 design-language document gives other values, it wins." This is that document. Section 2.14 lists every place where it differs from a sibling text.

Owner sentences are quoted with the numbers of `journey.md` 1.1. The two this topic answers directly:

- **O1** "The UI presents itself with placed buttons and functions of different sizes, the panels are technical and boxy and the internal ordering of components looks like absent of design."
- **O2** "the white design lacks depth and tactileness. look into Ztyle and adopt portions of it for the plain design."

## Rulings of the lead planner (20 Nov 2026)

Where this file and a sibling differed, the lead planner decided. These rulings override the text below; the decisions are recorded in `docs/DECISIONS.md` (`[M8 plan]`).

- **Revision 1 (after the plan review) holds over everything in this file:** `docs/design/m8/contracts.md` Part B (the final props of every kit component) and Part G "Visual" (the arena still is halved to a sixteenth and box-blurred on a 2D canvas; the mock's one `filter: blur()` is a sketch, not a recipe; a locked tile dims text and well, never a card face; the seal band sits below the cover card; legacy panels on the main journey are swept to kit classes by their owners tonight).
- **Who builds what** is decided by `docs/PLAN.md`, "Milestone 8: Journey, decks and matchmaking" (after revision 1: one contracts agent M8-C, then ten packages in parallel, M7-P1, M7-P2, M7-P5 and M8-P1 … M8-P7, then M8-P8 Journey integration). The chunk ids in this file (J…, MM-…, PS-…, DK-…, C…, DS-…) name pieces of work, not packages; its build plan is a checklist for the package that PLAN names, and whatever PLAN lists under "later" is not built in the overnight run.
- **Game code:** the existing room id, three words and a number (`amber-fox-93`, shown as `AMBER FOX 93`). No six-character code in M8; no stored id changes.
- **No blur in CSS anywhere:** no `backdrop-filter` and no `filter: blur()` in the shell or over a table. The arena behind Home is a still that `src/scene/still.ts` delivers already soft; a saved table behind the Gathering card is dimmed by the flat `overlay` scrim, never blurred (card faces are on it).
- **Control heights** are the kit's four: 28, 36, 44, 56 px (`visual.md` V4).
- **Deck strength** is the one formula of `decks.md` section 5, in `src/data/deck/strength.ts`; the lobby's `Band` 1 to 5 is its five bands in order.
- **Leaving** has no confirmation and no first-time dialog; the table shows a back arrow top left.
- **The primary button** always starts the selected mode; it never reads `RESUME` or `CONTINUE`. The `CONTINUE` strip under it reopens the last unfinished game.
- **History rows and the continue strip** draw `TableThumb` from `GameSummary.thumb` (the list never loads a saved table); the component is `src/ui/design/TableThumb.svelte`.
- **Inviting a player again** (V20): the plate menu's top shows the away line and one button, `BRING BEN BACK`; the QR code and link appear in the popover after it is pressed. Copy follows `journey.md` (`Bring Ben back…`, plate badge `RE-INVITE`), not `INVITE AGAIN`.
- **The kit is built by M8-P1** from the seed M8-C lands; DS-8's full contrast matrix for the three other looks and DS-9's sweep of settings, storage, about, diag, recovery, audit and chat are later.

---

## 1. Decisions

Each line can be appended to `docs/DECISIONS.md` as `- [M8-V] decision — reason`.

| Id | Decision | Reason | Serves |
| --- | --- | --- | --- |
| V1 | **A fourth look, Plain, is Spellplane's house look and the default.** It is Ztyle on paper: grey-scale chrome, one monospace face, pills and circles, halftone. Kitchen Table, Graphite and Codex stay selectable. | What the owner saw and called "the white design" was the old Paper table with the old HUD. The owner asked for that plain design to be improved with Ztyle, and approved the other three one day earlier. Same as m7-adjustments D4. | O2 |
| V2 | **Depth comes from paper, not from colour.** Four paper layers (page, well, sheet, raised) and five elevations (sheet, raised, pop, dialog, pressed). Every elevation is a contact shadow, an ambient shadow and a lit top edge. Wells are pressed into the page. | "Lacks depth and tactileness." Ztyle has three depths and a 2 % step between page and card, which is why a white UI built on it reads flat on a large screen. More layers and layered shadows give depth without leaving grey-scale. | O2 |
| V3 | **Controls feel pressed.** A control lifts 1 px on hover, sinks 1 px and loses its shadow on press, and a toggle that is on stays sunk. A segmented control is a well with one raised thumb. A running search keeps its pill pressed in. | Tactility is feedback at the moment of touch. A state that looks like a held button needs no extra label. | O2 |
| V4 | **One height scale for every control: 28, 36, 44, 56 px.** 56 is only for the one primary button of a stage screen and the control beside it. Icon buttons are circles of the same four heights. A row of controls has one height. | "Buttons and functions of different sizes." M7's HUD used 30, 34, 40, 44 and 52. Four steps, each with a stated use, end the drift. A test measures it (section 3, DS-4). | O1 |
| V5 | **One spacing scale on a 4 px grid (4, 8, 12, 16, 24, 32, 48, 64) with fixed uses**, and a 12-column grid, 1248 px wide, for the shell. | "Placed buttons": spacing was chosen per screen. Section 2.5 gives each step one job. | O1 |
| V6 | **Every panel has the same anatomy and every list the same order.** Eyebrow, title, body, footer; the primary action last; destructive actions never beside it. Reading order is decision order: what, how, with whom, go. | "The internal ordering of components looks like absent of design." | O1 |
| V7 | **Actions are round, containers are rounded rectangles, and the bigger the container the bigger the radius** (Plain: chips and menu rows 8, cards and toasts 12, panels 16, sheets 20, buttons and plates fully round). | "Technical and boxy." This is Ztyle's rule. The other looks keep their own radii through the same tokens. | O1, O2 |
| V8 | **One filled control per layer.** The stage has one filled button. An open sheet, popover or dialog may have one of its own. Count badges and the selected chip are the only other ink fills. | Ztyle has one primary per state; a layer on top is a new state. Without the rule the table screen had 9 to 13 equal buttons. Same as journey J6. | O1 |
| V9 | **The chrome is monochrome. Hue is only identity or meaning:** green for here, ready and won; red for destructive and lost; the five mana colours as small lettered pips; seat colours always with a shape. | Ztyle rule 2. Cards carry all the colour on screen. | O2 |
| V10 | **Typeface: Fira Code for all chrome in Plain, bundled with the app. Card rules text and help longer than two lines use the system sans** (the "reading face"). | Ztyle rule 3 says one mono face. A card table has paragraphs Ztyle's games do not have: oracle text, deck notes, explanations. Mono is kept for everything that is a label, a name or a number. | O2 |
| V11 | **No blur anywhere in the kit.** No `backdrop-filter` and no `filter: blur()` in any design-system rule. Ztyle's glass becomes opaque paper with a shadow; scrims are a flat page colour at 82 %; the arena behind the shell is one soft still from the scene, stretched, under a veil. | M7's Safari work measured blur over the WebGL canvas as a cost. One rule for the whole kit is simpler to test than "allowed outside tables". m7-adjustments D11 allows blur over static content; this document does not use it. | O2, O22 |
| V12 | **Looks change materials, never structure.** Sizes, spacing, anatomy and component structure are shared. A look sets colour, type, radius, elevation, texture, motion and sound. The shell wears the viewer's look, and its backdrop is that look's arena. | M7's principle, kept. It lets all M8 screens be designed once, in Plain. | O2 |
| V13 | **The selected deck is drawn as a hand of whole cards:** the cover card upright in front, four more cards fanned behind it, on a pile. The name and facts sit under it. Nothing is cropped. | "As present as a blurred-out arena." A fan reads as a deck, not as one card, and stays legal: card faces are only scaled and rotated. | O9 |
| V14 | **A deck in the library is a deck box:** a tile with a whole cover card on a pile inside a dotted well. A booster deck wears a black paper band across the box with a lock and its packs (`COR × 3`). | The seal has to be visible without reading. A band that would have to be torn says "sealed" in any language. | O8, O10 |
| V15 | **The mana curve is ink.** Bars are black for creatures and halftone for other spells, with a dotted outline of a good curve behind them. Colour appears only as one thin bar of mana symbols under it. | "Simple decks with clear mana curves." Two textures read without colour, and the dotted target tells a beginner what "clear" means. | O10 |
| V16 | **Boosters are drawn by the app from the set code:** a dark foil wrap with crimped ends, a sigil computed from the code, and the code as text. No logo, set symbol or card art. | "An illustration of mysterious and closed boosters." Nothing official is bundled, and two sets look different without any asset. | O14 |
| V17 | **The mode picker is four mode cards on wide screens** (icon in a round well, name, one live line such as `3 looking now`), a plain segmented control under 1100 px and a stepper on phones. | Hearthstone and Heroes of the Storm show modes as tiles with a line of life in them. The cards are the segmented control's segments, grown by one line. | O11, O17 |
| V18 | **Waiting is shown by the thing that was pressed.** `FIND MATCH` stays pressed in and counts (`SEARCHING 0:42`); a round cancel button sits beside it. Elsewhere a black queue bar, 44 px, floats under the nav. | Ztyle: the Start pill carries the wait. The bar is black because it is the one thing in the shell that is live. | O17 |
| V19 | **A history row has a picture:** a small schematic of the saved table drawn from the saved state (card outlines, tapped or not, no faces), then who, what, the state and one action. | Ztyle: every game has a thumbnail renderer. It is drawn from public state at display time, so nothing new is stored and nothing hidden is shown. | O18 |
| V20 | **The player plate is a pill: seat glyph, name with a presence dot, life.** An away plate dims its life and shows an `INVITE AGAIN` chip. Its `⋯` menu opens with the QR code and link in it. | "A special menu present in each the player state in the respective panel." The invitation is inside the menu on a desktop, so it is one click from the plate. | O21 |
| V21 | **Destructive actions get an undo toast, never a question.** Requests from another player are a toast with two buttons. Status that changes often shares one toast slot. Coach marks are single bubbles anchored to what they explain. | Ztyle chapters 09 and 15. Confirm dialogs were part of what made the old UI feel technical. | O2 |
| V22 | **Motion is Ztyle's in the chrome:** fade plus a short slide, ease-out, 150 to 500 ms, no bounce. The cards on the table keep M7's springs. The chrome makes no sound except one chime when a match is found. | Ztyle rule 6. The owner asked for haptic card handling in M7; that is the table's, not the chrome's. | O2, O17 |
| V23 | **Game codes are small.** A code appears as meta text in a history detail and under a QR code. It is never a headline and never an input on Home. | Zhess's owner feedback removed codes from its screens: "a random code carries no meaning a player would choose". The code still names the room (journey J21). | O20 |
| V24 | **The wordmark is `SPELLPLANE`, light, tracked 0.3 em, and the tagline is "Zero Distractions. Just the Table."** | Ztyle's wordmark and tagline formula. The name is kept; see the open questions. | O2 |

---

## 2. Detailed design

### 2.1 What is taken from Ztyle

| Ztyle part | Verdict | In Spellplane |
| --- | --- | --- |
| Grey-scale chrome, colour only for meaning | **Adopt** | Plain's whole palette is hue 0. Red and green as in Ztyle. Mana pips and seat colours are identity ("theme-stable"). |
| One monospace face | **Adopt, with a reading face** | Fira Code for chrome. System sans for paragraphs (V10). |
| Pills and circles | **Adopt** | Every button is a pill or a circle in Plain. |
| Chrome floats at the edges, no permanent columns | **Adopt** | The M7 HUD proposal already does this. The shell has a floating top bar and no sidebars. |
| Glass (`card/80` + blur) | **Replace** | Opaque paper with layered shadows. No blur (V11). |
| Three depths | **Extend** | Four layers, five elevations (V2). |
| Halftone page | **Adopt** | 8 px dot grid on the page and the table mat; 4 px dense dots inside deck wells and on "other spells" bars. |
| Motion rules | **Adopt** for chrome | Section 2.10. Card physics stay M7's. |
| The stage that never moves, blurred, and un-blurs on Start | **Adopt** | The arena still behind Home, Decks and History; a 500 ms cross-fade into the live table. |
| The label follows the context (`START`, `RESUME`) | **Adopt in part** | The primary's label is the next step of the selected mode (`PLAY`, `FIND MATCH`, `CREATE TABLE`, `OPEN DRAFT TABLE`). It never reads `RESUME` or `CONTINUE`; the continue strip does that (journey J7). |
| Stepper, option pills, status line, presence dot | **Adopt** | Stepper on phones, option rows as small segmented controls, the status line under the primary, the dot on plates and rows. |
| Codes | **Adopt as plumbing** | V23. |
| Undo toasts, request toasts, one status slot | **Adopt** | V21. |
| Coach marks | **Adopt** | One bubble at a time, anchored; M7-P5 owns the ones in the table. |
| List card with thumbnail, grouped by time | **Adopt** | History (V19). |
| Empty states show nothing | **Adapt** | A library with no deck shows the `New deck` tile; History with no game shows nothing. |
| Tap the background to hide all chrome | **Leave** | A tap on the table deselects cards. |
| No sound | **Leave** | The owner asked for card sounds in M7. |
| Everything in one centred 448 px column | **Leave** on desktop | The library, the builder and History need width. Phones keep it. |
| lucide icons, React, Tailwind | **Leave** | Spellplane keeps its own icon set (24 px grid, 1.75 px stroke, `ui/design/icons.ts`) and Svelte. |
| Dark mode by mirroring | **Later** | Graphite is the dark look in M8. A dark Plain is listed in the open questions. |

### 2.2 Four looks, one structure

- **Shared by all looks:** control heights, spacing, grid, type sizes, component anatomy, icon set, layout of every screen, the rules of section 2.11.
- **Set by a look:** colour roles, type families and weights, label case and tracking, radii, elevations, textures, motion durations, sound gain.
- **The shell wears the look.** Home, Decks and History in Kitchen Table are cream paper sheets over a blurred oatmeal-and-walnut arena; in Graphite they are charcoal panels over a dark arena. Board 0 of the mock shows the same plate, card and primary in the three other looks.
- **Plain's table world** (for M7-P1, which owns `src/themes/plain/`):
  - Desk `#e3e3e3`; table surface `#f2f2f2` with the 8 mm halftone dot grid drawn into its texture, 5.5 % ink.
  - The table edge is a 1 mm lit rim (white on top, ink at 10 % below), like the edge of a board.
  - Cards cast a soft blob shadow (one instanced quad per card, no shadow map): 14 % ink, offset 1.5 mm, soft edge 4 mm; a lifted card's shadow grows to 28 % and 12 mm.
  - Piles show their thickness as stacked edges (the `stack` elevation's idea in 3D: one thin box per ten cards).
  - Zone marks are debossed wells, not outlines: a rounded rectangle 2 % darker than the mat with an inner shadow at the top.
  - Selection is a 0.8 mm ink ring with a 0.6 mm gap in the mat colour. Lines are ink strokes in seat colours as in Paper.
  - Unlit materials, no post-processing: Plain must be the cheapest look to draw.
- **How chrome sits on each table:**

| Look | Table | Chrome on it | How depth reads |
| --- | --- | --- | --- |
| Plain | pale grey paper, dots | white paper pills, ink text | dark soft shadows and a white top edge |
| Kitchen Table | oatmeal linen, walnut frame | cream paper chips | warm shadows, a hard 2 px lower edge ("pressed paper") |
| Graphite | charcoal slate | raised charcoal panels | a 1 px lighter top edge and a 1 px border lighter than the panel; shadows are nearly invisible on dark and are not relied on |
| Codex | midnight leather | navy panels with a gilt hairline | the gilt hairline and a deep shadow |

### 2.3 Tokens

Names are the kit's `--ds-*` variables (`ui/design/tokens.ts`, `designCssVars`). The API of the seed stays frozen (m7-adjustments D3); everything new below is additive.

**Plain, complete** (also the `:root` block of `mock.html`):

```css
/* paper layers, lowest to highest */
--ds-frame: #e3e3e3;           /* the desk behind the table */
--ds-mat: #f2f2f2;             /* page and table surface */
--ds-chip: #ebebeb;            /* wells: fields, tracks, slots, chips */
--ds-panel: #fcfcfc;           /* sheets and tiles */
--ds-panel-raised: #ffffff;    /* buttons, thumbs, popovers, plates */
--ds-ghost: rgba(252,252,252,.92);
--ds-border: rgba(13,13,13,.12);
--ds-line: rgba(13,13,13,.08);
--ds-ink: #0d0d0d;
--ds-muted: #666666;           /* 5.1:1 on the mat, 5.7:1 on white */
--ds-accent: #0d0d0d;  --ds-accent-ink: #fafafa;  --ds-accent-edge: #000000;
--ds-on: #0d0d0d;      --ds-on-ink: #fafafa;
--ds-selection: #0d0d0d;
--ds-badge: #0d0d0d;   --ds-badge-ink: #fafafa;
--ds-tip: #0d0d0d;     --ds-tip-ink: #fafafa;
--ds-coach: #ffffff;   --ds-coach-ink: #0d0d0d;
--ds-focus: #0d0d0d;
--ds-danger: #c81e1e;          /* 5.2:1 on the mat */
--ds-success: #0f7a36;         /* 4.8:1 on the mat */
--ds-warning: #8a5a00;         /* always with an icon */
--ds-overlay: rgba(242,242,242,.82);   /* scrim: the page colour, never black */
--ds-veil: rgba(242,242,242,.58);      /* NEW: over the arena still */
--ds-seat-a: #2f6f9f;  --ds-seat-b: #8a4f7d;
--ds-ornament: #bdbdbd;

/* type */
--ds-font-body: "Fira Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
--ds-font-heading: var(--ds-font-body);
--ds-font-numeral: var(--ds-font-body);
--ds-font-reading: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;   /* NEW */
--ds-label-case: uppercase;  --ds-label-spacing: .05em;
--ds-weight-regular: 400; --ds-weight-medium: 500; --ds-weight-bold: 600; --ds-weight-heavy: 700;
--ds-heading-weight: 500; --ds-numeral-weight: 500;

/* radius */
--ds-radius-sm: 8px; --ds-radius-button: 9999px; --ds-radius-panel: 16px;
--ds-radius-pill: 9999px; --ds-radius-plate: 9999px;
--ds-radius-card: max(var(--ds-radius-sm), calc(var(--ds-radius-panel) - 4px));   /* derived: list cards, toasts */
--ds-radius-sheet: calc(var(--ds-radius-panel) + 4px);                            /* derived: big sheets */

/* elevation: plain box-shadow, light from above, no x offset */
--ds-elevation-sheet: inset 0 1px 0 #fff, 0 0 0 1px rgba(13,13,13,.06), 0 1px 0 rgba(13,13,13,.10), 0 2px 4px rgba(13,13,13,.04), 0 14px 28px -10px rgba(13,13,13,.14);   /* NEW */
--ds-elevation-raised: inset 0 1px 0 #fff, 0 0 0 1px rgba(13,13,13,.08), 0 1px 1px rgba(13,13,13,.12), 0 3px 6px rgba(13,13,13,.07), 0 10px 20px -6px rgba(13,13,13,.14);
--ds-elevation-pop: 0 0 0 1px rgba(13,13,13,.08), 0 2px 4px rgba(13,13,13,.08), 0 12px 24px -4px rgba(13,13,13,.16), 0 32px 48px -12px rgba(13,13,13,.20);
--ds-elevation-dialog: 0 0 0 1px rgba(13,13,13,.08), 0 8px 16px rgba(13,13,13,.10), 0 40px 80px -16px rgba(13,13,13,.30);   /* NEW */
--ds-elevation-primary: inset 0 1px 0 rgba(255,255,255,.22), 0 1px 1px rgba(0,0,0,.4), 0 4px 8px rgba(13,13,13,.20), 0 12px 24px -6px rgba(13,13,13,.32);
--ds-elevation-pressed: inset 0 2px 4px rgba(13,13,13,.16), inset 0 0 0 1px rgba(13,13,13,.10);   /* NEW */
--ds-elevation-well: inset 0 1px 2px rgba(13,13,13,.12), inset 0 0 0 1px rgba(13,13,13,.05), 0 1px 0 #fff;   /* NEW */
--ds-elevation-card: 0 0 0 1px rgba(13,13,13,.10), 0 1px 1px rgba(13,13,13,.16), 0 4px 8px -2px rgba(13,13,13,.16);
--ds-elevation-card-lifted: 0 0 0 1px rgba(13,13,13,.10), 0 4px 6px rgba(13,13,13,.10), 0 18px 32px -6px rgba(13,13,13,.28);
--ds-elevation-stack: 0 1px 0 #fcfcfc, 0 2px 0 #cfcfcf, 0 3px 0 #fcfcfc, 0 4px 0 #cfcfcf, 0 5px 0 #fcfcfc, 0 6px 0 #c4c4c4, 0 14px 22px -6px rgba(13,13,13,.22);   /* NEW: a pile of cards */

/* texture (NEW): static background images, never a filter at run time */
--ds-texture-page: radial-gradient(circle, rgba(13,13,13,.055) 1px, transparent 1.3px);
--ds-texture-page-size: 8px 8px;
--ds-texture-dense: radial-gradient(circle, rgba(13,13,13,.16) 1px, transparent 1.3px);   /* 4 px grid */
--ds-texture-grain: url(grain.png);    /* 160 px tile, 5 % ink, bundled; on sheets and tiles only */

/* motion */
--ds-duration-fast: 150ms; --ds-duration-base: 200ms; --ds-duration-slow: 300ms; --ds-duration-deliberate: 500ms;
--ds-ease-standard: cubic-bezier(0,0,.2,1); --ds-ease-enter: cubic-bezier(0,0,.2,1);
--ds-ease-exit: cubic-bezier(.4,0,1,1);     --ds-ease-bounce: cubic-bezier(0,0,.2,1);   /* no overshoot */
```

**Shared by every look** (`LAYOUT`, re-valued; legacy keys keep their names):

```css
--ds-control-xs: 28px; --ds-control-sm: 36px; --ds-control-md: 44px; --ds-control-lg: 56px;   /* NEW names */
/* legacy keys map onto the scale: height 44, primary 56, talk 56, tracker 44, touch 44,
   strip-action 36, stepper 28, avatar 56, avatar-small 36 */
--ds-space-xs: 4px; --ds-space-sm: 8px; --ds-space-md: 12px; --ds-space-lg: 16px;
--ds-space-xl: 24px; --ds-space-xxl: 32px; --ds-space-xxxl: 48px; --ds-space-huge: 64px;   /* last two NEW */
--ds-type-label: 11px; --ds-type-small: 12px; --ds-type-body: 14px; --ds-type-control: 14px;
--ds-type-title: 18px; --ds-type-heading: 24px; --ds-type-display: 36px; --ds-type-life: 48px; --ds-type-brand: 36px;
--ds-edge: 16px;       /* in a table; the shell uses space-xl (24) at the top and space-xxl (32) at the sides */
/* identity colours, the same in every look */
--ds-mana-w: #f1ecd2; --ds-mana-u: #2f6fb5; --ds-mana-b: #2b2b2b; --ds-mana-r: #c8432f; --ds-mana-g: #2f7d4f; --ds-mana-c: #bdbdbd;
```

**Contract changes** (for M8-C; all additive except the radius rename m7-adjustments already lists):

```ts
// src/themes/types.ts
export type LookId = 'plain' | 'kitchen' | 'graphite' | 'codex';      // as m7-adjustments
export type SoundCue = … | 'matchFound';                              // falls back to 'turnChime' in a set without it

// src/ui/design/tokens.ts
export interface ColourTokens   { …; /** Over the arena still behind the shell. */ veil: string }
export interface TypeTokens     { …; /** Paragraphs: rules text, notes, help over two lines. */ reading: string }
export interface RadiusTokens   { sm: number; button: number; panel: number; pill: number; plate: number }
export interface ElevationTokens { raised; pop; primary; card; cardLifted;       // as today
                                   sheet: string; dialog: string; pressed: string; well: string; stack: string }
export interface TextureTokens  { page: string; pageSize: string; dense: string; grain: 'paper' | 'leather' | 'none' }
export interface LookTokens     { …; texture: TextureTokens }
export const MANA_COLOURS = { W: '#f1ecd2', U: '#2f6fb5', B: '#2b2b2b', R: '#c8432f', G: '#2f7d4f', C: '#bdbdbd' } as const;
// LAYOUT.control gains xs 28, sm 36, md 44, lg 56; LAYOUT.space gains xxxl 48, huge 64; values as above.
```

**The new tokens in the other three looks** (their existing tokens stay as in `tokens.ts`):

| Token | Kitchen Table | Graphite | Codex |
| --- | --- | --- | --- |
| `radius` sm / button / panel / pill / plate | 8 / 14 / 14 / 22 / 40 | 6 / 10 / 10 / 10 / 12 | 4 / 6 / 6 / 6 / 6 |
| `veil` | `rgba(217,204,178,.60)` | `rgba(22,25,30,.66)` | `rgba(27,34,53,.66)` |
| `reading` | the look's body face | the look's body face | the look's body face (system sans) |
| `sheet` | `inset 0 1px 0 rgba(255,255,255,.6), 0 0 0 1px rgba(80,60,40,.10), 0 2px 0 rgba(70,48,30,.10), 0 14px 28px -10px rgba(70,48,30,.22)` | `inset 0 1px 0 rgba(255,255,255,.05), 0 0 0 1px #323843, 0 2px 4px rgba(0,0,0,.4), 0 16px 32px -12px rgba(0,0,0,.5)` | `inset 0 0 0 1px rgba(200,167,94,.18), 0 0 0 1px rgba(200,167,94,.55), 0 6px 16px rgba(0,0,0,.4)` |
| `dialog` | `0 24px 60px -12px rgba(60,40,24,.42)` | `0 0 0 1px #3a414d, 0 30px 70px -10px rgba(0,0,0,.7)` | `0 0 0 1px rgba(200,167,94,.55), 0 30px 70px -10px rgba(0,0,0,.7)` |
| `pressed` | `inset 0 2px 4px rgba(70,48,30,.22)` | `inset 0 2px 4px rgba(0,0,0,.5)` | `inset 0 2px 5px rgba(0,0,0,.5)` |
| `well` | `inset 0 1px 2px rgba(70,48,30,.18), 0 1px 0 rgba(255,255,255,.7)` | `inset 0 1px 2px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.04)` | `inset 0 1px 3px rgba(0,0,0,.55), 0 1px 0 rgba(200,167,94,.12)` |
| `stack` | `0 2px 0 #e6dcc6, 0 3px 0 #b9a98a, 0 5px 0 #e6dcc6, 0 6px 0 #b9a98a, 0 14px 22px -6px rgba(60,40,24,.3)` | `0 2px 0 #2b3039, 0 3px 0 #0e1114, 0 5px 0 #2b3039, 0 6px 0 #0e1114, 0 14px 22px -6px rgba(0,0,0,.6)` | `0 2px 0 #313a55, 0 3px 0 #10141f, 0 5px 0 #313a55, 0 6px 0 #10141f, 0 14px 22px -6px rgba(0,0,0,.6)` |
| `texture.page` | linen: two 1 px lines crossing every 3 px, 5 % ink | dot grid, 8 px, 5 % white | none |
| `texture.dense` | 4 px dots, 18 % ink | 4 px dots, 14 % white | 4 px dots, 14 % gilt |
| `texture.grain` | `paper` | `none` | `leather` |

Plain's motion and sound entries: `duration { fast 150, base 200, slow 300, deliberate 500 }`, all easings ease-out, `sound { gain 0.4, cues: all card cues, onByDefault: true }`.

### 2.4 Depth and tactility: the recipe

1. **Four layers of paper.** Page (`mat`, dotted) is the ground. A **well** (`chip`) is pressed into whatever it sits on and holds things you type into, slide along or drop into: fields, segmented tracks, deck stages, slots. A **sheet** (`panel`) lies on the page: library, history, side panels, tiles. **Raised** (`panelRaised`) is what you press or what floats: buttons, thumbs, plates, popovers, toasts.
2. **Five elevations**, each built the same way: a lit top edge (`inset 0 1px 0 #fff`), a hairline ring (ink at 6 to 8 %), a tight contact shadow (1 to 2 px), and a wide ambient shadow with a negative spread so it stays under the object. Light comes from straight above; no shadow has an x offset.

| Elevation | Used by | Lift it reads as |
| --- | --- | --- |
| `sheet` | sheets, tiles, list cards, mode cards | lying on the page |
| `raised` | buttons, thumbs, plates, the top bar's pills, the tracker | a finger's width above |
| `pop` | menus, popovers, toasts, coach marks, a hovered tile, the selection strip | floating |
| `dialog` | dialogs, the match-found card | well above everything |
| `pressed` | a control under the pointer, a toggle that is on, the searching pill | pushed into the surface |

3. **Press.** Hover (fine pointers only): `translateY(-1px)`. Press: `translateY(1px) scale(.98)`, the shadow becomes `pressed`, the fill becomes `chip`. Release returns in 150 ms. The primary keeps its ink and gets a dark inner shadow instead. Only `transform` is animated; the shadow switches without a transition (section 2.11).
4. **Wells** carry `well`: an inner shadow at the top and a white lip below, so they read debossed on any layer.
5. **Piles.** Anything that stands for several cards carries `stack`: six alternating 1 px edges under it. Used by the deck hero, the deck tile, pile viewers and the booster deck.
6. **Texture.** The page and the table have the halftone dots. Sheets and tiles have the grain. Buttons, plates and anything over a live table have no texture: small things stay crisp.
7. **Card-like panels.** A tile is a card: 16 px corners, a well for its picture, text below, and it lifts 3 px to `pop` on hover.
8. **Focus** is a 2 px ink ring at a 2 px offset in every look's `focus` colour, on every control.

### 2.5 Size, spacing, grid, alignment, ordering

**Heights**

| Step | px | Used for | Side padding | Icon | Label |
| --- | --- | --- | --- | --- | --- |
| `xs` | 28 | chips, counters, steppers inside a row, the action inside a toast, small undo | 12 | 16 | 11 px |
| `sm` | 36 | actions inside tiles, rows, popovers and the selection strip; filter rows; menu rows; small segmented controls | 16 | 16 | 12 px |
| `md` | 44 | every standard button, field, segmented control, top-bar pill, the tracker, the queue bar; the primary of a sheet | 20 | 20 | 12 px |
| `lg` | 56 | the one primary of a stage screen (Home, lobby, table) and the round control beside it (cancel, talk) | 32 | 24 | 14 px |

- The stage primary is at least 240 px wide, so a label change does not move anything.
- Containers are not controls and have their own fixed sizes: plate 72, list row 88, mode card 72, toast at least 52, deck tile 220 × 268.
- On coarse pointers `xs` and `sm` controls keep their look and extend their hit area to 44 px with an invisible inset.

**Spacing**

| Step | Use |
| --- | --- |
| 4 | label to value; between a name and its dot |
| 8 | inside a control (icon to label); between sibling controls |
| 12 | between rows of a list; inside toasts and chips rows |
| 16 | between groups in a bar (with a 1 × 24 px divider when the groups differ in kind); padding of tiles, popovers, list cards; between blocks in a panel |
| 24 | padding of sheets; grid gutter; between tiles; the shell's top inset |
| 32 | between sections; the shell's side inset |
| 48, 64 | between a hero and what follows; empty-state breathing room |

**Grid.** The shell's content is 1248 px wide at most, centred, in 12 columns with 24 px gutters. Sheets span 12 columns. A side rail is 4 columns (392 px); the deck builder's rail is 384 px, the card pane takes the rest. Under 1296 px the side margin is 24, under 768 it is 16.

**Alignment rules**

- A1. A row of controls has one height from the scale. Mixing two heights in one row is a defect.
- A2. Left edges start at the container's padding. Footer actions are right-aligned, the primary last.
- A3. Numbers are tabular and right-aligned in columns; names are left-aligned.
- A4. A control with only an icon is a circle of the row's height; a control with text is a pill.
- A5. A label sits above its value with 4 px between them. Only settings rows put the label left and the control right (row height 44).
- A6. Icons are 16 px in `xs` and `sm`, 20 in `md`, 24 in `lg`.

**Ordering rules**

- O-1. Panel anatomy, top to bottom: eyebrow, title (with icon actions at the right of the title row), body, footer.
- O-2. Decision order is reading order: what (deck), how (mode, format), with whom, go (primary).
- O-3. Toolbars: the most used action leftmost; groups in the order history, assist, out.
- O-4. A destructive action is never next to the primary: it is first in the row, behind a divider, or in the overflow menu.
- O-5. List rows: picture, identity, state, then time top right and the action bottom right.
- O-6. Facts always come in the same order. A deck: colours, kind, size, curve, strength. A game: format, mode, state, turn.
- O-7. Menus: groups of at most seven rows, each with an eyebrow; keys right-aligned in muted text.

### 2.6 Type

- **Faces.** Plain: Fira Code (OFL), weights 300, 400, 500, 600, 700, `latin` and `latin-ext`, bundled as woff2 through `@fontsource/fira-code` and precached by the service worker. `font-variant-ligatures: none`, tabular numerals. Kitchen Table, Graphite and Codex keep their families.
- **Reading face.** `--ds-font-reading` at 13 px, line height 1.45, muted: rules text in inspect and the builder, deck notes, explanations in sheets, anything over two lines.

| Role | Size / line | Weight | Case and tracking | Example |
| --- | --- | --- | --- | --- |
| Wordmark | 36 / 40 (18 in the top bar) | 300 | upper, 0.3 em | `SPELLPLANE` |
| Display | 36 / 40 | 300 | 0.1 em | `0:42` |
| Life | 48 on the big plate, 40 on the pill plate | 500 | −0.02 em | `20` |
| Heading | 24 / 32 | 500 | 0.02 em | deck name |
| Title | 18 / 24 | 500 | label case, label tracking | `DECKS` |
| List primary | 18 / 24 | 500 | 0.03 em | `Cleo, Dev, Ben` |
| Body | 14 / 19 | 400 | none | |
| Control | 12 (14 in `lg`) | 500 | label case, label tracking | `FIND MATCH` |
| Eyebrow | 11 / 16 | 500 | label case, label tracking, muted | `YOUR DECK` |
| Meta | 12 / 16 | 400 | none, muted | `played 2 h ago` |
| Status line | 10, row 24 | 400 | upper, 0.1 em, muted | `3 LOOKING NOW` |
| Micro | 10 / 12 | 400 | muted at 60 %, decorative only | version stamp |

- Strings stay in natural case in the source; CSS applies capitals, so a screen reader and a translator see normal words.
- Times are `m:ss`; relative times are `2 h ago`, then a weekday, then `Nov 2`. Scores use an en dash: `20 – 18`.

### 2.7 Colour and identity

- **Ink ladder.** Besides the tokens, only these alphas of ink are used: 3 % (zebra rows), 5.5 % (dots), 8 % (lines), 12 % (borders), 20 % (ghost button ring, dashed empty tiles), 35 % (radio rings, bar outlines).
- **Meaning.** `success`: here, ready, saved, won, connected. `danger`: destructive hover, removal, lost connection for good. A lost game is muted text, not red. `warning` appears only with a triangle icon, for a deck that is short of cards.
- **Mana pips.** A 14 px disc (20 px in filters) in the colour's token with its letter in bold mono (`W U B R G C`; a number on grey for generic mana). The official mana symbols are not drawn or bundled. A pip always shows its letter, so it never depends on hue.
- **Seats.** A ring in the seat colour around its shape (● ◆ ▲ ■ …) on white. Sizes 24, 28, 44, 56. The eight seat colours stay the theme's; for Plain: `#2f6f9f #8a4f7d #3d6b35 #9a6a1f #a33b3b #2a7f7f #5a5a9a #6b6b6b`.
- **Presence dot**, 8 px: solid green = here; hollow and pulsing = away or connecting; hollow, grey and still = never joined or gone. Always next to a word.
- **Strength.** Five 4 × 12 px bars, filled or outlined, for the band; the number and band name in eyebrow type beside it (`54 SOLID`, from `decks.md`).
- **QR codes** are black modules on a white plate with a 10 px quiet margin and 8 px corners, in every look.

### 2.8 Components

Every recipe is in `mock.html` under the class named here. Kit components live in `src/ui/design/`; screens compose them.

**Controls**

| Component | Recipe |
| --- | --- |
| `Button` | Props `variant: 'primary' \| 'secondary' \| 'ghost' \| 'quiet' \| 'danger'`, `size: 'xs' \| 'sm' \| 'md' \| 'lg'` (default `md`; the seed's `small` stays as an alias of `xs`), `pressed`, `waiting`. Secondary: white, `raised`. Primary: ink, `primary`. Ghost: transparent with a 1 px ring of ink at 20 %. Quiet: no surface, muted text. Danger: ghost with red text. Disabled: `chip` fill, `well` shadow, muted text, in place. `waiting`: `chip` fill, `pressed` shadow, a pulsing ring, the label left and a timer right. |
| `IconButton` | A circle of the same sizes. Always has a label for assistive tech and a tooltip. |
| `Segmented` | Track: `chip`, `well`, pill, 4 px padding. Segments 36 px high (30 in `sm`), muted. Thumb: white, `raised`, slides 200 ms. Used for the nav, filters, formats, tabs and the turn tracker's steps. Arrow keys move, as a radio group. |
| `Field` | A well: `chip`, `well`, pill (or 12 px corners for a link field), 44 high, 16 px padding, a leading 16 px icon. Focus adds the focus ring. The deck name in the builder is the only underline input (2 px ink at 30 %). |
| `Stepper` | Chevron, eyebrow over value (min width 260), chevron. Phones only (mode picker). |
| `Chip` | 28 high, `chip` fill, label type. `line`: outlined and muted (off). `on`: ink. A filter chip is 36 high. |
| `Pip`, `SeatGlyph`, `PresenceDot`, `StrengthPips`, `Badge` | Section 2.7. Badge: ink pill, min 20 px, 11 px bold; on a card it is 28 px with a 2 px ring in the surface colour. |
| `StatusLine` | 24 px row, 10 px upper, 0.1 em, muted, one 12 px icon or dot. One line per screen. |

**Surfaces and feedback**

| Component | Recipe |
| --- | --- |
| `Sheet` | `panel`, grain, `sheet`, radius `sheet` (20), padding 24. Rises over the stage from below the top bar (top 92; 140 while the queue bar shows) to the bottom edge. |
| `Panel` | Slots `eyebrow`, `title`, `actions`, body, `footer`. Padding 24, blocks 16 apart. |
| `Pop` / menu | White, radius `panel`, `pop`. Menu rows 36 high, 8 px corners, hover `chip`, 16 px icon, key or value right in muted 11 px. Sections divided by a line with 12 px side inset. |
| List card | White, radius `card` (12), `sheet`, padding 12, 16 px gaps. Selected: a 2 px ink ring and `raised`. |
| Undo toast | White, radius `card`, `pop`, at least 52 high: subject in bold, verb muted, an `xs` ink `UNDO`, a close icon. 5 s; stacked toasts share the timer and gain `UNDO ALL`. Bottom centre in the shell; above the primary, right-aligned, in a table. |
| Request toast | The same surface: a presence dot, the request, `xs` ghost `DECLINE` and `xs` ink `ALLOW`. Stays until answered or withdrawn. |
| Status slot | One toast position for presence and connection messages; a new one replaces the old one. |
| Coach mark | White bubble, radius `card`, `pop`, max width 240, a 12 px bold title and an 11 px muted line, a 12 px rotated square as pointer. One at a time; a tap anywhere dismisses. |
| Dialog and scrim | Scrim `overlay` (flat). Card: white, radius `sheet`, `dialog`, centred, max width 448. |
| `QrPlate` | Section 2.7. 184 px in the invite sheet, 124 px in a plate menu, full height in "show the code large". |

**Deck parts** (composed by the decks topic in `ui/decks/`; the primitives `PileStack`, `SealBand`, `Sparkline`, `CurveChart`, `ColourBar` are the kit's)

| Component | Recipe |
| --- | --- |
| Deck hero | A fan of five whole cards on one pivot 20 % below the cards: the cover upright in front with `cardLifted` and `stack`, two cards at ±7° (3 px lower), two at ±14° (10 px lower). Cover width `clamp(160px, 22vh, 240px)` (200 at 900 px window height, 240 from 1090 px). Round 44 px arrows 40 px left and right of the fan. Under it: the name (heading), then one row of facts in the order of O-6. Hover lifts the cover 4 px. A deck with fewer than five cards with data shows backs for the missing ones. |
| Deck tile | 220 × 268 (one fifth of the sheet). White, grain, radius `panel`, `sheet`, padding 8. Top: a dotted well, 176 high, 10 px corners, holding a 96 px whole cover card turned −3° with `stack` and one card back behind it at +4°. Below, with 8 px side padding: the name (14 px bold, one line); pips, size and kind in eyebrow type with the strength pips right; a meta line (`played 2 h ago`, or what is wrong: `2 cards short`) with the curve sparkline right. Selected: 2 px ink ring and a `SELECTED` chip. Hover: lifts to `pop`, and a row of `sm` actions appears over the well's lower edge (`PLAY` ink, `EDIT`, `⋯`). |
| Seal band | On a booster deck's tile and hero: a 32 px ink band across the well at −3°, clipped by the well, white 10 px text tracked 0.12 em: a lock, the packs (`COR × 3`), and dashed white lines to both edges. |
| New deck tile | The same size, no surface: a dashed ring of ink at 20 %, a 56 px round plus, `New deck`, and a muted line naming the three ways. |
| Curve chart | Eight columns, 0 to 7+. Per column, from the bottom: an ink bar for creatures, a halftone bar with an ink outline for other spells, 9 px per card; the count above; the mana value below. Behind each column a dotted outline to the height of a good curve for the deck's size. A legend line under the chart. Height 148 in the builder, 64 as the small chart. |
| Sparkline | Six to eight 5 px ink bars, up to 20 px high. Tiles, the hero's fact row, the fixed bar on small screens. |
| Colour bar | One 8 px rounded bar split by mana symbol count, in the mana colours with an ink ring; under it per colour a pip, the symbol count and the number of sources. |
| Deck list row | 28 high, zebra at 3 %: count (bold), name, cost pips, mana value (muted, right). Group heads are eyebrows with the count right. |
| Lands helper | A well row: `22 lands · 24 suggested` and an `xs` button `+2 LANDS`. |

**Play parts**

| Component | Recipe |
| --- | --- |
| Mode card | 204 × 72, white, radius `panel`, `sheet`, 12 px gaps: a 44 px round well with a 20 px icon, the name (12 px bold, upper) and one live meta line. Selected: 2 px ink ring, `raised`, the icon well turns ink. Locked while searching: 45 % opacity. Four in a row with 12 px gaps. Under 1100 px it becomes the segmented control. |
| Option row | Small segmented controls (`sm`) side by side, 12 px apart: format, ranked or not. |
| Stage primary | `lg`, at least 240 wide, centred under the option row. Searching: `waiting` (pressed in, ring, `SEARCHING`, the time right) with a round `lg` ghost close button 12 px to its right. |
| Queue bar | An ink pill, 44 high, `primary` shadow, centred 12 px under the top bar: a pulsing ring, `SEARCHING`, mode and format, the time (bold, 0.1 em), the count, then a `sm` button `CANCEL` (white at 14 %). Parts are separated by a dot at 45 %. A click on the bar goes Home. Its content is the matchmaking topic's `QueueChip`. |
| Looking-now board | A popover, 320 wide: group heads in meta type with their counts; rows 36 high with a dot, the name, strength pips, the waiting time and a short note; an `sm` button for the one shortcut. |
| Match found | Centred on a scrim: a dialog card, radius `sheet`, with `MATCH FOUND` in wordmark type at 18 px, the format, the seats with glyphs and a check or dots, then a 56 px countdown ring beside an `lg` primary `ACCEPT`, and a quiet `DECLINE`. The ring is a conic gradient redrawn once a second. |
| Booster pack | Drawn by `packArt(setCode, index)`, pure and seeded by an FNV-1a hash of `"<code>:<index>"`: `{ points: 5–8, turnDeg: 0–359, rings: 2–3 }`. The pack: a foil gradient in five stops on a diagonal, a 5 px halftone over it, crimped ends (18 teeth, 7 px deep, with 24 px bands of fine vertical lines), a centre seam, the sigil (a star with `points` points and `rings` circles and rays, in hairlines), the set code as text (light, tracked) and `15 CARDS · BOOSTER`. Plain and Graphite: black foil with silver lines. Kitchen Table: kraft `#b08a5a` with ink lines. Codex: navy with gilt lines. A soft drop shadow, static. Sizes: 188 × 327 as the Draft Night hero (three, fanned −9°, 0°, +9°, overlapping 28 px), 80 × 139 in lists and the booster setup sheet. |
| Seat row (lobby) | A list card: a 44 px seat glyph, the name with `you · host` in meta, a presence dot and a word (`ready` in green), and a check or a `⋯`. An open seat is a dashed card with a plus. |
| Invite sheet | A sheet 336 wide: a 44 px well with the icon, title and a reading-face line; the QR plate; the link in a square field; a full-width `md` primary `COPY LINK`; a status line with the presence dot. |

**History and table parts**

| Component | Recipe |
| --- | --- |
| Table still | An SVG drawn from a saved `TableState`: the mat with dots, a centre line, one outlined rectangle per battlefield card at its place (rotated when tapped). No faces, no hands, no piles' contents. 128 × 72 in a row, 96 × 54 in the continue strip, full width × 194 in the detail. |
| History row | 88 high, white, radius `card`, `sheet`: the still; the players' names (list primary) with a presence dot; mode and format (eyebrow); the state in body type (`Your turn`, `Won` in green and bold, `Lost` muted) with turn and score in meta; top right the time, bottom right one `sm` button. The button is ink only on the selected row. Groups (`TODAY`, `THIS WEEK`, `OLDER`) are eyebrows with a line to the right edge. |
| History detail | The right 4 columns of the sheet, behind a hairline: the still, the names (heading), the facts and the game code (eyebrow), one roster row per player (seat glyph, name, `turn 7 · saved 2 h ago`, and a `NEWEST` chip on the newest copy), a well with one reading-face sentence saying what will happen, then an `md` primary and round buttons for the QR code and more. |
| Continue strip | On Home under the status line: an `md` white pill, `CONTINUE` in eyebrow type, the game in body type, the time in meta, a chevron. |
| Player plate | A pill 72 high, white, `raised`, padding 8 / 20 / 8 / 8, 12 px gaps: a 56 px seat glyph, the name (13 px bold) with the presence dot and a meta line (`you`, or `away 2:10 · hand 5`), the life numeral (40 px). Counters appear as chips to the right only when not zero. Away: glyph and life at 45 %, an `xs` button `INVITE AGAIN`, then the `sm` round `⋯`. |
| Plate menu | A popover 344 wide, anchored to the `⋯`, opening away from the table's centre. For an away seat it starts with the invitation: eyebrow (`BEN · SEAT 2`) and status, a 124 px QR plate beside a title and two lines, a full-width `sm` primary `COPY BEN'S LINK`. Then the built-in rows. On a phone the same content is a bottom sheet. |
| Turn tracker | A white `raised` pill, 44 high: the seat glyph (24), `YOUR TURN · 7` in control type, then a small segmented control with the five steps, the current one on the thumb. |
| Selection strip | A white pill with `pop` over the selected card: `sm` quiet buttons. |
| Table primary | Bottom right: a round `lg` talk button and the `lg` primary (min 200), 12 px apart. Toasts stack above them, right-aligned. |

### 2.9 Screens (the boards of `mock.html`)

All measures are for 1440 × 900. The top bar is the same on boards 1, 2, 4, 5 and 6: top 24, sides 32, height 44; the wordmark (18 px) left; the nav (segmented, icons 16) centred; the profile pill (seat glyph 28 and the nickname) and a round settings button right.

| Board | Layout |
| --- | --- |
| **0 System** | Heights, variants, the segmented control and field in one row, chips and pips; the paper layers and elevations; the same plate, card and primary in Kitchen Table, Graphite and Codex; type roles; toasts, a coach mark, status lines; seat glyphs, presence, strength; a custom and a booster deck tile; four boosters from four set codes. |
| **1 Home** | One centred column from top 88: eyebrow `YOUR DECK · 3 OF 7`; the fan (cover 200) between two round arrows; the name; the fact row; 18 px; four mode cards; 12 px; the option row; 20 px; the primary `FIND MATCH`; 12 px; the status line; 10 px; the continue strip; a chevron to the recent games below the fold. Nothing sits left or right of the column. |
| **2 Deck library** | The queue bar at top 80. A sheet from top 140, sides 96: a 44 px row with the title and count, a filter (`ALL · CUSTOM · BOOSTER`), a search field (280), a sort button and the `md` primary `NEW DECK`; then a five-column grid of tiles with 24 px gaps, the new-deck tile first. An undo toast at bottom centre. |
| **3 Deck builder** | Opaque page, no arena. Top row (44): back, the name, kind chip, colour pips; right a `CARDS 58 / 60` stat, a divider, `SAMPLE HAND`, more, the `md` primary `DONE`. Left pane (968): a 44 px row with the search field, `ALL CARDS · IN DECK` and the sort; a 36 px row with six colour toggles, type chips, a cost chip and the result count; a grid of whole cards, six per row, 148 wide, with count badges; the card in hand shows `−` and `+` under it. Right rail (384, a sheet): the curve chart with its legend, the colour bar, the lands helper, the list, and at the bottom `DECK · SIDE · MAYBE` with `SAVED`. |
| **4 Searching** | Home with the fan at 164, arrows disabled, mode cards and options locked, the primary pressed in and counting with the round cancel beside it, the status line (a tap opens the board) and one reading-face line. Shown with it: the looking-now board (right) and, as the next state, the match-found card (left; in the app it is centred on a scrim). |
| **5 Draft night** | Left a sheet (336) with the seats. Centre: eyebrow, three boosters, `3 boosters each` and a meta line, chips for the draft's rules, a row of three set buttons and the pick timer, then the `lg` primary, here disabled as `WAITING FOR BEN`, and a status line. Right the invite sheet (336). |
| **6 History** | A sheet from top 92: left 8 columns with the title, count and filter, then grouped rows; right 4 columns with the detail of the selected game. |
| **7 In game** | The Plain table. Top left menu and `UNDO`; top centre the tracker; top right a `saved 0:12 ago` status line and the activity button with its count. The opponent's plate under the tracker, away, its menu open to the right. The viewer's plate bottom left, the hand fan bottom centre, talk and `TO COMBAT` bottom right with the status toast above them. |

### 2.10 Motion and sound

| What | Motion |
| --- | --- |
| Press, hover | 150 ms, `transform` only |
| Segmented thumb | slides 200 ms |
| Popover, menu, coach mark | enter 200 ms: opacity and `translateY(-4px) scale(.98)` to rest; exit 150 ms |
| Sheet (Decks, History) | rises 16 px and fades in over 300 ms; leaves in 200 ms |
| Toast | 250 ms from 12 px below; a removed list row collapses its height in 200 ms |
| Deck switch on Home | the old fan slides 24 px toward the pressed arrow and fades (200 ms); the new one enters from the other side; its four back cards settle 40 ms apart |
| Mode change to Draft Night | the fan fades out, the three packs rise 16 px, 100 ms apart |
| Booster hover | the pack lifts 6 px and turns 2°; a light band crosses it once (a translated gradient, 500 ms) |
| Home to table | 500 ms: the top bar leaves upward 32 px, the column fades at scale .96, the still cross-fades to the live canvas by opacity once the scene has drawn its first frame; M7-P3's `enterFrom` moves the camera from the still's view. Leaving runs it backward. |
| Searching | the ring pulses at 1.6 s, ease-in-out; the timer changes once a second |
| Match found | the card scales in (200 ms); the countdown ring steps once a second |
| Loops allowed | the searching ring, an away dot, a button with an open request. Nothing else loops. |
| Reduced motion | every transition becomes an opacity change of 150 ms; loops stop and keep their still state |

Sound: the chrome is silent. One cue, `matchFound`, plays when the ready check opens (if sound is on). Card sounds are the table's, at gain 0.4 in Plain.

### 2.11 Chrome over the live table (Safari)

1. No `backdrop-filter` in any kit rule, in or out of a table.
2. No `filter` on anything mounted over the scene host. The booster's drop shadow is used only in the shell.
3. A panel that carries text is fully opaque. `ghost` (92 %) is only for idle hint chips.
4. Transitions animate `transform` and `opacity`. A shadow changes in one step, never as an animated box-shadow.
5. Scrims and the veil are flat colours.
6. The backdrop is the soft still of `src/scene/still.ts` (built by M7-P3), stretched with CSS, with the veil (`--ds-veil` plus the page dots) above it. No CSS blur is applied; journey J4's "static CSS blur" is not needed. While it loads, the page shows the backdrop's `tint` under the same veil.
7. Halftone and grain are static background images on opaque elements. Nothing inside a table has grain.
8. Chrome containers set `contain: layout paint`; no chrome element writes to the DOM per frame.
9. One test enforces rules 1 to 4 (DS-4).

### 2.12 Accessibility

- Contrast in Plain: ink on every surface at least 15:1; muted `#666` at least 4.8:1 on `chip`, `mat`, `panel` and white; `danger` and `success` at least 4.5:1 as text on each of them; the disabled primary (muted on `chip`) 4.8:1. A unit test holds Plain to this; the other three looks are brought to the same matrix in DS-8, because the shell now puts muted text on their `mat` through the veil.
- Nothing depends on hue: pips carry letters, seats carry shapes, presence is a shape and a word, the curve uses fill against halftone, won and lost differ in weight and word.
- Every control shows the focus ring. Segmented controls are radio groups; menus and popovers trap focus and close on Escape; toasts are a polite live region; a request toast takes focus only when the player presses its shortcut.
- Hit areas are at least 44 px on coarse pointers.

### 2.13 Phone and tablet

Not built for polish in this run (owner: later), but the system must not block it:

- The same four heights; `lg` primaries span the width minus 32.
- Sheets become full-screen pages with a sticky 44 px header; popovers become bottom sheets with 20 px top corners.
- The mode cards become a stepper, the deck tile grid two columns (three on a tablet), the builder one pane at a time under a segmented control.
- No component has a fixed width over 320 px except sheets, which have a maximum, not a minimum.

### 2.14 Where this differs from a sibling text

| Subject | Sibling | This document (built) |
| --- | --- | --- |
| Control heights | journey J6: 44, 36, 28 | 28, 36, 44 and 56 for the one stage primary (V4) |
| Plain's seed values | m7-adjustments section 3: mat `#f5f5f5`, panel `#ffffff`, muted `#737373`, chip `#f5f5f5`, danger `#dc2828`, success `#16a249`, label tracking 0.1 em, heading and life weight 300, plate radius 16, three shadow depths | the values of section 2.3 (darker page and muted for contrast and layer separation, five elevations, 0.05 em, weight 500, plate fully round) |
| Blur outside tables | m7-adjustments D11 allows Ztyle's 4 px blur over static content; journey J4 blurs the still with CSS | no blur at all; the still is already soft (V11) |
| Mode picker | journey 4.1: one segmented control | mode cards from 1100 px, the segmented control below (V17). Same order, labels and behaviour. |
| Deck hero | journey 4.1: one cover card with the facts beside it | a fan of five with the facts under it (V13). Same content and behaviour. |
| Searching pill | journey 4.5: outlined, plus a ghost `CANCEL` | pressed in, plus a round cancel (V18) |
| Queue bar | journey J15: a 44 px bar under the nav | the same place and content, drawn as a floating ink pill |
| History row | journey 4.14: seat glyphs at the left | a table still at the left; the seat glyphs are in the detail (V19) |
| Inviting again | journey 4.11: a sheet | the same content inside the plate's popover on desktop, a bottom sheet on phones (V20) |
| Booster size | journey 4.1: 120 × 190 | 188 × 327 as the Draft Night hero, 80 × 139 elsewhere |
| Codes on screen | journey J24: the code names the game in the invite sheet, History and the HUD pill | meta text only (V23) |

---

## 3. Build plan

The package is M8-DS in m7-adjustments' terms. It starts from the kit seed (`src/ui/design/*` from `m7-p2`). Chunks are 2 to 4 hours. `pnpm check` is green after each; e2e specs run through the pnpm scripts only.

**DS-C · Contracts (1.5 h, inside M8-C).**
Files: `src/themes/types.ts` (`SoundCue` gains `'matchFound'`), `src/ui/design/tokens.ts` (`veil`, `reading`, the five new elevations, `TextureTokens`, `MANA_COLOURS`, `LAYOUT` re-valued with `control.xs…lg` and `space.xxxl`, `space.huge`; the `PLAIN` entry with section 2.3's values; the table of section 2.3 for the other looks), `src/ui/design/css.ts` (emits the new variables, the derived `--ds-radius-card` and `--ds-radius-sheet`, and `--ds-radius-md` as an alias of `panel` until DS-9).
Acceptance: `tests/unit/design/tokens.test.ts` — every look defines every token; every `LAYOUT.control` value is 28, 36, 44 or 56; in Plain, ink, muted, danger and success reach 4.5:1 on `mat`, `chip`, `panel` and `panelRaised`; in every look, ink and muted reach 4.5:1 on `panel` and `panelRaised`, `accentInk` reaches 4.5:1 on `accent`, and the focus ring 3:1; no token string contains `blur(` or `backdrop`.

**DS-1 · Fonts and base recipes (3 h).**
Files: `package.json` (`@fontsource/fira-code`), `src/ui/design/fonts.ts` (imported by `main.ts`), `src/ui/design/base.css` (sizes, variants, press and hover, wells, sheets, textures, type roles, focus), `src/ui/design/grain.png` with `scripts/make-grain.mjs` (seeded noise, 160 px), `src/sw.ts` precache list.
Acceptance: a kit page at `?harness=ui&page=kit` renders board 0's content in each look. `tests/e2e/design/kit.spec.ts`: `document.fonts.check('14px "Fira Code"')` is true with the network blocked; a pressed button's computed transform and shadow differ from rest; screenshots to `artifacts/shots/M8/kit-<look>.png`.

**DS-2 · Controls (3 h).**
Files: `Button.svelte`, `IconButton.svelte` (size and the new variants), new `Segmented.svelte` (`Tabs.svelte` renders through it and keeps its props), `Field.svelte`, `Stepper.svelte`, `Chip.svelte`, `Pip.svelte`, `SeatGlyph.svelte`, `PresenceDot.svelte`, `StrengthPips.svelte`, `Badge.svelte`, `StatusLine.svelte`, new icons in `icons.ts` (search, lock, copy, edit, clock, check, qr, sliders, userPlus, cpu, globe, volume, arrowLeft, swap, chevronLeft, trash).
Acceptance: unit tests per component for props to classes; `kit.spec.ts` checks arrow-key movement in `Segmented`, a visible focus ring on every control, and a 44 px hit area for `xs` and `sm` under a coarse-pointer emulation.

**DS-3 · Surfaces and feedback (3 h).**
Files: `Sheet.svelte`, `Panel.svelte` (slots), `MenuPopover.svelte` (sections), `Toast.svelte` and new `ToastHost.svelte` with `toasts.ts` (undo, request, status slot), `CoachMark.svelte`, `Dialog.svelte` (flat scrim), `QrPlate.svelte`.
Acceptance: unit tests with fake timers — an undo toast lives 5 s and a second one restarts the timer and shows `UNDO ALL`; a request toast stays until answered; a second status message replaces the first; Escape closes a popover and returns focus.

**DS-4 · The design audit (2 h).**
Files: `tests/e2e/helpers/design-audit.ts`, `tests/unit/design/no-adhoc.test.ts`.
`designAudit(page)` reads computed styles of everything visible: every `button`, `[role=button]`, `input`, `select` and `.ds-seg` has a height of 28, 36, 44 or 56 (±0.5); the children of every `.ds-row` share one height; at most one `.ds-btn--primary` per layer (stage, sheet, popover, dialog); no element computes a `backdrop-filter`; no element inside the scene host's overlay computes a `filter`; every text node's font family starts with the look's face or its reading face.
The unit test scans `src/ui/**/*.{svelte,css}` for `backdrop-filter`, `filter: blur`, and a raw `<button` without a kit class, against an allow-list of legacy files that DS-9 empties.
Acceptance: the audit passes on the kit page in four looks, and every M8 screen spec calls it once.

**DS-5 · Deck primitives (3 h; the decks topic's DK-4 composes them).**
Files: `PileStack.svelte`, `SealBand.svelte`, `Sparkline.svelte`, `CurveChart.svelte`, `ColourBar.svelte`, and the recipes `.ds-tile`, `.ds-fan` in `base.css`.
Acceptance: unit tests — `CurveChart` draws creature and other bars with heights in proportion and a target outline per column, and exposes its numbers in a visually hidden table; an e2e check that a card face inside a tile or fan keeps the ratio 63:88 within 1 % and is not clipped (`object-fit: contain`, no `overflow: hidden` ancestor cutting it).

**DS-6 · Play parts (3 h).**
Files: `ModeCard.svelte`, `Countdown.svelte`, `BoosterPack.svelte`, `BoosterFan.svelte`, `src/ui/design/pack-art.ts`, the recipes `.ds-qbar`, `.ds-seat-row`, the `waiting` state of `Button`.
Acceptance: `packArt('COR', 0)` returns the same value on every call and differs from `packArt('ALP', 0)`; the rendered SVG has no `<image>`, no external reference and no `filter` attribute when mounted in a table; `ModeCard` group is a radio group; `Countdown` updates once a second (fake timers, no animation frame loop).

**DS-7 · History and plate parts (3 h).**
Files: `src/ui/design/TableThumb.svelte` (ruling: named `TableThumb`, not `TableStill`, to keep it apart from the arena still; it draws a `GameSummary.thumb`, which `session/summary.ts` computes from the public battlefield, plus one disc per seat with its life total), the recipes `.ds-hrow`, `.ds-roster`, `.ds-plate`, `.ds-tracker`; the plate itself stays M7-P2's `src/ui/hud/LifePlate.svelte`, restyled through the recipe.
Acceptance: unit test — `TableThumb` draws one rectangle per entry of a fixture `thumb` (rotated when tapped) and one disc per seat; it takes a `GameSummary` only (no `TableState`, no `SecretStore`). Screenshot of the plate with its menu open in four looks.

**DS-8 · The other looks and the Plain table brief (2 h).**
Files: `tokens.ts` values tuned from screenshots; the brief of section 2.2 handed to M7-P1 through the integrator (M8-DS edits nothing under `src/themes/` or `src/scene/`).
Acceptance: the token test's full contrast matrix (as for Plain in DS-C) passes for Kitchen Table, Graphite and Codex, with `muted`, `danger` and `success` tuned where needed; `pnpm shots -- M8` writes Home, Decks and the table HUD in each look.

**DS-9 · Sweep (3 h).**
Files: settings, storage, about, diag, recovery, audit and the chat drawer move from `--sp-*` and ad hoc CSS to kit components; the `--ds-radius-md` alias and the allow-list of DS-4 are removed.
Acceptance: `no-adhoc.test.ts` passes with an empty allow-list; the design audit passes on every route.

---

## 4. Open questions for the owner

Each has the default this design builds.

1. **Is Plain the default for everyone, also on a dark system?** Default: yes, always Plain on first visit; Graphite is one tap away in Settings. A dark Plain (Ztyle's mirror) can follow.
2. **One mono face everywhere, or the reading face for paragraphs?** Default: Fira Code for chrome, system sans for rules text and help over two lines (V10).
3. **The name.** Ztyle names games by swapping the first letter for a Z. Default: the game stays `SPELLPLANE`, with the tagline "Zero Distractions. Just the Table."
4. **Mana symbols.** Default: our own lettered pips, which work offline and bundle nothing official. The alternative is Scryfall's symbol images loaded at runtime, as card images are.
5. **Sound in Plain.** Ztyle has none; M7 asked for card sounds. Default: card sounds on at a low gain, silent chrome, one chime for a found match.
6. **How visible should a game's code be?** Default: small meta text only (V23), as Zhess ended up. `journey.md` shows it more often.
7. **Booster colour.** Default: black foil with silver lines in Plain and Graphite, kraft in Kitchen Table, navy and gilt in Codex. One dark foil in every look would be simpler and more "mysterious".
