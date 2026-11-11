/**
 * M0-P7 in the browser (docs/PLAN.md): the app creates the solo session, imports the 60-card fixture deck as hidden
 * library cards, shuffles, draws, undoes, and a reload restores the same state hash from IndexedDB (namespaced by
 * ?profile=). Card data comes from tests/fixtures/ through the injected data source, faces from ?faces=placeholder.
 */
import { expect, test } from '@playwright/test';
import type { SecretStore, TableState } from '../../../src/core/types';
import { hook } from '../helpers/app';
import { call, decklist, freshProfile, openSolo, waitForSession } from './helpers';

test('imports the fixture deck as 60 hidden library cards whose identities exist only in the secret store', async ({ page }, info) => {
  const errors: string[] = [];
  const outside: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Card data comes from the injected fixtures: the page never asks Scryfall (or anything but the test server).
  page.on('request', (r) => {
    if (!new URL(r.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/) && !r.url().startsWith('data:')) outside.push(r.url());
  });
  await openSolo(page, freshProfile(info));
  const res = await call<{ main: number; side: number; errors: string[] }>(page, 'importDecklist', decklist('gw-m19-60.txt'));
  expect(res).toEqual({ main: 60, side: 3, errors: [] });

  const state = await hook<TableState>(page, 'state');
  const secrets = await hook<SecretStore>(page, 'secrets');
  const lib = state.zones['library:s0']!;
  expect(lib.ids).toHaveLength(60);
  expect(Object.values(state.cards).every((c) => c.zone === 'library:s0' && c.identity === undefined && c.face === 'down')).toBe(true);
  expect(Object.keys(secrets.identities).sort()).toEqual([...lib.ids].sort());
  const shared = JSON.stringify(state);
  for (const { card, salt } of Object.values(secrets.identities)) {
    expect(shared).not.toContain(card.sid);
    expect(shared).not.toContain(salt);
  }
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

test('shuffle permutes the private order, draw takes the top card, undo restores the previous state', async ({ page }, info) => {
  await openSolo(page, freshProfile(info));
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  const unshuffled = (await hook<SecretStore>(page, 'secrets')).libraryOrder;
  await call(page, 'shuffle');
  const order = (await hook<SecretStore>(page, 'secrets')).libraryOrder;
  expect([...order].sort()).toEqual([...unshuffled].sort());
  expect(order).not.toEqual(unshuffled);

  const before = await hook<TableState>(page, 'state');
  await call(page, 'draw');
  const after = await hook<TableState>(page, 'state');
  expect(after.cards[order[0]!]!.zone).toBe('hand:s0');
  expect(after.cards[order[0]!]!.identity).toBeUndefined();
  expect((await hook<SecretStore>(page, 'secrets')).hand).toEqual([order[0]]);

  expect(await call<boolean>(page, 'undo')).toBe(true);
  const undone = await hook<TableState>(page, 'state');
  expect({ ...undone, seq: 0 }).toEqual({ ...before, seq: 0 });
  expect((await hook<SecretStore>(page, 'secrets')).libraryOrder).toEqual(order);
});

test('a reload restores the solo table to the same state hash and secret store', async ({ page }, info) => {
  const profile = freshProfile(info);
  await openSolo(page, profile);
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  await call(page, 'shuffle');
  await call(page, 'draw', 7);
  const hand = (await hook<SecretStore>(page, 'secrets')).hand;
  await hook(page, 'dispatch', { type: 'move', card: hand[0], to: 'battlefield:s0', pose: { x: 0, y: 120, rot: 0 } });
  await hook(page, 'dispatch', { type: 'tap', card: hand[0], tapped: true });
  await call(page, 'saved');
  const hash = await call<string>(page, 'hash');
  const secrets = await hook<SecretStore>(page, 'secrets');
  expect((await hook<TableState>(page, 'state')).cards[hand[0]!]).toMatchObject({ zone: 'battlefield:s0', tapped: true, face: 'up' });

  await page.reload();
  await waitForSession(page);
  expect(await call<string>(page, 'hash')).toBe(hash);
  expect(await hook<SecretStore>(page, 'secrets')).toEqual(secrets);

  // Another profile is another table.
  const other = await page.context().newPage();
  await openSolo(other, freshProfile(info));
  expect(Object.keys((await hook<TableState>(other, 'state')).cards)).toHaveLength(0);
  await other.close();
});
