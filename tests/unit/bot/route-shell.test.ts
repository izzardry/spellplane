/** M8-P6: the computer route's additions to the frame (cue button, plate menu, coach mark, pause while hidden), over a real computer game. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coachDue, cueButton, pauseWhileHidden, plateItems } from '../../../src/ui/computer/shell';
import { FAKE_TIMERS, newGame, until, type Sim } from '../../sim/bot/harness';

vi.mock('../../../src/net/identity', async () => (await import('../../sim/net/fake-identity')).fakeIdentityModule);

let sim: Sim | null = null;
beforeEach(() => vi.useFakeTimers(FAKE_TIMERS));
afterEach(() => {
  sim?.game.handle.dispose();
  sim?.stores.close();
  sim = null;
  vi.useRealTimers();
});

describe('computer route shell', () => {
  it('offers Attack when a human card is marked attacking in any phase, then Damage; life changes; Sparring concedes', async () => {
    sim = await newGame(41);
    const { human, game } = sim;
    // The human puts a creature on the battlefield by hand and marks it attacking during main 1.
    const st = human.getState();
    if (st.turn.active !== 's0') {
      human.dispatch({ type: 'turnPass', to: 's0' });
    }
    game.handle.pause();
    const creature = human.secrets().hand.find((id) => /Creature/.test(human.cardData(human.secrets().identities[id]!.card)?.type_line ?? ''));
    expect(creature).toBeDefined();
    human.dispatch({ type: 'move', card: creature!, to: 'battlefield:s0', pose: { x: 0, y: -300, rot: 0 } });
    await until(() => human.engine.pending().length === 0 && human.getState().cards[creature!]?.identity !== undefined, 10_000, 'the creature');
    expect(cueButton(human, game.handle)).toBeNull();
    expect(coachDue(cueButton(human, game.handle), [])).toBe(false);
    human.dispatch({ type: 'moveTemp', card: creature!, pose: { x: 0, y: -190, rot: 0 }, combat: 'attack', tap: true });
    const attack = cueButton(human, game.handle);
    expect(attack?.label).toBe('Attack');
    expect(coachDue(attack, [])).toBe(true);
    expect(coachDue(attack, ['coachSparring'])).toBe(false);
    game.handle.resume();
    attack!.run();
    await until(() => cueButton(human, game.handle)?.label === 'Damage', 20_000, 'the Damage cue');
    const power = Number(human.cardData(human.getState().cards[creature!]!.identity!)!.power);
    const before = human.getState().seats.s1!.life;
    cueButton(human, game.handle)!.run();
    expect(Object.values(human.getState().cards).some((c) => c.controller === 's1' && c.zone === 'battlefield:s1')).toBe(false);
    await until(() => human.getState().seats.s1!.life === before - power, 20_000, 'the booking');
    expect(cueButton(human, game.handle)).toBeNull();
    const items = plateItems(human, game.handle);
    expect(items.map((i) => i.label)).toEqual(['Pause Sparring', 'Sparring concedes']);
    items[0]!.run();
    expect(plateItems(human, game.handle)[0]!.label).toBe('Resume Sparring');
    plateItems(human, game.handle)[1]!.run();
    await until(() => human.getState().result !== undefined, 10_000, 'the result');
    expect(human.getState().result?.winners).toEqual(['s0']);
    expect(plateItems(human, game.handle).every((i) => i.disabled)).toBe(true);
  }, 60_000);

  it('pauses while the page is hidden and resumes 500 ms after it shows again', () => {
    const calls: string[] = [];
    let phase: 'waiting' | 'paused' = 'waiting';
    const handle = { pause: () => (calls.push('pause'), (phase = 'paused')), resume: () => (calls.push('resume'), (phase = 'waiting')), status: () => ({ phase, text: '' }) };
    let listener: (() => void) | null = null;
    const doc = { hidden: false, addEventListener: (_: string, l: () => void) => (listener = l), removeEventListener: () => (listener = null) };
    const stop = pauseWhileHidden(handle as never, doc as never);
    doc.hidden = true;
    listener!();
    expect(calls).toEqual(['pause']);
    doc.hidden = false;
    listener!();
    vi.advanceTimersByTime(499);
    expect(calls).toEqual(['pause']);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['pause', 'resume']);
    stop();
    expect(listener).toBeNull();
  });
});
