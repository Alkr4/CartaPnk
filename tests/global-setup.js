'use strict';
// Prepara la base de datos de pruebas: migraciones + catálogo + usuarios de demostración.
module.exports = async () => {
  process.env.APP_ENV = 'test';
  const { migrar } = require('../db/migrate');
  const { sembrar } = require('../db/seed');
  const { pool } = require('../src/db/pool');
  await migrar();
  await sembrar({ SEED_CATALOGO: 'true', SEED_USUARIOS_DEMO: 'true' });
  await pool.end();
};
