import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'next-env.d.ts',
      'data/**',
    ],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['*.config.{ts,mts,mjs,js}', 'scripts/**/*.mjs', 'vitest.config.mts'],
    rules: { 'no-console': 'off' },
  },

  {
    // Operator and verification harnesses: seeding, load generation, and the
    // scripts that drive a RUNNING server over HTTP and assert on what comes
    // back.
    //
    // They parse JSON from a live endpoint, where the shape belongs to the
    // server and not to this codebase, and they narrow it by asserting on it —
    // which is the entire point of the script. `no-explicit-any` there buys
    // nothing: it would be satisfied by an interface written from the same
    // assumption the assertion is testing, which is worse, not better.
    //
    // Scoped to `scripts/` deliberately. Everything under `src/` — every line
    // that ships — keeps the rule at `error`.
    files: ['scripts/**/*.{ts,mts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',

      // `no-console` is OFF for scripts/, and only for scripts/.
      //
      // These are CLI tools whose entire output IS console output: seeding,
      // load generation, and the harnesses that drive a running server and
      // print what came back. `console.log` there is the product, not debris —
      // the rule was reporting 143 warnings for a program working as designed,
      // which trains everyone to ignore the warning count.
      //
      // Categorised before switching it off: all 143 were in scripts/. None in
      // src/, none in API routes, none in tests. Production code keeps the rule
      // at `warn` with only `console.warn`/`console.error` permitted, and an
      // audit confirmed none of those interpolate a credential.
      //
      // Two REAL leaks were fixed rather than silenced on the way here: a live
      // session cookie printed 17 characters past its name prefix, and a fixture
      // password echoed to stdout. Turning the rule off does not make those
      // acceptable — the rule was never what would have caught them.
      'no-console': 'off',
    },
  },

  prettierConfig,
);
