// ESLint：只開會抓到真的錯誤的規則（沒宣告的變數、沒用到的 import、寫錯的比較…），不管排版
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'tmp/**', 'worker/.wrangler/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      // 刻意留空的 catch（私密瀏覽存不了檔之類）都有註解說明
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      // 題庫與提示文字裡有全形空白、零寬字元的比對
      'no-irregular-whitespace': ['error', { skipStrings: true, skipComments: true, skipRegExps: true, skipTemplates: true }],
      'no-control-regex': 'off',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['worker/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.worker } },
  },
  {
    files: ['scripts/**', 'tests/**', 'e2e/**', '*.config.js', 'worker/test/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
