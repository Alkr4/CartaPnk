'use strict';
const { query } = require('../db/pool');

/** Ítems destacados de un restaurante (carrusel "Menús Destacados"). */
async function destacados(restauranteId) {
  const { rows } = await query(
    `SELECT i.id, i.nombre, i.descripcion, i.observaciones, i.tiempo, i.puntuacion, i.precio, i.foto
       FROM items i
       JOIN categorias cat ON cat.id = i.categoria_id
       JOIN cartas c       ON c.id = cat.carta_id
      WHERE i.destacado AND i.visible AND i.eliminado IS NULL
        AND c.restaurante_id = $1 AND c.eliminada IS NULL
        AND cat.visible AND cat.eliminado IS NULL
      ORDER BY i.id`,
    [restauranteId],
  );
  return rows;
}

/** Ítem visible y no eliminado (lo que se puede agregar al carrito), o null. */
async function buscarVisiblePorId(id) {
  const { rows } = await query(
    'SELECT id, nombre, precio FROM items WHERE id = $1 AND visible AND eliminado IS NULL',
    [id],
  );
  return rows[0] ?? null;
}

// ------------------------------------------------------------------ administración

/** Ítem activo con su restaurante (para autorizar/redirigir en el panel). */
async function obtenerAdmin(id) {
  const { rows } = await query(
    `SELECT i.id, i.nombre, i.descripcion, i.observaciones, i.tiempo, i.precio, i.puntuacion, i.orden,
            i.visible, i.destacado, i.foto, i.categoria_id, cat.nombre AS categoria_nombre, c.restaurante_id
       FROM items i
       JOIN categorias cat ON cat.id = i.categoria_id AND cat.eliminado IS NULL
       JOIN cartas c       ON c.id = cat.carta_id AND c.eliminada IS NULL
      WHERE i.id = $1 AND i.eliminado IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

async function crear(categoriaId, v) {
  const { rows } = await query(
    `INSERT INTO items (nombre, descripcion, observaciones, tiempo, precio, puntuacion, orden, visible, destacado, categoria_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [v.nombre, v.descripcion, v.observaciones, v.tiempo, v.precio, v.puntuacion, v.orden, v.visible, v.destacado, categoriaId],
  );
  return rows[0].id;
}

async function actualizar(id, v) {
  const { rowCount } = await query(
    `UPDATE items SET nombre = $2, descripcion = $3, observaciones = $4, tiempo = $5, precio = $6,
            puntuacion = $7, orden = $8, visible = $9, destacado = $10, actualizado = now()
      WHERE id = $1 AND eliminado IS NULL`,
    [id, v.nombre, v.descripcion, v.observaciones, v.tiempo, v.precio, v.puntuacion, v.orden, v.visible, v.destacado],
  );
  return rowCount > 0;
}

async function actualizarFoto(id, foto) {
  await query('UPDATE items SET foto = $2, actualizado = now() WHERE id = $1', [id, foto]);
}

async function eliminar(id) {
  const { rowCount } = await query('UPDATE items SET eliminado = now() WHERE id = $1 AND eliminado IS NULL', [id]);
  return rowCount > 0;
}

module.exports = { destacados, buscarVisiblePorId, obtenerAdmin, crear, actualizar, actualizarFoto, eliminar };
