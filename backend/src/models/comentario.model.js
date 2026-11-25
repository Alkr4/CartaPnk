'use strict';
const { query } = require('../db/pool');

async function listarPorRestaurante(restauranteId) {
  const { rows } = await query(
    `SELECT u.nombre AS usuario, c.comentario
       FROM comentarios c
       JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.restaurante_id = $1
      ORDER BY c.id`,
    [restauranteId],
  );
  return rows;
}

/** Publica un comentario. El texto se guarda tal cual (consulta parametrizada); el frontend lo muestra siempre como texto. */
async function crear({ usuarioId, restauranteId, comentario }) {
  const { rows } = await query(
    "INSERT INTO comentarios (usuario_id, restaurante_id, comentario) VALUES ($1, $2, $3) RETURNING id",
    [usuarioId, restauranteId, comentario],
  );
  return rows[0].id;
}

// ------------------------------------------------------------------ administración (moderación)

async function listarAdmin(restauranteId) {
  const { rows } = await query(
    `SELECT c.id, u.nombre AS usuario, c.comentario, c.creado
       FROM comentarios c
       JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.restaurante_id = $1
      ORDER BY c.id DESC`,
    [restauranteId],
  );
  return rows;
}

async function obtener(id) {
  const { rows } = await query('SELECT id, restaurante_id FROM comentarios WHERE id = $1', [id]);
  return rows[0] ?? null;
}

async function eliminar(id) {
  const { rowCount } = await query('DELETE FROM comentarios WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { listarPorRestaurante, crear, listarAdmin, obtener, eliminar };
