'use strict';
const { query } = require('../db/pool');

/** Categoría activa con el restaurante al que pertenece (para autorizar/redirigir en el panel). */
async function obtener(id) {
  const { rows } = await query(
    `SELECT cat.id, cat.nombre, cat.orden, cat.visible, cat.carta_id, c.restaurante_id
       FROM categorias cat
       JOIN cartas c ON c.id = cat.carta_id AND c.eliminada IS NULL
      WHERE cat.id = $1 AND cat.eliminado IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

async function crear(cartaId, v) {
  const { rows } = await query(
    'INSERT INTO categorias (nombre, orden, visible, carta_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [v.nombre, v.orden, v.visible, cartaId],
  );
  return rows[0].id;
}

async function actualizar(id, v) {
  const { rowCount } = await query(
    'UPDATE categorias SET nombre = $2, orden = $3, visible = $4, actualizado = now() WHERE id = $1 AND eliminado IS NULL',
    [id, v.nombre, v.orden, v.visible],
  );
  return rowCount > 0;
}

async function eliminar(id) {
  const { rowCount } = await query('UPDATE categorias SET eliminado = now() WHERE id = $1 AND eliminado IS NULL', [id]);
  return rowCount > 0;
}

module.exports = { obtener, crear, actualizar, eliminar };
