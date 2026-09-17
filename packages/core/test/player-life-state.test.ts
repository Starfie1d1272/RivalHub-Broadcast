import { describe, expect, it } from 'vitest';

import { derivePlayerLifeState } from '../src/projection/index.js';

describe('PlayerLifeState projection primitive', () => {
  it.each([
    [undefined, 'unknown'],
    [null, 'unknown'],
    [100, 'alive'],
    [1, 'alive'],
    [0, 'dead'],
  ] as const)('maps health=%s to %s', (health, expected) => {
    expect(derivePlayerLifeState(health)).toBe(expected);
  });
});
