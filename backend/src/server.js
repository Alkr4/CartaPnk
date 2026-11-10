'use strict';
const config = require('./config');
const { pool } = require('./db/pool');
const { crearApp } = require('./app');

const app = crearApp();
const servidor = app.listen(config.puerto, () => {
  console.log(JSON.stringify({ nivel: 'info', msg: 'PNK Security escuchando', puerto: config.puerto, ambiente: config.ambiente }));
});

// Cierre ordenado (docker stop envía SIGTERM): deja de aceptar conexiones y cierra el pool de PostgreSQL.
function cerrar(senal) {
  console.log(JSON.stringify({ nivel: 'info', msg: `Recibida ${senal}, cerrando…` }));
  servidor.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => cerrar('SIGTERM'));
process.on('SIGINT', () => cerrar('SIGINT'));
