module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'plugin:vue/vue3-recommended',
    `plugin:@typescript-eslint/recommended`,
    'airbnb-base',
  ],
  settings: {
    'import/resolver': {
      // Loads tsconfig from root
      typescript: {},
    },
  },
  parser: "vue-eslint-parser",
  parserOptions: {
    ecmaVersion: 'latest',
    parser: '@typescript-eslint/parser',
    sourceType: 'module',
  },
  plugins: [
    'vue',
    '@typescript-eslint',
  ],
  rules: {
    // So we don't have to specify file extensions on this types
    'import/extensions': ['error', 'always', {
      js: 'never',
      mjs: 'never',
      jsx: 'never',
      ts: 'never',
      tsx: 'never',
    }],
    // warn properties with more than 2 members should be multiline.
    'object-curly-newline': ['error', {
      multiline: true,
      minProperties: 2,
    }],
    'object-curly-spacing': ['error', 'always'],
    // Ignore base rule for unused inputs in declarations,
    // allows us to have unused vars in type declarations
    // warn on code length longer than 100 symbols
    'max-len': ['warn', { code: 100 }],
    // enums showing they have already been used
    'no-shadow': 'off',
    // do not enforce arrow body style - useful for longer code
    'arrow-body-style': 'off',
    // allow unused vars as they can be useful for future development
    '@typescript-eslint/no-unused-vars': 0,
    'no-unused-vars': 0,
    '@typescript-eslint/no-duplicate-enum-values': 'warn',
    // allow explicit any
    '@typescript-eslint/no-explicit-any': 'off',
    // allow empty noop functions
    '@typescript-eslint/no-empty-function': 'off',
    // multiline members should be delimted by comma
    '@typescript-eslint/member-delimiter-style': ['error', {
      multiline: {
        delimiter: 'comma', // 'none' or 'semi' or 'comma'
        requireLast: true,
      },
      singleline: {
        delimiter: 'semi', // 'semi' or 'comma'
        requireLast: false,
      },
    }],
    '@typescript-eslint/no-shadow': 'error',
    // Allow non default exports:
    'import/prefer-default-export': 'off',
    // importing from vitest for test dependencies
    'import/no-extraneous-dependencies': ['error', { devDependencies: ['**/*.test.ts', '**/*.test.tsx'] }],
    // Allow one word components
    'vue/multi-word-component-names': 'off',
  },
  // typescript definition for timer IDs
  globals: { NodeJS: true },
};
