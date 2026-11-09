'use strict';
const fs = require('node:fs');
const { Pool } = require('pg');
const config = require('../config');

/** TLS hacia PostgreSQL: valida el certificado del servidor contra la CA indicada (Amazon RDS). */
function opcionesSsl() {
  if (!config.db.ssl) return undefined;
  if (!fs.existsSync(config.db.sslCa)) { // eslint-disable-line security/detect-non-literal-fs-filename
    throw new Error(`DB_SSL=true pero no se encuentra el certificado de la CA: ${config.db.sslCa}`);
  }
  // la ruta viene de la configuración del despliegue (variable de entorno), no de entrada de usuario
  return { ca: fs.readFileSync(config.db.sslCa, 'utf8'), rejectUnauthorized: true }; // eslint-disable-line security/detect-non-literal-fs-filename
}

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.max,
  ssl: opcionesSsl(),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Un error en un cliente inactivo no debe tumbar el proceso.
pool.on('error', (err) => {
  console.error(JSON.stringify({ nivel: 'error', msg: 'Error en cliente inactivo de PostgreSQL', detalle: err.message }));
});

/** Consulta parametrizada: los valores viajan separados del SQL ($1, $2…), nunca concatenados. */
const query = (texto, parametros = []) => pool.query(texto, parametros);

module.exports = { pool, query };
