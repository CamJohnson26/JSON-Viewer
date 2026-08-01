import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'Domain code must remain framework-free.',
            },
            {
              name: 'react-dom',
              message: 'Domain code must remain framework-free.',
            },
            {
              name: '@base-ui/react',
              message: 'Domain code must remain framework-free.',
            },
            {
              name: 'xstate',
              message: 'Domain code must remain framework-free.',
            },
            {
              name: '@xstate/react',
              message: 'Domain code must remain framework-free.',
            },
          ],
          patterns: [
            {
              regex:
                '^(?:@/|(?:\\.\\./)+)(?:app|components|infrastructure|interaction|state)/',
              message: 'Domain code cannot depend on outer application layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/infrastructure/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'Infrastructure must remain UI-free.' },
            {
              name: 'react-dom',
              message: 'Infrastructure must remain UI-free.',
            },
            {
              name: '@base-ui/react',
              message: 'Infrastructure must remain UI-free.',
            },
            { name: 'xstate', message: 'Infrastructure must remain UI-free.' },
            {
              name: '@xstate/react',
              message: 'Infrastructure must remain UI-free.',
            },
          ],
          patterns: [
            {
              regex:
                '^(?:@/|(?:\\.\\./)+)(?:app|components|interaction|state)/',
              message: 'Infrastructure can depend only on domain contracts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/state/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(?:@/|(?:\\.\\./)+)(?:app|components|infrastructure|interaction)/',
              message: 'State can depend only on domain contracts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/interaction/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?:@/|(?:\\.\\./)+)(?:app|components)/',
              message: 'Interaction workflows cannot depend on UI layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?:@/|(?:\\.\\./)+)app/',
              message: 'Reusable components cannot depend on app bootstrap.',
            },
          ],
        },
      ],
    },
  },
  prettier,
)
