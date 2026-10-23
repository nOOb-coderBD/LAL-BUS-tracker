import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default ts.config(
  {ignores: ['**/dist/**', '**/node_modules/**', 'test-results/**', 'playwright-report/**']},
  js.configs.recommended,
  ...ts.configs.recommended,
  {languageOptions: {globals: {...globals.node,...globals.browser}},rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}},
  {files:['tests/load/*.js'], languageOptions:{globals:{__ENV:'readonly',__VU:'readonly',__ITER:'readonly'}}}
);
