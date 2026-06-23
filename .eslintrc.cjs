/* ESLint 8 legacy config (flat config lands with the v9 bump). */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    // Daemon/scripts use console as their primary output channel.
    'no-console': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // The LanceDB row<->Record casts are deliberate and documented.
    '@typescript-eslint/no-explicit-any': 'off',
    // Enforce node: protocol prefix for built-in imports (matches SonarLint S7772).
    'import/enforce-node-protocol-usage': ['error', 'always']
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.config.js', '.eslintrc.cjs'],
  overrides: [
    {
      // POC prototypes superseded by lib/ — don't gate the build on them.
      files: ['poc/**/*.ts'],
      rules: { '@typescript-eslint/no-unused-vars': 'off' }
    }
  ]
};
