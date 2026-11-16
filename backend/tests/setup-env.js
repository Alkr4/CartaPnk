'use strict';
// Se ejecuta antes de cargar cualquier módulo de la app: fuerza el ambiente de pruebas.
process.env.APP_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
