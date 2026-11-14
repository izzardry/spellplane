/**
 * How many of M5-P3's one-time storage hints (ui/storage/Hints.svelte) the page shows now, so the start page shows one
 * hint at a time (PLAN M5-P5: hints short, never blocking, one at a time; M5 gate): the welcome waits while the Home
 * Screen or storage hint is up, or while they are still deciding whether to show.
 */
export const storageHintsShown = $state({ count: 0 });
