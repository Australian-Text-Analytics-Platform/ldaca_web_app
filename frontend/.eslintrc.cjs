/* ESLint config for LDaCA frontend (Vite + React 19 + TS) */
module.exports = {
  root: true,
  env: { browser: true, es2023: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: [
    'react',
    '@typescript-eslint',
    'react-hooks',
    'testing-library',
    'jest-dom'
  ],
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:testing-library/react',
    'plugin:jest-dom/recommended',
    'prettier'
  ],
  settings: { react: { version: 'detect' } },
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    'react/prop-types': 'off',
    'no-console': ['warn', { allow: ['warn', 'error', 'debug'] }]
  },
  ignorePatterns: ["dist", "build", "node_modules"],
};