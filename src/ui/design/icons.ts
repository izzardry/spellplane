/**
 * The HUD's one icon set (PLAN Milestone 7, A1: "one consistent icon set"). Drawn for Spellplane on a 24 px grid as
 * 1.75 px strokes with round caps and joins, so every icon has the same weight in every look; no third-party set and
 * nothing copied from a game. Each entry is SVG path data (several paths joined with `M`); Icon.svelte strokes them in
 * `currentColor`, so an icon takes its button's ink and needs no colour of its own.
 */
export const ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  chat: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  micOff: 'M15 10V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  deck: 'M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 2h8a3 3 0 0 1 3 3v12',
  token: 'M12 3l7 4v10l-7 4-7-4V7z',
  die: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 15.5h.01M12 12h.01',
  coin: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4',
  shuffle: 'M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l2 3-2 3M18 14l2 3-2 3',
  untap: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  draw: 'M8 3h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 20v2M9 20l3 2 3-2',
  clip: 'M8 9v7a4 4 0 0 0 8 0V6a2.5 2.5 0 0 0-5 0v10a1 1 0 0 0 2 0V9',
  view: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.6 0-1.2-1-1.4-1-2.4 0-.8.6-1.5 1.5-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5zM7.5 11h.01M10 7h.01M15 7.5h.01',
  keys: 'M3 7h18v10H3zM7 10h.01M11 10h.01M15 10h.01M8 14h8',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  help: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  voice: 'M3 10v4M7 7v10M11 4v16M15 8v8M19 11v2',
  captions: 'M3 5h18v14H3zM7 10h4M7 14h7M13 10h4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  play: 'M7 4l13 8-13 8z',
  host: 'M3 20v-1a6 6 0 0 1 12 0v1M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM17 8v6M14 11h6',
  join: 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M3 12h12M11 8l4 4-4 4',
  next: 'M5 5l8 7-8 7M13 5l8 7-8 7',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  ask: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 8v5M12 16h.01',
  tidy: 'M4 6h16M4 12h10M4 18h6',
  hand: 'M6 4h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM16 6l3 .8a1 1 0 0 1 .7 1.2l-3.3 12',
} as const;

export type IconName = keyof typeof ICONS;
