import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser
      }
    }
  },
  {
    // Project-specific guardrails — enforce constitutional layering and money safety.
    files: ['src/lib/adapters/**/*.ts'],
    rules: {
      // Layer 1 (adapters) MUST NOT import from Layer 2 (db) or Layer 3 (app).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/db/*', 'src/lib/db/*'],
              message:
                'Adapters (Layer 1) must not import from db (Layer 2). See constitution Principle VI.'
            },
            {
              group: ['$lib/app/*', 'src/lib/app/*'],
              message:
                'Adapters (Layer 1) must not import from app (Layer 3). See constitution Principle VI.'
            }
          ]
        }
      ]
    }
  },
  {
    // No floating-point literals in money-handling code (constitution Principle II).
    files: ['src/lib/adapters/**/*.ts', 'src/lib/db/**/*.ts', 'src/lib/app/**/*.ts'],
    rules: {
      'no-loss-of-precision': 'error',
      'no-implicit-coercion': 'error'
    }
  },
  {
    ignores: [
      '.svelte-kit/',
      'build/',
      'dist/',
      'node_modules/',
      '.specify/',
      '.claude/',
      'specs/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'reports/',
      '.stryker-tmp/',
      'experiments/',
      'verif-kit/',
      '.verif-kit/',
      '*.pdf',
      // Vitest/esbuild writes-then-deletes a compiled config temp file; if eslint
      // globs the dir while a vitest run is in flight it races and ENOENTs on it.
      '*.timestamp-*.mjs',
      // tests/ivv/ is the verification-engineer's pre-promotion STAGING area (same
      // rationale as .prettierignore). Promoted copies under tests/unit/independent/
      // are linted normally.
      'tests/ivv/'
    ]
  }
);
