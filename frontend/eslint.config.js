import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'public/vendors/**'] },
  js.configs.recommended,
  security.configs.recommended, // reglas de seguridad (SAST) también para el código del navegador
  {
    files: ['src/**/*.{js,jsx}', 'tests/**/*.{js,jsx}', '*.config.js'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2023,
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // anti-XSS: React escapa todo el texto; se prohíbe la vía para insertar HTML sin escapar y el DOM directo
      'no-restricted-syntax': ['error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Prohibido: inserta HTML sin escapar (XSS).' },
        { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]", message: 'Prohibido: inserta HTML sin escapar (XSS).' },
        { selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|write)$/]", message: 'Prohibido: inserta HTML sin escapar (XSS).' }],
      // las claves de objeto salen de constantes del propio código (campos de formularios, iconos), no del usuario
      'security/detect-object-injection': 'off',
    },
  },
  {
    // las pruebas leen archivos del propio repositorio (HTML, src/, nginx/) para revisarlos
    files: ['tests/**/*.{js,jsx}'],
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  },
];
