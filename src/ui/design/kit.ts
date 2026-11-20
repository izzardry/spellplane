/**
 * The kit's side effects in one place (docs/design/m8/visual.md 2.6, 2.8): the stylesheet of every recipe
 * (`base.css`) and the bundled face (`fonts.ts`). Every kit component imports this module, so a screen that uses the
 * kit gets its look without wiring anything else; the look's `--ds-*` variables come from `css.ts` (`lookCssVars` /
 * `applyLook`). Added by M8-P1.
 */
import './base.css';
import { installFonts } from './fonts';

installFonts();
