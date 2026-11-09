'use strict';
const { query } = require('../db/pool');

/**
 * Menú completo de un restaurante: cartas -> categorías -> ítems, en UNA consulta (el sitio original
 * hacía una consulta por carta y por categoría). Sólo se incluyen registros visibles y no eliminados.
 * Se conserva el orden de MySQL (valores NULL primero) para que el menú se vea igual que antes.
 */
async function menuDeRestaurante(restauranteId) {
  const { rows } = await query(
    `SELECT c.id AS carta_id, c.nombre AS carta_nombre,
            cat.id AS categoria_id, cat.nombre AS categoria_nombre,
            i.id AS item_id, i.nombre AS item_nombre, i.descripcion, i.observaciones, i.tiempo,
            i.puntuacion, i.precio, i.foto
       FROM cartas c
       LEFT JOIN categorias cat ON cat.carta_id = c.id AND cat.visible AND cat.eliminado IS NULL
       LEFT JOIN items i        ON i.categoria_id = cat.id AND i.visible AND i.eliminado IS NULL
      WHERE c.restaurante_id = $1 AND c.visible AND c.eliminada IS NULL
      ORDER BY c.orden NULLS FIRST, c.id, cat.orden NULLS FIRST, cat.id, i.orden NULLS FIRST, i.id`,
    [restauranteId],
  );

  const cartas = [];
  const porCarta = new Map();
  const porCategoria = new Map();
  for (const r of rows) {
    let carta = porCarta.get(r.carta_id);
    if (!carta) {
      carta = { id: r.carta_id, nombre: r.carta_nombre, categorias: [] };
      porCarta.set(r.carta_id, carta);
      cartas.push(carta);
    }
    if (r.categoria_id === null) continue;
    let categoria = porCategoria.get(r.categoria_id);
    if (!categoria) {
      categoria = { id: r.categoria_id, nombre: r.categoria_nombre, items: [] };
      porCategoria.set(r.categoria_id, categoria);
      carta.categorias.push(categoria);
    }
    if (r.item_id === null) continue;
    categoria.items.push({
      id: r.item_id, nombre: r.item_nombre, descripcion: r.descripcion, observaciones: r.observaciones,
      tiempo: r.tiempo, puntuacion: r.puntuacion, precio: r.precio, foto: r.foto,
    });
  }
  return cartas;
}

module.exports = { menuDeRestaurante };
