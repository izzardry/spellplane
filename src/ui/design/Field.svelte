<!--
  A field (docs/design/m8/contracts.md Part B; visual.md 2.8): a well, 44 px, a pill (or 12 px corners as a link field,
  `square`), a leading icon; focus shows the focus ring on the well. `onenter` runs on Enter. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { Snippet } from 'svelte';

  let {
    value = $bindable(),
    label,
    placeholder = undefined,
    readonly = false,
    square = false,
    icon = undefined,
    trailing = undefined,
    oninput = undefined,
    onenter = undefined,
    ...rest
  }: {
    value: string;
    label: string;
    placeholder?: string | undefined;
    readonly?: boolean;
    square?: boolean;
    icon?: Snippet | undefined;
    trailing?: Snippet | undefined;
    oninput?: ((value: string) => void) | undefined;
    onenter?: ((value: string) => void) | undefined;
    [attr: string]: unknown;
  } = $props();
</script>

<label class="ds-field" class:ds-field--square={square} {...rest}>
  {#if icon}{@render icon()}{/if}
  <input
    class="ds-field__input"
    aria-label={label}
    {placeholder}
    {readonly}
    bind:value
    oninput={() => oninput?.(value)}
    onkeydown={(e) => {
      if (e.key === 'Enter') onenter?.(value);
    }}
  />
  {#if trailing}{@render trailing()}{/if}
</label>
