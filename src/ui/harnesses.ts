/**
 * Module test pages (dev and test builds only; CLAUDE.md "Test harnesses"): `?harness=<name>` mounts that module's
 * `mount(target)` instead of the app. M8-C added one name per M8 package (docs/design/m8/contracts.md Part C), each
 * with a stub mount its owner replaces. main.ts reads this table.
 */
export interface HarnessModule {
  mount(target: HTMLElement): void;
}

export const HARNESSES = {
  scene: () => import('../scene/harness'),
  ui: () => import('./harness'),
  confirm: () => import('./confirm/harness'),
  voice: () => import('./voice/harness'),
  render: () => import('../scene/render-harness'),
  // M5-P5: settings, About, first-run hints, empty and error states.
  settings: () => import('./settings/harness'),
  // M8 (contracts.md Part C): one page per package.
  kit: () => import('./design/harness'),
  home: () => import('./home/harness'),
  history: () => import('./history/harness'),
  decks: () => import('./decks/harness'),
  lobby: () => import('./lobby/harness'),
  gather: () => import('./gather/harness'),
  computer: () => import('./computer/harness'),
  match: () => import('./play/match-harness'),
} as const satisfies Record<string, () => Promise<HarnessModule>>;

export type HarnessName = keyof typeof HARNESSES;

/** Which package writes each M8 harness page (contracts.md Part C). */
export const M8_HARNESS_OWNERS: Readonly<Record<string, string>> = {
  kit: 'M8-P1',
  ui: 'M7-P2',
  scene: 'M7-P1, M7-P5',
  home: 'M8-P2',
  history: 'M8-P2',
  decks: 'M8-P3',
  lobby: 'M8-P4',
  gather: 'M8-P5',
  computer: 'M8-P6',
  match: 'M8-P7',
};

/** Whether `name` names a harness page. */
export function isHarness(name: string | null): name is HarnessName {
  return name !== null && Object.hasOwn(HARNESSES, name);
}
