import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import testingLibrary from 'eslint-plugin-testing-library';

export default tseslint.config([
  { ignores: ['dist', 'build', 'node_modules', 'src/api/generated/**', '**/*.config.js'] },

  // ── Main: TypeScript + React ────────────────────────────────────
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // React Hooks — all recommended-latest rules, then dial back the
      // two new React 19 rules that many legitimate patterns still trigger.
      ...reactHooks.configs['recommended-latest'].rules,
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',

      // The strict preset sets no-unused-vars to 'error' but without
      // ignore patterns. The patterns below are the universally-standard
      // config (used by typescript-eslint itself, Next.js, Remix, etc.):
      //   - `_`-prefixed args/vars for intentionally unused bindings
      //   - rest-siblings for `const { unwanted, ...rest } = obj`
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Code quality
      'no-console': ['error', { allow: ['warn', 'error', 'debug'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'always'],

      // noUncheckedIndexedAccess (tsconfig) is the type-level safety net for
      // array/object indexing — `!` assertions added at logically-guaranteed
      // access sites are intentional and correct.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // React Refresh — warn-only; constant exports are fine (e.g. queryKeys)
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },

  // ── Test files ──────────────────────────────────────────────────
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    plugins: {
      'testing-library': testingLibrary,
    },
    rules: {
      ...testingLibrary.configs['flat/react'].rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
]);
