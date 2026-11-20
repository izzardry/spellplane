<!--
  A text field of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): a well, 44 high, a leading icon; `square`
  for a link field. `onenter` runs on Enter. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
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
