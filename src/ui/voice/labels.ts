/** Texts of the voice controls (DESIGN "Chat and voice", Talk modes). Implementer: M3-P3. */
import type { TalkIndicatorState, TalkSettings } from '../../voice/types';

/** The talk modes as the voice panel offers them (DESIGN "Chat and voice", Talk modes table). */
export const GATES: readonly { gate: TalkSettings['gate']; label: string; hint: string }[] = [
  { gate: 'ptt', label: 'Push to talk', hint: 'The mic opens while the talk key is held.' },
  { gate: 'turn', label: 'Turn mic', hint: 'The mic opens for the whole of your turn; outside it, push to talk.' },
  { gate: 'open', label: 'Open mic', hint: 'The mic is always open; M mutes it.' },
];

/** Mouse buttons that can be the talk button (MouseEvent.button); left and right stay for the table. */
export const TALK_BUTTONS: readonly { button: number | null; label: string }[] = [
  { button: null, label: 'None' },
  { button: 1, label: 'Middle button' },
  { button: 3, label: 'Back button' },
  { button: 4, label: 'Forward button' },
];

/** The indicator's text for a state. */
export function indicatorLabel(state: TalkIndicatorState, settings: TalkSettings, talkKey: string): string {
  switch (state) {
    case 'noMic':
      return settings.voice ? 'Voice off' : `Hold ${talkKey} to dictate`;
    case 'muted':
      return 'Muted';
    case 'live':
      return 'Live';
    case 'team':
      return 'Team only';
    case 'dictating':
      return 'Dictating';
    case 'idle':
      return settings.gate === 'turn' ? `Turn mic · hold ${talkKey}` : `Hold ${talkKey} to talk`;
  }
}
