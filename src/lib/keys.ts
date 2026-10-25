/**
 * Normalize KeyboardEvent into a "Ctrl+Shift+KeyA" style string.
 * Uses event.code so layout-independent and supports all keys.
 */
export function eventToKeyString(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  // Skip pure modifier keys
  if (
    e.code === 'ControlLeft' ||
    e.code === 'ControlRight' ||
    e.code === 'AltLeft' ||
    e.code === 'AltRight' ||
    e.code === 'ShiftLeft' ||
    e.code === 'ShiftRight' ||
    e.code === 'MetaLeft' ||
    e.code === 'MetaRight'
  ) {
    return '';
  }
  parts.push(e.code);
  return parts.join('+');
}

export function prettify(key: string): string {
  return key
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow/, '↦ ')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('Equal', '=')
    .replace('Minus', '-')
    .replace('Space', '空格')
    .replace('PageUp', 'PgUp')
    .replace('PageDown', 'PgDn');
}

export function prettyBinding(combo: string): string {
  return combo.split('+').map(prettify).join('+');
}
