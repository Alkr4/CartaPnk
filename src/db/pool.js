'use strict';
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.max,
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
