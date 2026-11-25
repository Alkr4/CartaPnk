'use strict';
const { query } = require('../db/pool');

/** Usuario activo por correo (sin distinguir mayúsculas), incluyendo su hash y su rol para verificar el acceso. */
async function buscarActivoPorEmail(email) {
  const { rows } = await query(
    'SELECT id, nombre, email, rol, password_hash FROM usuarios WHERE lower(email) = lower($1) AND activo',
    [email],
  );
  return rows[0] ?? null;
}

/** Usuario activo por id (sin el hash): se consulta en cada petición del panel para respetar desactivaciones y cambios de rol. */
async function buscarActivoPorId(id) {
  const { rows } = await query('SELECT id, nombre, email, rol FROM usuarios WHERE id = $1 AND activo', [id]);
  return rows[0] ?? null;
}

// ------------------------------------------------------------------ administración de cuentas (sólo superadmin)

async function listar() {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.rol, u.activo,
            (SELECT count(*) FROM restaurantes r WHERE r.propietario_id = u.id AND r.eliminado IS NULL)::int AS restaurantes
       FROM usuarios u
      WHERE u.rol IN ('admin', 'superadmin')
      ORDER BY u.id`,
  );
  return rows;
}

/** Crea una cuenta de dueño (rol "admin"). Devuelve el id, o null si el correo ya existe. */
async function crearDueno({ nombre, email, passwordHash }) {
  const existe = await query('SELECT 1 FROM usuarios WHERE lower(email) = lower($1)', [email]);
  if (existe.rowCount) return null;
  const { rows } = await query(
    "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, 'admin') RETURNING id",
    [nombre, email, passwordHash],
  );
  return rows[0].id;
}

/** Activa o desactiva una cuenta de dueño. Las cuentas superadmin no se pueden modificar por esta vía. */
async function cambiarEstadoDueno(id, activo) {
  const { rowCount } = await query("UPDATE usuarios SET activo = $2 WHERE id = $1 AND rol = 'admin'", [id, activo]);
  return rowCount > 0;
}

module.exports = { buscarActivoPorEmail, buscarActivoPorId, listar, crearDueno, cambiarEstadoDueno };
