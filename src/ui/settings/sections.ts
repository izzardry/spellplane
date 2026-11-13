/**
 * The settings panel's sections (PLAN M5-P5 settings consolidation: theme, quality, follow, sound, talk mode and
 * devices, speech engine, keymap, card back, storage; the About panel).
 */
export type SettingsSection = 'display' | 'voice' | 'dictation' | 'keys' | 'cardBack' | 'storage' | 'about';

export const SETTINGS_SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: 'display', label: 'Display and sound' },
  { id: 'voice', label: 'Voice' },
  { id: 'dictation', label: 'Dictation' },
  { id: 'keys', label: 'Keys' },
  { id: 'cardBack', label: 'Card back' },
  { id: 'storage', label: 'Storage' },
  { id: 'about', label: 'About' },
];

export function settingsSectionOf(v: unknown): SettingsSection {
  return SETTINGS_SECTIONS.some((s) => s.id === v) ? (v as SettingsSection) : 'display';
}
