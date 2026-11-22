<!--
  A select of the kit (visual.md 2.5 A5, 2.8; mock.html board 5's set buttons): a raised `sm` pill (36 px) with the
  chosen label and a chevron, or a pressed well when disabled. It is the browser's own <select> underneath, drawn
  without its native face (`appearance: none`), so the list, the keyboard, a screen reader and a phone's picker all
  behave as the platform's, and `value`, `change` and Playwright's selectOption keep working. The options are the
  children (<option>, <optgroup>). Every other attribute (`data-testid`, `aria-label`, `disabled`, `value`, `onchange`
  …) goes to the select. A long label is cut with an ellipsis inside the pill; the pill never grows past its row.
  Added by M8-R3 (gate M8 finding F5).
-->
<script lang="ts">
  import './kit';
  import type { Snippet } from 'svelte';
  import type { HTMLSelectAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';

  let { size = 'sm', children, class: extra = '', ...rest }: Omit<HTMLSelectAttributes, 'size' | 'class'> & { class?: string; size?: 'xs' | 'sm' | 'md'; children?: Snippet } = $props();
</script>

<span class="ds-select ds-select--{size}{extra ? ` ${extra}` : ''}"
  ><select class="ds-select__input" {...rest}>{@render children?.()}</select><span class="ds-select__chevron" aria-hidden="true"><Icon name="chevronDown" size={16} /></span></span
>
