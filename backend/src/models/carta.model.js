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

// ------------------------------------------------------------------ administración

/**
 * Árbol completo para el panel: incluye lo NO visible (con su estado) y excluye sólo lo eliminado.
 * cartas -> categorías -> ítems.
 */
async function arbolAdmin(restauranteId) {
  const { rows } = await query(
    `SELECT c.id AS carta_id, c.nombre AS carta_nombre, c.orden AS carta_orden, c.visible AS carta_visible,
            cat.id AS categoria_id, cat.nombre AS categoria_nombre, cat.orden AS categoria_orden, cat.visible AS categoria_visible,
            i.id AS item_id, i.nombre AS item_nombre, i.precio, i.puntuacion, i.visible AS item_visible,
            i.destacado, i.foto, i.orden AS item_orden
       FROM cartas c
       LEFT JOIN categorias cat ON cat.carta_id = c.id AND cat.eliminado IS NULL
       LEFT JOIN items i        ON i.categoria_id = cat.id AND i.eliminado IS NULL
      WHERE c.restaurante_id = $1 AND c.eliminada IS NULL
      ORDER BY c.orden NULLS FIRST, c.id, cat.orden NULLS FIRST, cat.id, i.orden NULLS FIRST, i.id`,
    [restauranteId],
  );
  const cartas = [];
  const porCarta = new Map();
  const porCategoria = new Map();
  for (const r of rows) {
    let carta = porCarta.get(r.carta_id);
    if (!carta) {
      carta = { id: r.carta_id, nombre: r.carta_nombre, orden: r.carta_orden, visible: r.carta_visible, categorias: [] };
      porCarta.set(r.carta_id, carta);
      cartas.push(carta);
    }
    if (r.categoria_id === null) continue;
    let categoria = porCategoria.get(r.categoria_id);
    if (!categoria) {
      categoria = { id: r.categoria_id, nombre: r.categoria_nombre, orden: r.categoria_orden, visible: r.categoria_visible, items: [] };
      porCategoria.set(r.categoria_id, categoria);
      carta.categorias.push(categoria);
    }
    if (r.item_id === null) continue;
    categoria.items.push({
      id: r.item_id, nombre: r.item_nombre, precio: r.precio, puntuacion: r.puntuacion, visible: r.item_visible,
      destacado: r.destacado, foto: r.foto, orden: r.item_orden,
    });
  }
  return cartas;
}

async function obtener(id) {
  const { rows } = await query(
    'SELECT id, nombre, orden, visible, restaurante_id FROM cartas WHERE id = $1 AND eliminada IS NULL',
    [id],
  );
  return rows[0] ?? null;
}

async function crear(restauranteId, v) {
  const { rows } = await query(
    'INSERT INTO cartas (nombre, orden, visible, restaurante_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [v.nombre, v.orden, v.visible, restauranteId],
  );
  return rows[0].id;
}

async function actualizar(id, v) {
  const { rowCount } = await query(
    'UPDATE cartas SET nombre = $2, orden = $3, visible = $4, actualizada = now() WHERE id = $1 AND eliminada IS NULL',
    [id, v.nombre, v.orden, v.visible],
  );
  return rowCount > 0;
}

async function eliminar(id) {
  const { rowCount } = await query('UPDATE cartas SET eliminada = now() WHERE id = $1 AND eliminada IS NULL', [id]);
  return rowCount > 0;
}

module.exports = { menuDeRestaurante, arbolAdmin, obtener, crear, actualizar, eliminar };
