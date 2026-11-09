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

module.exports = { destacados, buscarVisiblePorId };
