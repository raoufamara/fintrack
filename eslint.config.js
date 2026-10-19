import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'supabase'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Node-side config files.
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Module boundary (docs/design/TRIPS.md section 2.1): Trips must not depend on
    // the personal-budget code so that it can become a standalone app.
    files: ['src/features/trips/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/services/*'],
              message: 'Trips must not import personal-budget services. Use src/features/trips/services.',
            },
            {
              group: ['@/pages/*'],
              message: 'Trips must not import budget pages.',
            },
            {
              group: ['@/components/dashboard/*', '@/components/transactions/*'],
              message: 'Trips must not import budget components. Shared UI primitives only.',
            },
            {
              group: ['@/lib/constants', '@/types/models'],
              message: 'Trips must not import budget constants or models (e.g. PRESET_CATEGORIES).',
            },
          ],
        },
      ],
    },
  },
)
