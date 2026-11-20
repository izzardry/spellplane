/** Keyboard movement of a radio group (Segmented, ModeCard groups): the next enabled option. Added by M8-P1. */
export function stepOption<T extends { disabled?: boolean | undefined }>(options: readonly T[], from: number, key: string): number | null {
  const n = options.length;
  if (!n) return null;
  let step: number;
  if (key === 'ArrowRight' || key === 'ArrowDown') step = 1;
  else if (key === 'ArrowLeft' || key === 'ArrowUp') step = -1;
  else if (key === 'Home' || key === 'End') {
    const order = key === 'Home' ? options.map((_, i) => i) : options.map((_, i) => n - 1 - i);
    return order.find((i) => !options[i]?.disabled) ?? null;
  } else return null;
  for (let k = 1; k <= n; k++) {
    const i = (((from + step * k) % n) + n) % n;
    if (!options[i]?.disabled) return i;
  }
  return null;
}
