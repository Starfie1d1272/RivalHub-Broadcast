import { builtinModules } from 'node:module';

export const WORKSPACE_PACKAGE_PREFIX = '@rivalhub-broadcast/';

export const WORKSPACE_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

export const RUNTIME_DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
];

const nodeBuiltinNames = new Set(builtinModules);

const packageBoundary = ({
  message,
  forbidden = [],
  forbidNodeBuiltins = false,
  forbiddenWorkspacePackages = [],
  forbiddenWorkspacePaths = [],
}) => ({
  message,
  forbidden,
  forbidNodeBuiltins,
  forbiddenWorkspacePackages,
  forbiddenWorkspacePaths,
});

export const PACKAGE_BOUNDARIES = Object.freeze({
  '@rivalhub-broadcast/core': packageBoundary({
    message:
      'Core must remain framework-, transport-, and adapter-neutral; keep HTTP, UI, GSI, RivalHub, and Node-only ownership outside packages/core.',
    forbidden: ['react', 'react-dom', 'fastify', 'ws', 'vite', '@vitejs/', '@supabase/'],
    forbidNodeBuiltins: true,
    forbiddenWorkspacePackages: [
      '@rivalhub-broadcast/telemetry-gsi',
      '@rivalhub-broadcast/rivalhub',
      '@rivalhub-broadcast/testkit',
      '@rivalhub-broadcast/web',
      '@rivalhub-broadcast/companion',
    ],
    forbiddenWorkspacePaths: ['apps/'],
  }),
  '@rivalhub-broadcast/protocol': packageBoundary({
    message:
      'Protocol owns local wire schemas and DTOs; it must not depend on runtime, presentation, adapter, server, storage, or database owners.',
    forbidden: [
      'react',
      'react-dom',
      'fastify',
      'ws',
      'vite',
      '@vitejs/',
      '@supabase/',
      'drizzle-orm',
      'pg',
      'postgres',
      'mysql2',
      'sqlite3',
      'better-sqlite3',
    ],
    forbidNodeBuiltins: true,
    forbiddenWorkspacePackages: [
      '@rivalhub-broadcast/core',
      '@rivalhub-broadcast/telemetry-gsi',
      '@rivalhub-broadcast/rivalhub',
      '@rivalhub-broadcast/radar',
      '@rivalhub-broadcast/testkit',
    ],
  }),
  '@rivalhub-broadcast/radar': packageBoundary({
    message:
      'Radar is a framework-neutral domain package; keep React, DOM, transport, RivalHub, telemetry adapters, and Node-only runtime ownership in their boundaries.',
    forbidden: ['react', 'react-dom', 'fastify', 'ws', 'vite', '@vitejs/', '@supabase/'],
    forbidNodeBuiltins: true,
    forbiddenWorkspacePackages: [
      '@rivalhub-broadcast/telemetry-gsi',
      '@rivalhub-broadcast/rivalhub',
    ],
  }),
  '@rivalhub-broadcast/telemetry-gsi': packageBoundary({
    message:
      'Telemetry GSI must remain a pure, replayable, transport-independent source adapter; keep UI, server, storage, RivalHub, Radar, testkit, and Node-only ownership outside the package.',
    forbidden: [
      'react',
      'react-dom',
      'fastify',
      'ws',
      'vite',
      '@vitejs/',
      '@supabase/',
      'zod',
      'drizzle-orm',
      'pg',
      'postgres',
      'mysql2',
      'sqlite3',
      'better-sqlite3',
    ],
    forbidNodeBuiltins: true,
    forbiddenWorkspacePackages: [
      '@rivalhub-broadcast/protocol',
      '@rivalhub-broadcast/rivalhub',
      '@rivalhub-broadcast/radar',
      '@rivalhub-broadcast/testkit',
      '@rivalhub-broadcast/web',
      '@rivalhub-broadcast/companion',
    ],
  }),
  '@rivalhub-broadcast/web': packageBoundary({
    message:
      'Web consumes normalized projections; it must not own raw telemetry, RivalHub cloud integration, server transport, or Node-only runtime code.',
    forbidden: ['fastify', 'ws', 'vite', '@vitejs/', '@supabase/'],
    forbidNodeBuiltins: true,
    forbiddenWorkspacePackages: [
      '@rivalhub-broadcast/telemetry-gsi',
      '@rivalhub-broadcast/rivalhub',
    ],
  }),
  '@rivalhub-broadcast/rivalhub': packageBoundary({
    message:
      'RivalHub is a public-contract adapter; it must not access Supabase clients or RivalHub repository source directly.',
    forbidden: [
      '@supabase/',
      'drizzle-orm',
      'pg',
      'postgres',
      'mysql2',
      'sqlite3',
      'better-sqlite3',
    ],
    forbiddenWorkspacePaths: ['RivalHub/', 'RivalHub\\'],
  }),
});

export const ARCHITECTURE_SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
]);

export function workspacePackageName(specifier) {
  if (!specifier.startsWith(WORKSPACE_PACKAGE_PREFIX)) return undefined;
  const [scope, name] = specifier.split('/');
  if (!scope || !name) return undefined;
  return `${scope}/${name}`;
}

export function isWorkspacePackageSpecifier(specifier) {
  return Boolean(workspacePackageName(specifier));
}

export function isNodeBuiltin(specifier) {
  const normalized = specifier.replaceAll('\\', '/');
  const withoutProtocol = normalized.startsWith('node:')
    ? normalized.slice('node:'.length)
    : normalized;
  const root = withoutProtocol.split('/')[0];
  return nodeBuiltinNames.has(withoutProtocol) || nodeBuiltinNames.has(root);
}

export function matchesPolicyTarget(policy, specifier) {
  return policy.forbidden.some((target) =>
    target.endsWith('/') ? specifier.startsWith(target) : specifier === target,
  );
}

export function architectureEslintConfigs() {
  const deepSourcePattern = {
    group: [`${WORKSPACE_PACKAGE_PREFIX}*/src/**`],
    message:
      "Cross-package imports must use the package name and its public exports, never another package's src directory.",
  };
  const relativeDeepSourcePattern = {
    regex: '^(?:\\.\\.?/){2,}.+/src(?:/|$)',
    message:
      "Cross-package imports must use the target package name and its public exports, never another package's src directory.",
  };

  return Object.entries(PACKAGE_BOUNDARIES).map(([packageName, policy]) => {
    const paths = policy.forbidden
      .filter((target) => !target.endsWith('/'))
      .map((name) => ({ name, message: policy.message }));
    const patterns = [
      ...policy.forbidden
        .filter((target) => target.endsWith('/'))
        .map((target) => ({ group: [`${target}*`], message: policy.message })),
      deepSourcePattern,
      relativeDeepSourcePattern,
    ];

    if (policy.forbidNodeBuiltins) {
      patterns.push({
        group: [...nodeBuiltinNames].flatMap((name) => [
          name,
          `${name}/*`,
          `node:${name}`,
          `node:${name}/*`,
        ]),
        message: policy.message,
      });
    }

    for (const target of policy.forbiddenWorkspacePackages) {
      paths.push({ name: target, message: policy.message });
    }

    return {
      files: [`${workspacePathForPackage(packageName)}/src/**/*.{ts,tsx,mts,cts,js,jsx}`],
      rules: {
        'no-restricted-imports': ['error', { paths, patterns }],
      },
    };
  });
}

export function workspacePathForPackage(packageName) {
  const shortName = packageName.slice(WORKSPACE_PACKAGE_PREFIX.length);
  return ['web', 'companion'].includes(shortName) ? `apps/${shortName}` : `packages/${shortName}`;
}
