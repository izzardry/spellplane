/**
 * Per-browser settings (DESIGN "Specification: network protocol and secrecy", Local persistence: theme, keymap
 * overrides, talk mode, speech engine, quality, follow toggles). One record per setting name; missing ones read as
 * DEFAULT_SETTINGS.
 */
import type { IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Settings, type SettingsRecord, type SettingsStore, type SpellplaneDB } from './types';

function isSettingName(name: string): name is keyof Settings {
  return Object.hasOwn(DEFAULT_SETTINGS, name);
}

/** The SettingsStore on an open database (store/types.ts SettingsStore). */
export function createSettingsStore(db: IDBPDatabase<SpellplaneDB>): SettingsStore {
  return {
    async get<K extends keyof Settings>(name: K): Promise<Settings[K]> {
      if (!isSettingName(name)) throw new RangeError(`unknown setting '${String(name)}'`);
      const record = await db.get('settings', name);
      return record ? (record.value as Settings[K]) : structuredClone(DEFAULT_SETTINGS[name]);
    },

    async set<K extends keyof Settings>(name: K, value: Settings[K]): Promise<void> {
      if (!isSettingName(name)) throw new RangeError(`unknown setting '${String(name)}'`);
      if (value === undefined) throw new TypeError(`setting '${name}' needs a value`);
      await db.put('settings', { name, value } as SettingsRecord);
    },

    async all(): Promise<Settings> {
      const result = structuredClone(DEFAULT_SETTINGS);
      const target = result as Record<keyof Settings, unknown>;
      for (const record of await db.getAll('settings')) {
        // Records of settings this version no longer knows are ignored.
        if (isSettingName(record.name)) target[record.name] = record.value;
      }
      return result;
    },
  };
}
