import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Serverless functions + shared server libs run on Node (process, Buffer).
    files: ['api/**', 'api-lib/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Tests run under vitest on Node. describe/it/expect are imported from
    // 'vitest' explicitly (house style), so only Node globals are needed.
    files: ['**/*.test.js', '**/*.test.jsx'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Spec C9 — server/client boundary: src/** must not import api/** or
    // api-lib/** (double globstar mandatory: single * does not cross '/').
    files: ['src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/api/**', '**/api-lib/**'] },
      ],
    },
  },
])
