/// <reference types="svelte" />
/// <reference types="vite/client" />

/** True in dev and test builds, false in production. Gates the debug hook. */
declare const __SPELLPLANE_DEBUG__: boolean;
/** True only in the preview build served at /spellplane/preview/ (M7). */
declare const __SPELLPLANE_PREVIEW__: boolean;
