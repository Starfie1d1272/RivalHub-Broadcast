import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

import { architectureEslintConfigs } from './scripts/architecture/policy.mjs';

const typeCheckedConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['**/*.{ts,tsx,mts,cts}'],
}));

export default tseslint.config(
  {
    ignores: ['**/.agent-tmp/**', '**/.tmp/**', '**/dist/**', '**/node_modules/**'],
  },
  eslint.configs.recommended,
  ...typeCheckedConfigs,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
    },
  },
  {
    files: ['packages/telemetry-gsi/test/**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        project: './packages/telemetry-gsi/tsconfig.test.json',
        projectService: false,
      },
    },
    rules: {
      // The test project imports the package's dist-based Core export before CI builds it.
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  ...architectureEslintConfigs(),
);
