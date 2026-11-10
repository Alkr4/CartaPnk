'use strict';
const js = require('@eslint/js');
const globals = require('globals');
const security = require('eslint-plugin-security');

module.exports = [
  { ignores: ['node_modules/**', 'reportes/**', 'coverage/**'] },
  js.configs.recommended,
  security.configs.recommended, // reglas de seguridad (SAST): inyección, regex inseguras, acceso dinámico a objetos…
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 2023, globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  { files: ['tests/**/*.js'], languageOptions: { globals: { ...globals.jest } }, rules: { 'security/detect-non-literal-regexp': 'off', 'security/detect-non-literal-fs-filename': 'off' } },
  // herramientas de línea de comandos para desarrolladores: no son alcanzables desde HTTP, sus rutas de archivo vienen de argumentos propios
  { files: ['tools/**/*.js'], rules: { 'security/detect-non-literal-regexp': 'off', 'security/detect-object-injection': 'off', 'security/detect-non-literal-fs-filename': 'off' } },
];
