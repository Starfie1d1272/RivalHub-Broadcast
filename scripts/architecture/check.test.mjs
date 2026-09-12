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

  it('rejects direct package-source imports and normalizes Windows separators', () => {
    expectRule(
      withFiles({
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
