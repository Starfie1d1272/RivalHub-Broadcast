import { describe, expect, it } from 'vitest';

import { CliUsageError, parseFlags, stripPnpmSeparator } from '../src/cli/args.js';

describe('testkit CLI argument parsing', () => {
  it('accepts pnpm separator and repeated key/value pairs', () => {
    expect(stripPnpmSeparator(['--', '--input', 'raw'])).toEqual(['--input', 'raw']);
    expect(parseFlags(['--input', 'raw', '--output', 'gold'])).toEqual(
      new Map([
        ['input', 'raw'],
        ['output', 'gold'],
      ]),
    );
  });

  it.each([
    ['unexpected positional argument', ['raw']],
    ['missing value', ['--input']],
    ['duplicate flag', ['--input', 'raw', '--input', 'again']],
    ['empty flag', ['--', 'value']],
  ])('%s fails with a usage error', (_label, argv) => {
    expect(() => parseFlags(argv)).toThrow(CliUsageError);
  });
});
