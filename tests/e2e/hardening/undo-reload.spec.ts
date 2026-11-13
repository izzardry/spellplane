/**
 * PLAN M5-P6 undo after a reload in the browser (DESIGN "Turn flow and confirmation", Undo: Ctrl+Z reverts the
 * player's own most recent actions one at a time; undoing a draw puts the card back on top of the library). The undo
 * stack is rebuilt from the saved log (core/undo.ts undoStackFromLog); the networked cases are in
 * tests/sim/net/undo.test.ts. Asserted on state through the debug hook, never on pixels.
 */
import { expect, test } from '@playwright/test';
import type { SecretStore, TableState } from '../../../src/core/types';
import { hook } from '../helpers/app';
import { call, decklist, freshProfile, openSolo, waitForSession } from '../solo/helpers';

test('after a reload, Ctrl+Z takes back the draw, then the tap, one at a time', async ({ page }, info) => {
  await openSolo(page, freshProfile(info));
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  await call(page, 'shuffle');
  await call(page, 'draw', 7);
  const card = (await hook<SecretStore>(page, 'secrets')).hand[0]!;
  await hook(page, 'dispatch', { type: 'move', card, to: 'battlefield:s0', pose: { x: 0, y: 120, rot: 0 } });
  await hook(page, 'dispatch', { type: 'tap', card, tapped: true });
  const top = (await hook<SecretStore>(page, 'secrets')).libraryOrder[0]!;
  await call(page, 'draw');
  await call(page, 'saved');

  await page.reload();
  await waitForSession(page);
  expect((await hook<SecretStore>(page, 'secrets')).hand).toContain(top);
  // The keyboard path: Ctrl+Z (Cmd+Z on a Mac is the same binding in the keymap) over the table.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await hook<SecretStore>(page, 'secrets')).libraryOrder[0]).toBe(top);
  expect((await hook<SecretStore>(page, 'secrets')).hand).not.toContain(top);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await hook<TableState>(page, 'state')).cards[card]!.tapped).toBe(false);
  expect((await hook<TableState>(page, 'state')).cards[card]!.zone).toBe('battlefield:s0');
});
