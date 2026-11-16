'use strict';
/**
 * Ejecutor de migraciones SQL: aplica en orden alfabético los archivos de db/migrations/*.sql que aún no
 * se hayan aplicado y los registra en la tabla schema_migrations. Cada archivo corre en una transacción.
 * Un bloqueo asesor evita que dos contenedores migren a la vez.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/db/pool');

const DIRECTORIO = path.join(__dirname, 'migrations');
const BLOQUEO = 727001; // número arbitrario, común a todos los procesos que migran

async function migrar() {
  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [BLOQUEO]);
    await cliente.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      nombre text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await cliente.query('SELECT nombre FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.nombre));
    const archivos = fs.readdirSync(DIRECTORIO).filter((f) => f.endsWith('.sql')).sort();
    let nuevas = 0;
    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) continue;
      // los nombres provienen de readdirSync sobre un directorio fijo del repositorio, no de entrada de usuario
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const sql = fs.readFileSync(path.join(DIRECTORIO, archivo), 'utf8');
      try {
        await cliente.query('BEGIN');
        await cliente.query(sql);
        await cliente.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [archivo]);
        await cliente.query('COMMIT');
        nuevas += 1;
        console.log(`[migrate] aplicada ${archivo}`);
      } catch (err) {
        await cliente.query('ROLLBACK');
        throw new Error(`Falló la migración ${archivo}: ${err.message}`, { cause: err });
      }
    }
    if (nuevas === 0) console.log('[migrate] base de datos al día');
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [BLOQUEO]).catch(() => {});
    cliente.release();
  }
}

module.exports = { migrar };

if (require.main === module) {
  migrar()
    .then(() => pool.end())
    .catch((err) => { console.error(err.message); process.exit(1); });
}
