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
      // Type-aware strict harness. strictTypeChecked catches the bug classes
      // that AI-generated code most often introduces: `any` propagation
      // (no-unsafe-*), floating/misused promises, unsafe member access, and
      // bad stringification (no-base-to-string). These are correctness rules,
      // not cosmetics — we deliberately skip stylisticTypeChecked so the gate
      // stays focused on bugs. projectService below provides the type info
      // these rules require. Existing violations are grandfathered in
      // eslint-suppressions.json; new code must satisfy every rule.
      ...tseslint.configs.strictTypeChecked,
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

      // Async safety — catch the most common AI-generated promise bugs.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksConditionals: true, checksVoidReturn: true },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

      // ── strictTypeChecked tuning ──────────────────────────────────
      // These type-aware rules are kept, but their high-noise members are
      // configured for this codebase so the gate stays signal, not churn.

      // Template literals legitimately interpolate numbers/booleans/nullish
      // (ids, counts, flags). Allow those primitives; still flag objects,
      // which is the real `[object Object]` bug class.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: true,
          allowRegExp: true,
          allowArray: true,
        },
      ],

      // `<div onClick={() => doThing()}>` is idiomatic React; the void-return
      // arrow shorthand is not confusing here.
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true },
      ],

      // Off: with `noUncheckedIndexedAccess` + intentional defensive guards
      // (checking values the types claim are always present, e.g. at API and
      // worker boundaries), this rule fires overwhelmingly on safe code. The
      // TS compiler already covers the genuinely-impossible cases.
      '@typescript-eslint/no-unnecessary-condition': 'off',

      // noUncheckedIndexedAccess (tsconfig) covers array/object indexing safety.
      // Non-null assertions are allowed at logically-guaranteed access sites.
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
