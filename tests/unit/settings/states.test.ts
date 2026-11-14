// Empty and error states, the storage section, the About text and the settings routes (PLAN M5-P5: "About panel with
// the Wizards Fan Content Policy notice and Scryfall and MTGJSON credits", "error and empty states everywhere (no deck,
// no cards found, no peers, relay unreachable, storage full, failed image)"; DESIGN "Card data and images", Legal
// position and Caching; "Multiplayer architecture", No relay fallback: say so plainly with the usual remedies).
import { describe, expect, it } from 'vitest';
import { CREDITS, FAN_CONTENT_NOTICE, FAN_CONTENT_POLICY_URL } from '../../../src/ui/about/about';
import { EMPTY_STATES } from '../../../src/ui/empty/states';
import { RELAYS_TEXT, REMEDIES } from '../../../src/ui/lobby/connectivity';
import { parseRoute, routeHash } from '../../../src/ui/routes';
import { SETTINGS_SECTIONS, settingsSectionOf } from '../../../src/ui/settings/sections';
import { formatBytes, isQuotaError, isStorageFullLine, storageLevel, storageSummary } from '../../../src/ui/settings/storage';

describe('the empty and error states the plan names', () => {
  it('has each of them, with a title and a sentence on what to do', () => {
    for (const id of ['noDeck', 'noCardsFound', 'noPeers', 'relayUnreachable', 'storageFull', 'failedImage'] as const) {
      const s = EMPTY_STATES[id];
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.text.length).toBeGreaterThan(20);
    }
    expect(EMPTY_STATES.storageFull.tone).toBe('alert');
    expect(EMPTY_STATES.noDeck.tone).toBe('status');
  });

  it('the relay and no-peers states say what the lobby says, with the remedies (no relay fallback)', () => {
    expect(EMPTY_STATES.relayUnreachable.text).toBe(RELAYS_TEXT);
    expect(EMPTY_STATES.noPeers.text).toContain(REMEDIES);
  });
});

describe('storage', () => {
  it('levels: unknown without numbers, nearly full from 90 %, full from 98 %', () => {
    expect(storageLevel(null)).toBe('unknown');
    expect(storageLevel({ usage: 5, quota: null, persisted: false, imageEntries: null })).toBe('unknown');
    expect(storageLevel({ usage: 10, quota: 100, persisted: false, imageEntries: 0 })).toBe('ok');
    expect(storageLevel({ usage: 90, quota: 100, persisted: false, imageEntries: 0 })).toBe('nearlyFull');
    expect(storageLevel({ usage: 98, quota: 100, persisted: false, imageEntries: 0 })).toBe('full');
    expect(storageLevel({ usage: 120, quota: 100, persisted: false, imageEntries: 0 })).toBe('full');
  });

  it('formats bytes and states persistence plainly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(12_400_000)).toBe('12 MB');
    expect(formatBytes(2_000_000_000)).toBe('2 GB');
    expect(formatBytes(null)).toBe('unknown');
    expect(storageSummary({ usage: 12_400_000, quota: 2_000_000_000, persisted: true, imageEntries: 1 })).toBe('12 MB of 2 GB used; 1 card image cached. Storage is persistent: the browser keeps it.');
    expect(storageSummary(null)).toMatch(/does not report/);
  });

  it('recognises a write refused for lack of space, and a save that failed for it', () => {
    expect(isQuotaError({ name: 'QuotaExceededError', message: '' })).toBe(true);
    expect(isQuotaError({ name: 'Error', message: 'The quota has been exceeded.' })).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError(new Error('network down'))).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
    expect(isStorageFullLine({ kind: 'system', level: 'warn', text: 'Could not save the table: QuotaExceededError: The quota has been exceeded.' })).toBe(true);
    expect(isStorageFullLine({ kind: 'system', level: 'warn', text: 'Could not save the table: the connection closed' })).toBe(false);
    expect(isStorageFullLine({ kind: 'action', text: 'quota' })).toBe(false);
  });
});

describe('About', () => {
  it('carries the Fan Content Policy disclaimer and credits Scryfall and MTGJSON', () => {
    expect(FAN_CONTENT_NOTICE).toContain('unofficial Fan Content permitted under the Fan Content Policy');
    expect(FAN_CONTENT_NOTICE).toContain('Not approved/endorsed by Wizards');
    expect(FAN_CONTENT_NOTICE).toContain('©Wizards of the Coast LLC');
    expect(FAN_CONTENT_POLICY_URL).toBe('https://company.wizards.com/en/legal/fancontentpolicy');
    expect(CREDITS.map((c) => c.name)).toEqual(['Scryfall', 'MTGJSON']);
    expect(CREDITS.find((c) => c.id === 'mtgjson')!.text).toContain('MIT');
  });
});

describe('routes', () => {
  it('#/settings and #/about are pages; unknown hashes stay not found', () => {
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('#/about/')).toEqual({ name: 'about' });
    expect(routeHash({ name: 'settings' })).toBe('#/settings');
    expect(routeHash({ name: 'about' })).toBe('#/about');
    expect(parseRoute('#/settings/keys').name).toBe('notFound');
  });

  it('the settings sections cover what the plan consolidates', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual(['display', 'voice', 'dictation', 'keys', 'cardBack', 'storage', 'about']);
    expect(settingsSectionOf('keys')).toBe('keys');
    expect(settingsSectionOf('nope')).toBe('display');
  });
});
