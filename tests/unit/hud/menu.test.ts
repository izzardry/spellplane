/**
 * PLAN M7-P2: the HUD's Menu (docs/design/m7-hud-proposal.md, In the menu: rare tools grouped, "keys shown on the right
 * in muted type"; the task: import deck, tokens, dice, view, keys, settings, next game/new draft behind a confirm).
 * Every function the old toolbar offered stays reachable, and keys never become part of a label.
 */
import { describe, expect, it } from 'vitest';
import { MTG_KEYMAP } from '../../../src/games/mtg/keymap';
import { keyLabel } from '../../../src/ui/keymap';
import { HUD_MENU, hudMenu, hudMenuOffers, type HudMenuContext, type HudMenuId } from '../../../src/ui/menu';

const player: HudMenuContext = { spectator: false, voice: true, captions: true, proposals: ['nextGame', 'newDraft'] };
const keyOf = (a: Parameters<typeof keyLabel>[1]) => keyLabel(MTG_KEYMAP, a);

function ids(ctx: HudMenuContext): HudMenuId[] {
  return hudMenu(ctx, keyOf, () => {}).flatMap((g) => g.items.map((i) => i.id as HudMenuId));
}

describe('HUD menu', () => {
  it('groups the rare tools as the proposal lists them', () => {
    expect(HUD_MENU.map((g) => g.label)).toEqual(['Game', 'Deck', 'Table', 'View', 'Voice', 'Help']);
  });

  it("keeps every former toolbar function one step away (import deck, token, clip, view, keys, settings, look, voice, dictation, next game, new draft)", () => {
    const all = ids(player);
    for (const id of ['importDeck', 'token', 'clip', 'perspective', 'keys', 'settings', 'look', 'voice', 'mute', 'dictation', 'nextGame', 'newDraft', 'rollDie', 'flipCoin', 'drawN', 'mulligan'] as const) expect(all).toContain(id);
    // The old toolbar's testids survive on the items that took their function.
    const testids = hudMenu(player, keyOf, () => {}).flatMap((g) => g.items.map((i) => i.testid));
    for (const t of ['open-deck-import', 'clip-tray', 'perspective', 'open-cheat-sheet', 'open-settings', 'open-theme-settings', 'open-speech-settings', 'propose-nextGame', 'propose-newDraft']) expect(testids).toContain(t);
  });

  it('shows keys beside items, never inside their labels', () => {
    const items = hudMenu(player, keyOf, () => {}).flatMap((g) => g.items);
    const token = items.find((i) => i.id === 'token')!;
    expect(token.key).toBe(keyOf('token'));
    for (const i of items) expect(i.label).not.toMatch(/Ctrl\+|Shift\+|⌘/);
  });

  it('offers Next game and New draft only when the evening allows them (they confirm in a dialog)', () => {
    expect(ids({ ...player, proposals: [] })).not.toContain('nextGame');
    expect(ids({ ...player, proposals: ['newDraft'] })).toEqual(expect.arrayContaining(['newDraft']));
    expect(ids({ ...player, proposals: ['newDraft'] })).not.toContain('nextGame');
    expect(hudMenu(player, keyOf, () => {}).flatMap((g) => g.items).find((i) => i.id === 'newDraft')!.danger).toBe(true);
  });

  it('a spectator gets only the view and help tools; voice items need live voice', () => {
    const spec = ids({ spectator: true, voice: true, captions: true, proposals: [] });
    expect(spec).not.toContain('token');
    expect(spec).not.toContain('importDeck');
    expect(spec).not.toContain('dictation');
    expect(spec).toEqual(expect.arrayContaining(['fitTable', 'perspective', 'look', 'keys', 'settings', 'voice']));
    expect(hudMenuOffers('voice', { ...player, voice: false })).toBe(false);
  });

  it('runs the item it was given, and hands the paperclip a press instead (it is dragged out of the menu)', () => {
    const ran: HudMenuId[] = [];
    let pressed = 0;
    const groups = hudMenu(player, keyOf, (id) => ran.push(id), { clip: () => pressed++ });
    const items = groups.flatMap((g) => g.items);
    items.find((i) => i.id === 'importDeck')!.run!();
    expect(ran).toEqual(['importDeck']);
    const clip = items.find((i) => i.id === 'clip')!;
    expect(clip.run).toBeUndefined();
    clip.onpointerdown!({} as PointerEvent);
    expect(pressed).toBe(1);
  });

  it('labels Mute by state', () => {
    const items = (muted: boolean) => hudMenu({ ...player, muted }, keyOf, () => {}).flatMap((g) => g.items);
    expect(items(true).find((i) => i.id === 'mute')!.label).toBe('Unmute microphone');
    expect(items(false).find((i) => i.id === 'mute')!.label).toBe('Mute microphone');
  });
});

describe('HUD menu and the shell (HudShellProps)', () => {
  it('offers "Import deck…" only when the table imports (the sandbox)', () => {
    expect(ids({ ...player, importDeck: false })).not.toContain('importDeck');
    expect(ids({ ...player, importDeck: true })).toContain('importDeck');
  });
});
