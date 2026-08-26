// ESLint 9 flat config — follows the official Expo SDK 57 setup:
// `npx expo lint` generates exactly this shape (eslint-config-expo).
// Project-specific additions are marked below.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*'],
  },
  // --- project-specific: architecture guardrails -------------------------
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react-native', 'expo', 'expo-*', '@expo/*'],
              message: 'core/ must stay framework-free (ARCHITECTURE.md §1).',
            },
          ],
          paths: [
            {
              name: 'react',
              importNames: ['default'],
              message: 'core/ must stay framework-free; type-only React imports are allowed.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['app/**/*.tsx', 'src/features/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/data/**', '**/files/**', '**/pdf/adapters/**'],
              message:
                'UI layers must not touch persistence/filesystem/PDF adapters directly — go through services or ports (ARCHITECTURE.md §3).',
            },
          ],
        },
      ],
    },
  },
  // SQL and the SQLite driver stay inside the data layer (ARCHITECTURE.md §3).
  // Only src/data/db may import expo-sqlite; repositories talk to the
  // DatabaseConnection port instead.
  {
    files: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    ignores: ['src/data/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'expo-sqlite',
              message:
                'Only src/data/db may import expo-sqlite. Use the repositories or the DatabaseConnection port (ARCHITECTURE.md §3).',
            },
          ],
        },
      ],
    },
  },
]);
