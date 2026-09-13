import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
    ...nextVitals,
    ...nextTypescript,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    args: 'none',
                    varsIgnorePattern: '^_',
                    caughtErrors: 'none',
                },
            ],
            // Next 16 enables this rule by default. Existing state initialization
            // patterns will be migrated separately from this security upgrade.
            'react-hooks/set-state-in-effect': 'off',
        },
    },
    {
        files: ['__tests__/**'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-require-imports': 'off',
            'react/display-name': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },
    globalIgnores([
        '.next/**',
        'coverage/**',
        'node_modules/**',
        'playwright-report/**',
        'test-results/**',
    ]),
]);
