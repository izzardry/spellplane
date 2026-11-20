/**
 * The ui harness's shell props (`setShell(partial)`), kept in one reactive object so the mounted HUD follows each call.
 * Snippet slots are named by fixture ('badge', 'menuTop', 'status', 'emptyStatus'); callbacks are recorded.
 */
import type { HudShellProps } from '../props';
import { fixtureEmptyStatus, fixturePlateBadge, fixturePlateMenuTop, fixtureStatus } from './shell-fixtures';

/** What a Playwright test may pass to setShell: plain data, the slots by fixture name. */
export interface ShellPartial {
  onleave?: boolean;
  menuTop?: { title?: string; items: { id: string; label: string; danger?: boolean }[] }[] | null;
  sandbox?: boolean | null;
  onchoosedeck?: boolean;
  seatPresence?: Record<string, 'here' | 'away'> | null;
  plateMenuTop?: boolean;
  plateBadge?: boolean;
  status?: 'line' | 'empty' | null;
  notice?: { id: number; text: string; action?: string } | null;
  chrome?: 'full' | 'plates';
  readOnly?: boolean;
  primaryOverride?: { label: string; quiet?: boolean } | null;
}

export class HarnessShell {
  props = $state<HudShellProps>({});
  /** Callbacks the shell received, in order ('leave', 'chooseDeck', 'menuTop:<id>', 'notice:<id>', 'primaryOverride'). */
  readonly calls: string[] = [];

  set(p: ShellPartial): void {
    const next: HudShellProps = { ...this.props };
    const calls = this.calls;
    if ('onleave' in p) next.onleave = p.onleave ? () => calls.push('leave') : undefined;
    if ('menuTop' in p) {
      const groups = p.menuTop;
      next.menuTop = groups ? () => groups.map((g) => ({ id: g.title ?? 'top', label: g.title ?? '', title: g.title, items: g.items.map((i) => ({ ...i, run: () => calls.push(`menuTop:${i.id}`) })) })) : undefined;
    }
    if ('sandbox' in p) next.sandbox = p.sandbox ?? undefined;
    if ('onchoosedeck' in p) next.onchoosedeck = p.onchoosedeck ? () => calls.push('chooseDeck') : undefined;
    if ('seatPresence' in p) next.seatPresence = p.seatPresence ?? undefined;
    if ('plateMenuTop' in p) next.plateMenuTop = p.plateMenuTop ? fixturePlateMenuTop : undefined;
    if ('plateBadge' in p) next.plateBadge = p.plateBadge ? fixturePlateBadge : undefined;
    if ('status' in p) next.status = p.status === 'line' ? fixtureStatus : p.status === 'empty' ? fixtureEmptyStatus : undefined;
    if ('notice' in p) {
      const n = p.notice;
      next.notice = n ? { id: n.id, text: n.text, ...(n.action ? { action: { label: n.action, run: () => calls.push(`notice:${n.id}`) } } : {}) } : null;
    }
    if ('chrome' in p) next.chrome = p.chrome;
    if ('readOnly' in p) next.readOnly = p.readOnly;
    if ('primaryOverride' in p) {
      const o = p.primaryOverride;
      next.primaryOverride = o ? { label: o.label, quiet: o.quiet, run: () => calls.push('primaryOverride') } : null;
    }
    this.props = next;
  }
}
