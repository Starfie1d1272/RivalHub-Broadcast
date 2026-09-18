import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import { parseArgs } from './import.mjs';

describe('cs2-assets import arguments', () => {
  it('requires an explicit build id for direct VPK input', () => {
    expect(() => parseArgs(['--vpk', '/tmp/pak01_dir.vpk'])).toThrow(
      '--vpk 模式必须显式提供 --steam-build-id',
    );
  });

  it('accepts VPK input with an explicit build id and CLI path', () => {
    expect(
      parseArgs([
        '--vpk',
        '/tmp/pak01_dir.vpk',
        '--steam-build-id',
        '123456',
        '--cli',
        '/tmp/Source2Viewer-CLI',
      ]),
    ).toEqual({
      vpk: resolve('/tmp/pak01_dir.vpk'),
      steamBuildId: '123456',
      cli: resolve('/tmp/Source2Viewer-CLI'),
    });
  });

  it('accepts the pnpm argument separator', () => {
    expect(parseArgs(['--', '--vpk', '/tmp/pak01_dir.vpk', '--steam-build-id', '123456'])).toEqual({
      vpk: resolve('/tmp/pak01_dir.vpk'),
      steamBuildId: '123456',
    });
  });
});
