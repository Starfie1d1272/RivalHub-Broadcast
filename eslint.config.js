import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const typeCheckedConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['**/*.{ts,tsx,mts,cts}'],
}));

export default tseslint.config(
  {
    ignores: ['**/.agent-tmp/**', '**/dist/**', '**/node_modules/**'],
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
);
