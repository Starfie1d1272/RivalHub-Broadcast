import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROGRAM_SCHEMA_VERSION } from '../src/version.js';

describe('protocol documentation contract', () => {
  it('keeps protocol version ownership in the code source', () => {
    const protocolDoc = readFileSync(join(process.cwd(), 'docs/protocol.md'), 'utf8');

    expect(PROGRAM_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(protocolDoc).toContain('packages/protocol/src/version.ts');
    expect(protocolDoc).not.toMatch(/programSchemaVersion\s*=\s*\d+/);
    expect(protocolDoc).not.toMatch(/Program schema v\d+/);
    expect(protocolDoc).not.toMatch(/Program v\d+ 与 v\d+/);
  });
});
