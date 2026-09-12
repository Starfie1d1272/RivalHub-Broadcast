import { describe, expect, it } from 'vitest';

import { isValidPrTitle } from './validate-pr-title.mjs';

describe('PR title validator', () => {
  it.each(['feat: add runtime shell', 'fix(web): correct route', 'ci: establish baseline'])(
    'accepts %s',
    (title) => {
      expect(isValidPrTitle(title)).toBe(true);
    },
  );

  it.each(['Add runtime shell', 'feature: something', 'feat:', 'feat (): bad'])(
    'rejects %s',
    (title) => {
      expect(isValidPrTitle(title)).toBe(false);
    },
  );

  it('rejects non-string values', () => {
    expect(isValidPrTitle(undefined)).toBe(false);
    expect(isValidPrTitle(null)).toBe(false);
  });
});
