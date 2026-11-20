<!--
  A field (docs/design/m8/contracts.md Part B; visual.md 2.8): a well, 44 px, a pill (or 12 px corners as a link field,
  `square`), a leading icon; focus shows the focus ring on the well. `onenter` runs on Enter. Added by M8-P1. Every other
  attribute (`data-testid`, `disabled`, `maxlength`, `autocomplete`, `aria-invalid`, `onblur`, …) goes to the input, as
  M8-C's seed did and every call site expects: a disabled search is a disabled input, a blur is the input's.
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

<label class="ds-field" class:ds-field--square={square}>
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
    {...rest}
  />
  {#if trailing}{@render trailing()}{/if}
</label>
