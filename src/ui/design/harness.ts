/**
 * The kit page (`?harness=kit`, dev and test builds; contracts.md Part C): board 0 of docs/design/m8/mock.html built
 * from the kit's own components in one look (`&look=plain|kitchen|graphite|codex`, default Plain). Playwright reads it
 * through `window.__kitHarness`. Added by M8-P1.
 */
import { mount as mountSvelte } from 'svelte';
import { LOOK_IDS, lookIdOf } from '../../themes/index';
import type { LookId } from '../../themes/types';
import './kit';
import { applyLook } from './css';
import { fontsReady } from './fonts';
import KitPage from './KitPage.svelte';
import { packArt, type PackArt } from './pack-art';
import { toasts } from './toasts';

export interface KitHarness {
  look(): LookId;
  looks(): readonly LookId[];
  fontsReady(): Promise<boolean>;
  /** What the page's controls reported (`select:<mode>`, `segment:<value>`, `undo:<n>` …), oldest first. */
  events(): string[];
  undo(text: string): void;
  request(text: string): void;
  status(text: string | null): void;
  clearToasts(): void;
  packArt(set: string, index: number): PackArt;
  /** While on, the page refuses picks of its format control (`seg-format`): the pick is logged, the value kept. */
  refuse(on: boolean): void;
}

declare global {
  interface Window {
    __kitHarness?: KitHarness;
  }
}

export function mount(target: HTMLElement): void {
  const q = new URLSearchParams(location.search);
  const look = lookIdOf(q.get('look') ?? 'plain');
  applyLook(document.documentElement, look);
  document.body.classList.add('ds-page', 'ds-root');
  // The app's frame pins html and body (App.svelte: overflow hidden, height 100 %); the kit page is a long document.
  for (const el of [document.documentElement, document.body]) {
    el.style.overflow = 'auto';
    el.style.height = 'auto';
  }
  const events: string[] = [];
  const log = (e: string): void => {
    events.push(e);
  };
  let refusing = false;
  mountSvelte(KitPage, { target, props: { look, log, accept: () => !refusing } });
  window.__kitHarness = {
    look: () => look,
    looks: () => LOOK_IDS,
    fontsReady,
    events: () => [...events],
    undo: (text) => toasts.undo(text, () => log(`undo:${text}`), { commit: () => log(`commit:${text}`) }),
    request: (text) => void toasts.request(text, { allow: () => log(`allow:${text}`), decline: () => log(`decline:${text}`) }),
    status: (text) => toasts.status(text),
    clearToasts: () => toasts.clear(),
    packArt,
    refuse: (on) => {
      refusing = on;
    },
  };
}
