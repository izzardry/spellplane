/**
 * M8-P6: the debug hook's `bot` part (computer.md section 12): null without a computer game; a manual clock chosen
 * before the game opens is handed to its runner, and `tick` runs Sparring's steps that fall due.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { BotRunner } from '../../../src/bot/runner';
import type { BotClock } from '../../../src/bot/types';
import { botDebugClock, botDebugPart, setActiveComputer } from '../../../src/ui/computer/debug';

afterEach(() => {
  setActiveComputer(null);
  botDebugPart().setClock('page');
});

/** A runner double that schedules one step on whatever clock it holds. */
function fakeRunner(): BotRunner & { ran: number; clock: BotClock | null } {
  const r = {
    ran: 0,
    clock: null as BotClock | null,
    status: () => ({ phase: 'waiting' as const, text: 'Sparring is waiting.' }),
    subscribe: () => () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    setPace: () => undefined,
    setClock(c: BotClock) {
      r.clock = c;
      c.setTimeout(() => void r.ran++, 700);
    },
    stepNow: () => Promise.resolve(null),
    view: () => ({}) as never,
    lastStep: () => null,
    steps: () => r.ran,
    dispose: () => undefined,
  };
  return r;
}

describe('the bot part of the debug hook', () => {
  it('answers null without a computer game', async () => {
    const part = botDebugPart();
    expect(part.status()).toBeNull();
    expect(part.active()).toBe(false);
    expect(part.view()).toBeNull();
    expect(part.steps()).toBe(0);
    expect(await part.step()).toBeNull();
  });

  it('hands a manual clock chosen before the game to its runner; tick runs what falls due', () => {
    const part = botDebugPart();
    part.setClock('manual');
    expect(botDebugClock()).not.toBeNull();
    const runner = fakeRunner();
    setActiveComputer({ runner, config: { level: 'steady', pace: 'normal', seed: 's', name: 'Sparring' } });
    expect(runner.clock).toBe(botDebugClock());
    expect(part.active()).toBe(true);
    expect(part.config()?.name).toBe('Sparring');
    part.tick(699);
    expect(part.steps()).toBe(0);
    part.tick(1);
    expect(part.steps()).toBe(1);
    part.setClock('page');
    expect(botDebugClock()).toBeNull();
  });
});
