'use strict';
const { query, transaccion } = require('../db/pool');

/** Restaurante activo (no eliminado) con su dirección, o null. (Sitio público) */
async function buscarPorId(id) {
  const { rows } = await query(
    `SELECT r.id, r.nombre, r.fono, r.email, r.foto, d.calle, d.numero, d.comuna, d.region
       FROM restaurantes r
       JOIN direcciones d ON d.id = r.direccion_id
      WHERE r.id = $1 AND r.eliminado IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

/** Id del primer restaurante activo (para redirigir desde "/"). */
async function primerActivoId() {
  const { rows } = await query('SELECT id FROM restaurantes WHERE eliminado IS NULL ORDER BY id LIMIT 1');
  return rows[0]?.id ?? null;
}

// ------------------------------------------------------------------ administración

/** Listado del panel con totales. */
async function listarAdmin() {
  const { rows } = await query(
    `SELECT r.id, r.nombre, r.fono, r.email, r.foto, d.calle, d.numero, d.comuna,
            (SELECT count(*) FROM cartas c WHERE c.restaurante_id = r.id AND c.eliminada IS NULL)::int AS cartas,
            (SELECT count(*) FROM comentarios x WHERE x.restaurante_id = r.id)::int AS comentarios
       FROM restaurantes r
       JOIN direcciones d ON d.id = r.direccion_id
      WHERE r.eliminado IS NULL
      ORDER BY r.id`,
  );
  return rows;
}

/** Todos los datos editables de un restaurante activo. */
async function obtenerAdmin(id) {
  const { rows } = await query(
    `SELECT r.id, r.rut, r.nombre, r.fono, r.email, r.foto, r.direccion_id,
            d.calle, d.numero, d.comuna, d.region
       FROM restaurantes r
       JOIN direcciones d ON d.id = r.direccion_id
      WHERE r.id = $1 AND r.eliminado IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

/** Crea la dirección y el restaurante en una sola transacción. Devuelve el id nuevo. */
function crear(v) {
  return transaccion(async (c) => {
    const dir = await c.query(
      'INSERT INTO direcciones (calle, numero, comuna, region) VALUES ($1, $2, $3, $4) RETURNING id',
      [v.calle, v.numero, v.comuna, v.region],
    );
    const res = await c.query(
      `INSERT INTO restaurantes (rut, nombre, fono, email, direccion_id)
            VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [v.rut, v.nombre, v.fono, v.email, dir.rows[0].id],
    );
    return res.rows[0].id;
  });
}

function actualizar(id, v) {
  return transaccion(async (c) => {
    const r = await c.query(
      `UPDATE restaurantes SET rut = $2, nombre = $3, fono = $4, email = $5, actualizado = now()
        WHERE id = $1 AND eliminado IS NULL RETURNING direccion_id`,
      [id, v.rut, v.nombre, v.fono, v.email],
    );
    if (r.rowCount === 0) return false;
    await c.query(
      'UPDATE direcciones SET calle = $2, numero = $3, comuna = $4, region = $5, actualizado = now() WHERE id = $1',
      [r.rows[0].direccion_id, v.calle, v.numero, v.comuna, v.region],
    );
    return true;
  });
}

async function actualizarFoto(id, foto) {
  await query('UPDATE restaurantes SET foto = $2, actualizado = now() WHERE id = $1', [id, foto]);
}

/** Borrado lógico: el restaurante deja de verse en el sitio pero sus datos se conservan. */
async function eliminar(id) {
  const { rowCount } = await query('UPDATE restaurantes SET eliminado = now() WHERE id = $1 AND eliminado IS NULL', [id]);
  return rowCount > 0;
}

module.exports = { buscarPorId, primerActivoId, listarAdmin, obtenerAdmin, crear, actualizar, actualizarFoto, eliminar };
