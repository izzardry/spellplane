// The debug hook's registration lives in util/debug.ts so every module can register its part.
// This folder holds the full SpellplaneDebug type (M0 contracts) and app-level assembly (M0-P7).
export * from '../util/debug';
export * from './types';
export * from './session';
export { FixtureCardDataSource, injectedCardData, type InjectedFixtures } from './fixture-cards';
export * from './net';
export * from './draft';
export * from './speech';
export { fixtureSetSource, injectedSets } from './fixture-sets';
