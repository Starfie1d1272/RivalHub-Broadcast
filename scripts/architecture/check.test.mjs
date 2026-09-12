import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { checkArchitecture } from './check.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function withFiles(files) {
  return checkArchitecture({ rootDir: repositoryRoot, files });
}

function expectRule(violations, ruleId, target) {
  expect(violations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId,
        ...(target ? { target: expect.stringContaining(target) } : {}),
      }),
    ]),
  );
}

function packageManifest(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8'));
}

describe('architecture checker', () => {
  it('passes the current zero-debt repository', () => {
    expect(checkArchitecture({ rootDir: repositoryRoot })).toEqual([]);
  });

  it('allows a declared dev-only testkit import and the protocol zod dependency', () => {
    const coreManifest = packageManifest('packages/core/package.json');
    coreManifest.devDependencies = {
      '@rivalhub-broadcast/testkit': 'workspace:*',
    };

    expect(
      withFiles({
        'packages/core/package.json': JSON.stringify(coreManifest),
        'packages/core/test/testkit-fixture.test.ts':
          "import { fixture } from '@rivalhub-broadcast/testkit';\nvoid fixture;\n",
        'packages/protocol/src/zod-fixture.ts': "import { z } from 'zod';\nvoid z;\n",
      }),
    ).toEqual([]);
  });

  it('rejects forbidden runtime manifest dependencies without source imports', () => {
    const cases = [
      {
        manifestPath: 'packages/core/package.json',
        dependencies: { fastify: '5.0.0' },
        ruleId: 'ARCH_CORE_BOUNDARY',
        target: 'fastify',
      },
      {
        manifestPath: 'packages/core/package.json',
        dependencies: { '@rivalhub-broadcast/rivalhub': 'workspace:*' },
        ruleId: 'ARCH_CORE_BOUNDARY',
        target: '@rivalhub-broadcast/rivalhub',
      },
      {
        manifestPath: 'packages/core/package.json',
        dependencies: { '@rivalhub-broadcast/web': 'workspace:*' },
        ruleId: 'ARCH_CORE_BOUNDARY',
        target: '@rivalhub-broadcast/web',
      },
      {
        manifestPath: 'packages/core/package.json',
        dependencies: { '@rivalhub-broadcast/companion': 'workspace:*' },
        ruleId: 'ARCH_CORE_BOUNDARY',
        target: '@rivalhub-broadcast/companion',
      },
      {
        manifestPath: 'packages/protocol/package.json',
        dependencies: { '@rivalhub-broadcast/core': 'workspace:*' },
        ruleId: 'ARCH_PROTOCOL_BOUNDARY',
        target: '@rivalhub-broadcast/core',
      },
      {
        manifestPath: 'packages/radar/package.json',
        dependencies: { react: '19.0.0' },
        ruleId: 'ARCH_RADAR_BOUNDARY',
        target: 'react',
      },
      {
        manifestPath: 'apps/web/package.json',
        dependencies: { '@rivalhub-broadcast/telemetry-gsi': 'workspace:*' },
        ruleId: 'ARCH_WEB_BOUNDARY',
        target: '@rivalhub-broadcast/telemetry-gsi',
      },
      {
        manifestPath: 'packages/rivalhub/package.json',
        dependencies: { '@supabase/supabase-js': '2.0.0' },
        ruleId: 'ARCH_RIVALHUB_BOUNDARY',
        target: '@supabase/supabase-js',
      },
    ];

    for (const testCase of cases) {
      const manifest = packageManifest(testCase.manifestPath);
      manifest.dependencies = { ...manifest.dependencies, ...testCase.dependencies };
      expectRule(
        withFiles({ [testCase.manifestPath]: JSON.stringify(manifest) }),
        testCase.ruleId,
        testCase.target,
      );
    }

    const devOnlyManifest = packageManifest('packages/core/package.json');
    devOnlyManifest.devDependencies = {
      fastify: '5.0.0',
      '@rivalhub-broadcast/web': 'workspace:*',
    };
    expect(withFiles({ 'packages/core/package.json': JSON.stringify(devOnlyManifest) })).toEqual(
      [],
    );
  });

  it('checks static, export, dynamic, require, and type-only edges', () => {
    const violations = withFiles({
      'packages/core/src/import-edge-fixture.ts': [
        "import 'fastify';",
        "export * from 'react';",
        "import type { ViteConfig } from 'vite';",
        "export async function load() { await import('ws'); return require('node:fs'); }",
        'void (undefined as unknown as ViteConfig);',
      ].join('\n'),
    });

    expect(
      violations.filter((violation) => violation.ruleId === 'ARCH_CORE_BOUNDARY'),
    ).toHaveLength(5);
  });

  it('enforces high-confidence package boundaries', () => {
    expectRule(
      withFiles({ 'packages/core/src/boundary.ts': "import 'fastify';\n" }),
      'ARCH_CORE_BOUNDARY',
      'fastify',
    );
    expectRule(
      withFiles({ 'packages/core/src/boundary.ts': "import 'node:fs';\n" }),
      'ARCH_CORE_BOUNDARY',
      'node:fs',
    );
    expectRule(
      withFiles({
        'packages/protocol/src/boundary.ts':
          "import type { RuntimeState } from '@rivalhub-broadcast/core';\n",
      }),
      'ARCH_PROTOCOL_BOUNDARY',
      '@rivalhub-broadcast/core',
    );
    expectRule(
      withFiles({ 'packages/radar/src/boundary.ts': "import React from 'react';\nvoid React;\n" }),
      'ARCH_RADAR_BOUNDARY',
      'react',
    );
    expectRule(
      withFiles({
        'apps/web/src/boundary.ts':
          "import { parse } from '@rivalhub-broadcast/telemetry-gsi';\nvoid parse;\n",
      }),
      'ARCH_WEB_BOUNDARY',
      '@rivalhub-broadcast/telemetry-gsi',
    );
    expectRule(
      withFiles({
        'packages/rivalhub/src/boundary.ts':
          "import { createClient } from '@supabase/supabase-js';\nvoid createClient;\n",
      }),
      'ARCH_RIVALHUB_BOUNDARY',
      '@supabase/supabase-js',
    );
  });

  it('rejects Core imports of Web and Companion even with legal workspace declarations', () => {
    const coreManifest = packageManifest('packages/core/package.json');
    coreManifest.dependencies = {
      '@rivalhub-broadcast/web': 'workspace:*',
      '@rivalhub-broadcast/companion': 'workspace:*',
    };

    const violations = withFiles({
      'packages/core/package.json': JSON.stringify(coreManifest),
      'packages/core/src/web-edge.ts': "import '@rivalhub-broadcast/web';\n",
      'packages/core/src/companion-edge.ts': "import '@rivalhub-broadcast/companion';\n",
    });

    expectRule(violations, 'ARCH_CORE_BOUNDARY', '@rivalhub-broadcast/web');
    expectRule(violations, 'ARCH_CORE_BOUNDARY', '@rivalhub-broadcast/companion');
  });

  it('rejects direct package-source imports and normalizes Windows separators', () => {
    const coreManifest = packageManifest('packages/core/package.json');
    coreManifest.exports['./src'] = './dist/index.js';

    expectRule(
      withFiles({
        'packages/core/package.json': JSON.stringify(coreManifest),
        'apps/web/src/deep-import.ts':
          "import { value } from '@rivalhub-broadcast/core/src/index.js';\nvoid value;\n",
      }),
      'ARCH_CROSS_PACKAGE_SOURCE',
      '@rivalhub-broadcast/core/src',
    );

    expectRule(
      withFiles({
        'packages\\core\\src\\windows-fixture.ts':
          "require('../../../packages\\\\radar\\\\src\\\\index.js');\n",
      }),
      'ARCH_CROSS_PACKAGE_SOURCE',
      'packages\\radar\\src',
    );
  });

  it('rejects non-src relative cross-workspace paths and unexported package subpaths', () => {
    expectRule(
      withFiles({
        'apps/web/src/relative-dist-import.ts': "import '../../../packages/core/dist/index.js';\n",
      }),
      'ARCH_CROSS_PACKAGE_SOURCE',
      'packages/core/dist',
    );

    expectRule(
      withFiles({
        'apps/web/src/unexported-subpath.ts': "import '@rivalhub-broadcast/core/dist/index.js';\n",
      }),
      'ARCH_CROSS_PACKAGE_SOURCE',
      '@rivalhub-broadcast/core/dist',
    );
  });

  it('requires declared workspace dependencies and workspace protocol', () => {
    expectRule(
      withFiles({
        'apps/web/src/undeclared.ts':
          "import { value } from '@rivalhub-broadcast/core';\nvoid value;\n",
      }),
      'ARCH_UNDECLARED_WORKSPACE_DEP',
      '@rivalhub-broadcast/core',
    );

    const webManifest = packageManifest('apps/web/package.json');
    webManifest.dependencies = {
      '@rivalhub-broadcast/core': '^1.0.0',
      ...webManifest.dependencies,
    };
    expectRule(
      withFiles({ 'apps/web/package.json': JSON.stringify(webManifest) }),
      'ARCH_WORKSPACE_PROTOCOL',
      '@rivalhub-broadcast/core',
    );
  });

  it('rejects runtime testkit dependencies, cycles, and TypeScript paths', () => {
    const coreManifest = packageManifest('packages/core/package.json');
    coreManifest.dependencies = {
      '@rivalhub-broadcast/testkit': 'workspace:*',
    };
    expectRule(
      withFiles({ 'packages/core/package.json': JSON.stringify(coreManifest) }),
      'ARCH_TESTKIT_RUNTIME',
      '@rivalhub-broadcast/testkit',
    );

    const cycleA = {
      name: '@rivalhub-broadcast/cycle-a',
      private: true,
      type: 'module',
      files: ['dist'],
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      dependencies: { '@rivalhub-broadcast/cycle-b': 'workspace:*' },
    };
    const cycleB = {
      name: '@rivalhub-broadcast/cycle-b',
      private: true,
      type: 'module',
      files: ['dist'],
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      dependencies: { '@rivalhub-broadcast/cycle-a': 'workspace:*' },
    };
    expectRule(
      withFiles({
        'packages/cycle-a/package.json': JSON.stringify(cycleA),
        'packages/cycle-b/package.json': JSON.stringify(cycleB),
        'tsconfig.architecture-fixture.json': JSON.stringify({
          compilerOptions: { paths: { '@fixture/*': ['fixtures/*'] } },
        }),
      }),
      'ARCH_WORKSPACE_CYCLE',
      'cycle-a',
    );
    expectRule(
      withFiles({
        'tsconfig.architecture-fixture.json': JSON.stringify({
          compilerOptions: { paths: { '@fixture/*': ['fixtures/*'] } },
        }),
      }),
      'ARCH_TS_PATH_ALIAS',
      'compilerOptions.paths',
    );
  });

  it('rejects shared package source exports', () => {
    const coreManifest = packageManifest('packages/core/package.json');
    coreManifest.files = ['src'];
    coreManifest.exports = {
      '.': {
        types: './src/index.ts',
        import: './src/index.ts',
      },
    };

    expectRule(
      withFiles({ 'packages/core/package.json': JSON.stringify(coreManifest) }),
      'ARCH_PACKAGE_EXPORTS',
      'exports',
    );
  });
});

describe('architecture ESLint fast feedback', () => {
  it('uses the shared policy for direct forbidden imports', async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const [result] = await eslint.lintText(
      "import { FastifyInstance } from 'fastify';\nvoid FastifyInstance;\n",
      {
        filePath: 'packages/core/src/index.ts',
      },
    );

    expect(result?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'no-restricted-imports',
          message: expect.stringContaining('framework'),
        }),
      ]),
    );

    const [deepImportResult] = await eslint.lintText(
      "import { value } from '../../radar/src/index.js';\nvoid value;\n",
      { filePath: 'packages/core/src/index.ts' },
    );
    expect(deepImportResult?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'no-restricted-imports',
          message: expect.stringContaining('src directory'),
        }),
      ]),
    );
  });
});
