/**
 * Fake speech engine (test harness, ?speech=fake). Shaped like the design's SpeechEngine;
 * tests push transcripts with `say(text, final)`, usually through window.__spellplane.
 */
export class FakeSpeechEngine {
  readonly id = 'fake' as const;
  private listener: ((text: string, final: boolean) => void) | null = null;
  lang: string | null = null;

  async available(): Promise<boolean> {
    return true;
  }
  start(lang: string, on: (text: string, final: boolean) => void): void {
    this.lang = lang;
    this.listener = on;
  }
  stop(): void {
    this.listener = null;
  }
  get listening(): boolean {
    return this.listener !== null;
  }
  /** Deliver an interim (final = false) or final transcript, if started. */
  say(text: string, final = true): void {
    this.listener?.(text, final);
  }
}
