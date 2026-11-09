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

/** El autor es siempre un usuario autenticado (usuario_id), nunca un nombre enviado por el cliente. */
async function crear({ usuarioId, restauranteId, comentario }) {
  await query(
    'INSERT INTO comentarios (usuario_id, restaurante_id, comentario) VALUES ($1, $2, $3)',
    [usuarioId, restauranteId, comentario],
  );
}

module.exports = { listarPorRestaurante, crear };
