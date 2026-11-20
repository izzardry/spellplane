<!--
  A button of the kit (docs/design/m8/contracts.md Part B; visual.md V3, V4, 2.8): `primary` is the one filled button
  of its layer, `secondary` the raised default, `ghost` a ring, `quiet` no surface, `danger` a ring with red text.
  Four heights (xs 28, sm 36, md 44, lg 56). Hover lifts 1 px, press sinks 1 px and the shadow becomes `pressed`
  (transform only is animated). `pressed` keeps it sunk (a toggle that is on); `waiting` is the searching state: pressed
  in, a pulsing ring, the label left and `trailing` (the timer) right. With `href` it renders a link. The seed's `small`
  stays as an alias of `xs`. Rewritten by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { ButtonVariant, Size } from './types';

  let {
    variant = 'secondary',
    size = undefined,
    small = false,
    pressed = undefined,
    waiting = false,
    disabled = false,
    type = 'button',
    href = undefined,
    onclick = undefined,
    icon = undefined,
    trailing = undefined,
    children,
    class: extra = '',
    ...rest
  }: Omit<HTMLButtonAttributes, 'onclick'> & {
    variant?: ButtonVariant;
    size?: Size | undefined;
    /** Seed alias of `size: 'xs'`. */
    small?: boolean;
    pressed?: boolean | undefined;
    waiting?: boolean;
    disabled?: boolean | null | undefined;
    href?: string | undefined;
    onclick?: ((e: MouseEvent) => void) | null | undefined;
    icon?: Snippet | undefined;
    trailing?: Snippet | undefined;
    children?: Snippet;
  } = $props();

  const s = $derived<Size>(size ?? (small ? 'xs' : 'md'));
  const cls = $derived(`ds-btn ds-btn--${variant} ds-btn--${s}${small ? ' ds-btn--small' : ''}${waiting ? ' is-waiting' : ''}${pressed ? ' is-pressed' : ''} ${extra}`.trim());
</script>

{#if href !== undefined && !disabled}
  <a class={cls} {href} aria-current={pressed ? 'page' : undefined} onclick={onclick ?? undefined} {...rest as Record<string, unknown>}
    >{#if waiting}<span class="ds-ring" aria-hidden="true"></span>{/if}{#if icon}{@render icon()}{/if}<span class="ds-btn__label">{@render children?.()}</span>{#if trailing}<span class="ds-btn__trailing">{@render trailing()}</span>{/if}</a
  >
{:else}
  <button
    {type}
    class={cls}
    disabled={disabled || undefined}
    aria-pressed={pressed === undefined ? (waiting ? true : undefined) : pressed}
    aria-busy={waiting || undefined}
    onclick={onclick ?? undefined}
    {...rest}
    >{#if waiting}<span class="ds-ring" aria-hidden="true"></span>{/if}{#if icon}{@render icon()}{/if}<span class="ds-btn__label">{@render children?.()}</span>{#if trailing}<span class="ds-btn__trailing">{@render trailing()}</span>{/if}</button
  >
{/if}
