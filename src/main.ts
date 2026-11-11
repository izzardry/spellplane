import { mount } from 'svelte';
import App from './ui/App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app missing');

/** Module test pages (dev and test builds only): `?harness=scene` or `?harness=ui` mounts that module's harness instead of the app. */
const HARNESSES = {
  scene: () => import('./scene/harness'),
  ui: () => import('./ui/harness'),
} as const;

const harness = __SPELLPLANE_DEBUG__ ? new URLSearchParams(location.search).get('harness') : null;

if (harness && Object.hasOwn(HARNESSES, harness)) {
  void HARNESSES[harness as keyof typeof HARNESSES]().then((m) => m.mount(target));
} else {
  mount(App, { target });
}
