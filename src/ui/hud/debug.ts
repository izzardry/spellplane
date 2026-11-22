/**
 * The HUD's layout part of the debug hook, `window.__spellplane.hud` (dev and test builds): where the screen-anchored
 * chrome and the resting hand cards are, so a spec can assert that no HUD element lies over a card face (visual.md 2.9
 * board 7; gate M8 finding F17) without reading pixels. Typed into util/debug.ts DebugParts by declaration merging, like
 * ui/chat/debug.ts, so no contract file changes.
 */
import { registerDebug } from '../../util/debug';

export interface HudRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HudLayoutDebug {
  /** The viewport, CSS px. */
  viewport: { width: number; height: number };
  /** Every hand card of the own fan; `raised` is the card under the pointer (drawn larger, over everything by design). */
  hand: { card: string; raised: boolean; rect: HudRect }[];
  /** Every shown piece of HUD chrome over the table (plates, bars, buttons, prompts, hints, coach marks), by name. */
  chrome: { name: string; rect: HudRect }[];
}

/** The open context menu: its box and, for a keyboard-opened menu, the card element it stands beside (ui/menu.ts MenuAnchor). */
export interface HudMenuDebug {
  rect: HudRect;
  anchor: { card: string; source: string; rect: HudRect } | null;
}

export interface HudDebug {
  layout(): HudLayoutDebug;
  /** The open context menu, or null (gate M8 finding N2). */
  menu(): HudMenuDebug | null;
}

declare module '../../util/debug' {
  interface DebugParts {
    hud: HudDebug;
  }
}

/** The chrome a spec checks against the hand: the HUD's marked clusters and the other packages' overlays on the table. */
const CHROME = '[data-hud-chrome], [data-testid="evening-bar"], [data-testid="hint"], [data-testid="coach-mark"], [data-testid="recovery-panel"]';

const rectOf = (el: Element): HudRect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};
const shown = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.01;
};

/** Read the layout under `root` (the HUD) and, for overlays mounted beside it, the document. */
export function hudLayout(root: ParentNode = document): HudLayoutDebug {
  const hand = [...root.querySelectorAll('[data-testid="hand"] [data-testid="hand-card"]')].filter(shown).map((el) => ({
    card: (el as HTMLElement).dataset.card ?? '',
    raised: el.classList.contains('hovered'),
    rect: rectOf(el),
  }));
  const chrome = [...document.querySelectorAll(CHROME)]
    .filter(shown)
    .map((el) => ({ name: (el as HTMLElement).dataset.hudChrome ?? (el as HTMLElement).dataset.testid ?? el.tagName.toLowerCase(), rect: rectOf(el) }));
  return { viewport: { width: window.innerWidth, height: window.innerHeight }, hand, chrome };
}

/** Register `hud.layout()` for the mounted HUD. */
export function registerHudDebug(root: () => ParentNode | null): void {
  registerDebug({ hud: { layout: () => hudLayout(root() ?? document), menu: () => hudMenu() } });
}

/** The open context menu as `hud.menu()` reports it. */
export function hudMenu(): HudMenuDebug | null {
  const el = document.querySelector<HTMLElement>('[data-testid="context-menu"]');
  if (!el) return null;
  let anchor: HudMenuDebug['anchor'];
  try {
    anchor = el.dataset.anchor ? (JSON.parse(el.dataset.anchor) as HudMenuDebug['anchor']) : null;
  } catch {
    anchor = null;
  }
  return { rect: rectOf(el), anchor };
}
