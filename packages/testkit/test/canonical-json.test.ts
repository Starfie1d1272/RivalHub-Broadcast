import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../src/capture/canonical-json.js';

describe('canonical JSON', () => {
  it('sorts keys directly without integer-like object key reordering', () => {
    expect(
      canonicalJson({
        2: 'two',
        10: 'ten',
        nested: { b: 2, a: 1 },
        array: [{ z: true, a: false }],
      }),
    ).toBe('{"10":"ten","2":"two","array":[{"a":false,"z":true}],"nested":{"a":1,"b":2}}');
  });

  it('rejects cyclic and non-finite values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(TypeError);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(TypeError);
  });
});
