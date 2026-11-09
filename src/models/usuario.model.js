'use strict';
const { query } = require('../db/pool');

/** Usuario activo por correo (sin distinguir mayúsculas), incluyendo su hash para verificar la contraseña. */
async function buscarActivoPorEmail(email) {
  const { rows } = await query(
    'SELECT id, nombre, email, password_hash FROM usuarios WHERE lower(email) = lower($1) AND activo',
    [email],
  );
  return rows[0] ?? null;
}

module.exports = { buscarActivoPorEmail };
