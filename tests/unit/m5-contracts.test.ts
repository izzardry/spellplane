// M5-C contracts: touch, audit, storage and updates, accessibility, settings and talk key, protocol version, stack
// badge and ego framing (PLAN Milestone 5 with its owner decisions; DESIGN "Input and interaction design", "Multiplayer
// architecture", "Card data and images", "Chat and voice").
import { describe, expect, it } from 'vitest';
import { ACTION_FAMILIES, ACTION_TYPES, isUndoable, type Action } from '../../src/core/actions';
import { AUDIT_STATUS_TEXT, auditGames, buildAuditBundle, verifyAudit, type AuditBundle } from '../../src/core/audit';
import { createTable, reduce } from '../../src/core/reducer';
import { canonicalJson } from '../../src/core/hash';
import { MTG_KEYMAP } from '../../src/games/mtg/keymap';
import { CTRL_KEY_CHORD, isModifierChord } from '../../src/games/types';
import { mtg } from '../../src/games/mtg/index';
import { createTouchRecognizer, TOUCH } from '../../src/scene/input/touch';
import { EGO_FRAMING_VIEWPORTS, STACK_COLLAPSE_CARD_PX } from '../../src/scene/types';
import { BACKUP_FILE_FORMAT, BACKUP_FILE_VERSION, DEFAULT_SETTINGS } from '../../src/store/types';
import { IMAGE_CACHE_LIMITS, imageEntryLimit, storageStatus } from '../../src/store/quota';
import { exportBackup, readBackup } from '../../src/store/backup';
import { MAX_IMAGE_ENTRIES } from '../../src/store/images';
import { RADIAL_SLOTS, THUMB_BAR, TOUCH_TARGET_PX } from '../../src/ui/touch/actions';
import { FOCUS_KEYS, WCAG_AA, moveFocus } from '../../src/ui/a11y/index';
import { updateMayApply } from '../../src/ui/update';
import { indicatorLabel } from '../../src/ui/voice/labels';
import { roomProtocol, versionAdvice, versionNotice } from '../../src/net/version';
import { PROTOCOL_VERSION } from '../../src/net/messages';
import { CARD_BACK_HOST, officialCardBackUrl } from '../../src/data/back';
import { DEFAULT_TALK, type LocalStores } from '../../src/store/index';
import { createHoldAloneGate } from '../../src/voice/hold';
import { TALK_HOLD_ALONE_MS } from '../../src/voice/types';
import { SW_MESSAGE, UPDATE_NOTICE, WEB_APP_MANIFEST } from '../../src/util/pwa';
import { SPECTATOR_ACTIONS } from '../../src/net/roles';
import { runSoak } from '../sim/soak/harness';

const notImplemented = (pkg: string) => new RegExp(`not implemented: ${pkg}`);
const table = () => createTable({ game: mtg, format: '1v1', seats: [{ name: 'A', colour: 0 }, { name: 'B', colour: 1 }] });

describe('M5-P1 touch', () => {
  it('has eight radial slots, clockwise and distinct, each running keymap actions', () => {
    expect(RADIAL_SLOTS.map((s) => s.id)).toEqual(['tap', 'flip', 'inspect', 'counter', 'toHand', 'toGraveyard', 'toExile', 'stack']);
    expect(RADIAL_SLOTS.map((s) => s.angleDeg)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    const actions = new Set(MTG_KEYMAP.map((b) => b.action));
    for (const s of RADIAL_SLOTS) for (const a of s.actions) expect(actions.has(a)).toBe(true);
    expect(RADIAL_SLOTS.find((s) => s.id === 'stack')?.actions).toEqual(['cast', 'ability']);
  });
  it('keeps Attack, Settle, Resolve, Ask and Talk on the thumb bar', () => {
    expect(THUMB_BAR.map((b) => b.action)).toEqual(['attack', 'settle', 'resolve', 'ask', 'talk']);
    expect(THUMB_BAR.filter((b) => b.hold).map((b) => b.action)).toEqual(['talk']);
    expect(TOUCH_TARGET_PX).toBeGreaterThanOrEqual(44);
  });
  it('orders its thresholds sensibly and names its package in the stub', () => {
    expect(TOUCH.longPressMs).toBeGreaterThan(TOUCH.tapMaxMs);
    expect(TOUCH.doubleTapPx).toBeGreaterThan(TOUCH.slopPx);
    expect(() => createTouchRecognizer(() => undefined)).toThrow(notImplemented('M5-P1'));
  });
});

describe('M5-P2 audit', () => {
  const bundle: AuditBundle = {
    seat: 's0',
    game: { game: 1, fromSeq: 10, toSeq: 40 },
    records: [{ kind: 'shuffle', sid: 'sh1', zone: 'library:s0', ownerNonce: 'n', peerNonces: ['p'], order: ['a', 'b'], reissue: { before: ['x', 'y'] } }],
  };
  it('publishes bundles as a sequenced meta action that is neither undoable nor open to spectators', () => {
    expect(ACTION_FAMILIES.auditPublish).toBe('meta');
    expect(ACTION_TYPES).toContain('auditPublish');
    const a: Action = { type: 'auditPublish', by: 's0', cid: 'c1', bundle };
    expect(isUndoable(a)).toBe(false);
    expect(SPECTATOR_ACTIONS).not.toContain('auditPublish');
    expect(JSON.parse(canonicalJson(a))).toEqual(a);
  });
  it('the reducer accepts the record without changing the table beyond its seq', () => {
    const t = table();
    const next = reduce(t, { type: 'auditPublish', by: 's0', cid: 'c1', seq: t.seq + 1, bundle });
    expect({ ...next, seq: t.seq }).toEqual(t);
  });
  it('labels a missing record neutrally', () => {
    expect(AUDIT_STATUS_TEXT.unverifiable).toBe('could not be checked: records missing');
  });
  it('stubs name M5-P2', () => {
    expect(() => auditGames([])).toThrow(notImplemented('M5-P2'));
    expect(() => buildAuditBundle({ seat: 's0', identities: {}, libraryOrder: [], hand: [], audit: [], received: {} }, bundle.game, [])).toThrow(notImplemented('M5-P2'));
    expect(() => verifyAudit({ seat: 's0', game: bundle.game, bundle, start: table(), log: [] })).toThrow(notImplemented('M5-P2'));
  });
});

describe('M5-P3 offline and storage', () => {
  it('declares an installable manifest without Wizards marks and a skip-waiting message', () => {
    expect(WEB_APP_MANIFEST.display).toBe('standalone');
    expect(WEB_APP_MANIFEST.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(JSON.stringify(WEB_APP_MANIFEST)).not.toMatch(/magic|wizards/i);
    expect(SW_MESSAGE.skipWaiting).toMatch(/^spellplane:/);
    expect(UPDATE_NOTICE).toBe('New version available: it applies after this game');
  });
  it('keeps the image cache limit of M0 and names a backup format', () => {
    expect(IMAGE_CACHE_LIMITS.maxEntries).toBe(MAX_IMAGE_ENTRIES);
    expect(IMAGE_CACHE_LIMITS.quotaShare).toBeGreaterThan(0);
    expect(IMAGE_CACHE_LIMITS.quotaShare).toBeLessThan(1);
    expect(BACKUP_FILE_FORMAT).toBe('spellplane-backup');
    expect(BACKUP_FILE_VERSION).toBe(1);
  });
  it('M5-P3 implemented its stubs (behaviour: tests/unit/store/quota*, export*, tests/unit/storage/*)', async () => {
    expect(await storageStatus(undefined, undefined, 'none')).toEqual({ usage: null, quota: null, persisted: false, imageEntries: null });
    expect(imageEntryLimit({ usage: null, quota: null, persisted: false, imageEntries: null })).toBe(IMAGE_CACHE_LIMITS.maxEntries);
    await expect(exportBackup({} as LocalStores, { decks: true, tables: 'all', settings: false }, 0)).rejects.not.toThrow(notImplemented('M5-P3'));
    expect(readBackup({}).errors).toEqual([{ where: 'file', message: 'The file is not a Spellplane backup.' }]);
    expect(updateMayApply({ route: 'room', stage: 'match' })).toBe(false);
  });
});

describe('M5-P4 accessibility', () => {
  it('uses WCAG AA minimums and arrow keys outside the keymap', () => {
    expect(WCAG_AA).toEqual({ text: 4.5, largeText: 3, nonText: 3 });
    const keys = new Set(Object.values(FOCUS_KEYS));
    expect(keys.size).toBe(6);
    for (const b of MTG_KEYMAP) expect(keys.has(b.chord.key)).toBe(false);
    expect(() => moveFocus(table(), mtg, null, null, 'nextCard')).toThrow(notImplemented('M5-P4'));
  });
});

describe('M5-P5 settings, card back, keymap', () => {
  it('adds settings with defaults that keep the M4 behaviour', () => {
    expect(DEFAULT_SETTINGS.cardBack).toBe('spellplane');
    expect(DEFAULT_SETTINGS.hintsSeen).toEqual([]);
    expect(DEFAULT_SETTINGS.talk).toEqual(DEFAULT_TALK);
  });
  it('loads the official back from backs.scryfall.io only', () => {
    expect(officialCardBackUrl()).toBe('https://backs.scryfall.io/normal/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg');
    expect(new URL(officialCardBackUrl('large')).hostname).toBe(CARD_BACK_HOST);
  });
});

describe('M5-P6 protocol version', () => {
  it('reads rooms saved before M5 as protocol 1 and stubs the notice', () => {
    expect(roomProtocol({})).toBe(1);
    expect(roomProtocol({ protocol: 2 })).toBe(2);
    expect(PROTOCOL_VERSION).toBe(1);
    const m = { mine: 1, theirs: 2, peerId: '', nickname: '' };
    expect(() => versionAdvice(m)).toThrow(notImplemented('M5-P6'));
    expect(() => versionNotice(m)).toThrow(notImplemented('M5-P6'));
  });
  it('stubs the soak harness', async () => {
    await expect(runSoak({ peers: 4, actions: 10, seed: 1 })).rejects.toThrow(notImplemented('M5-P6'));
  });
});

describe('M5-P7 table and voice', () => {
  it('describes Ctrl alone as a bare-modifier chord with a 200 ms hold-alone rule', () => {
    expect(CTRL_KEY_CHORD).toEqual({ key: 'Control' });
    expect(isModifierChord(CTRL_KEY_CHORD)).toBe(true);
    expect(isModifierChord({ key: 'v' })).toBe(false);
    expect(isModifierChord({ key: 'Control', shift: true })).toBe(false);
    expect(TALK_HOLD_ALONE_MS).toBe(200);
    expect(() => createHoldAloneGate()).toThrow(notImplemented('M5-P7'));
  });
  it('labels the spectator listen-only indicator', () => {
    expect(indicatorLabel('listening', DEFAULT_TALK, 'Ctrl')).toBe('Listening');
  });
  it('names the ego framing viewports and the stack collapse size', () => {
    expect(EGO_FRAMING_VIEWPORTS).toEqual([
      { width: 1440, height: 900 },
      { width: 1194, height: 834 },
    ]);
    expect(STACK_COLLAPSE_CARD_PX).toBeGreaterThan(0);
  });
});
