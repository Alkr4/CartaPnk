'use strict';
const js = require('@eslint/js');
const globals = require('globals');
const security = require('eslint-plugin-security');

module.exports = [
  // librerías de terceros (Bootstrap, jQuery, Owl) y el script jQuery original del sitio no se analizan
  { ignores: ['node_modules/**', 'public/vendors/**', 'public/js/main.js'] },
  js.configs.recommended,
  security.configs.recommended, // reglas de seguridad (SAST) también para el código del navegador
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      ecmaVersion: 2023,
      globals: { ...globals.browser, bootstrap: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // `campo`/`k` salen de objetos y esquemas del propio código, no de texto escrito por el usuario
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 2023, globals: { ...globals.node } },
    rules: { 'security/detect-non-literal-regexp': 'off', 'security/detect-non-literal-fs-filename': 'off', 'security/detect-object-injection': 'off' },
  },
];
