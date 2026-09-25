import { describe, expect, it } from 'vitest';

import { observerHotkeyLabel } from '../src/program/observer-hotkey';

describe('observer hotkey labels', () => {
  it('maps raw observer slots to the player switching hotkeys', () => {
    expect(Array.from({ length: 10 }, (_, slot) => observerHotkeyLabel(slot))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '0',
    ]);
  });

  it('fails closed for absent or invalid raw observer slots', () => {
    expect(observerHotkeyLabel(null)).toBe('—');
    expect(observerHotkeyLabel(-1)).toBe('—');
    expect(observerHotkeyLabel(10)).toBe('—');
    expect(observerHotkeyLabel(2.5)).toBe('—');
  });
});
