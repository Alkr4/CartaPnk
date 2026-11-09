'use strict';
const { query } = require('../db/pool');

/** Restaurante activo (no eliminado) con su dirección, o null. */
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

module.exports = { buscarPorId, primerActivoId };
