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
    extends: [
      js.configs.recommended,
      // Ideal type-aware harness for an AI-assisted codebase. We run the full
      // strict + stylistic type-checked presets with no dial-backs and no
      // grandfathering: every rule is enforced everywhere. strictTypeChecked
      // catches correctness bugs (any-propagation, floating promises,
      // impossible conditions, bad stringification); stylisticTypeChecked
      // enforces consistent, modern idioms (nullish coalescing, optional
      // chaining, consistent type defs). projectService below supplies the
      // type information these rules require.
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // React Hooks — full recommended-latest ruleset at preset severity,
      // including the React 19 set-state-in-effect and purity rules.
      ...reactHooks.configs['recommended-latest'].rules,

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

      // Async safety — catch the most common AI-generated promise bugs.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksConditionals: true, checksVoidReturn: true },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

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
      // Tests legitimately lean on `any` (mock factories, partial fixtures,
      // casting DOM nodes). The no-unsafe-* family cascades from that `any`,
      // so relax the whole cluster here rather than forcing casts in every
      // test. Production code keeps all of these as errors.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-console': 'off',
    },
  },
]);
