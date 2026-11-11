/**
 * Default props for the start page `#/lobby` and the in-table lobby when main.ts hands none (PLAN M1-P5 create table,
 * share link, nickname; M1-P8 may pass its own through AppProps). Production-safe: only the profile's local stores and
 * the room-link helpers. Implementer: M1-P5.
 */
import { openStores, type LocalStores } from '../../store/stores';
import type { StartPageProps } from '../types';
import { newRoom, pageBase, parseRoomLink } from './room';

let stores: Promise<LocalStores> | null = null;
/** The profile's stores, opened once per page (`?profile=` namespaces them, store/profile.ts). */
export function lobbyStores(): Promise<LocalStores> {
  stores ??= openStores();
  return stores;
}

/** Start-page props over `stores`, with links based on the current page. */
export function startProps(s: Pick<LocalStores, 'identity' | 'tables'>, href: () => string = () => location.href): StartPageProps {
  const base = () => pageBase(href());
  return {
    identity: s.identity,
    newRoom: () => newRoom(base()),
    parseLink: (text) => parseRoomLink(base(), text),
    savedTables: async () => (await s.tables.listTables()).filter((t) => t.roomKey !== '').sort((a, b) => b.updatedAt - a.updatedAt),
    open: (link) => {
      location.hash = link.url.slice(link.url.indexOf('#'));
    },
  };
}

/** Start-page props over the profile's stores. */
export async function defaultStartProps(): Promise<StartPageProps> {
  return startProps(await lobbyStores());
}
