'use strict';
const { query } = require('../db/pool');

/**
 * Almacén de express-rate-limit respaldado por PostgreSQL (tabla `limite_intentos`).
 * Permite que el límite de intentos de login sea GLOBAL aunque haya varias instancias detrás de un balanceador.
 *
 * El incremento es atómico (INSERT … ON CONFLICT DO UPDATE): dos instancias que cuentan a la vez no se pisan,
 * y la ventana se reinicia sola cuando expira.
 */
class AlmacenLimitePostgres {
  // Las claves viven en la base de datos, no en la memoria del proceso (lo exige express-rate-limit a los almacenes compartidos)
  localKeys = false;

  constructor(prefijo = 'login:') {
    this.prefijo = prefijo;
    this.ventanaMs = 15 * 60 * 1000;
  }

  /** express-rate-limit entrega aquí sus opciones (ventana de tiempo). */
  init(opciones) {
    this.ventanaMs = opciones.windowMs;
  }

  clave(key) {
    return `${this.prefijo}${key}`;
  }

  async increment(key) {
    const { rows } = await query(
      `INSERT INTO limite_intentos (clave, hits, expira)
            VALUES ($1, 1, now() + ($2::bigint * interval '1 millisecond'))
       ON CONFLICT (clave) DO UPDATE SET
            hits   = CASE WHEN limite_intentos.expira <= now() THEN 1 ELSE limite_intentos.hits + 1 END,
            expira = CASE WHEN limite_intentos.expira <= now() THEN now() + ($2::bigint * interval '1 millisecond')
                          ELSE limite_intentos.expira END
       RETURNING hits, expira`,
      [this.clave(key), this.ventanaMs],
    );
    // limpieza ocasional de contadores vencidos (no bloquea la petición)
    if (Math.random() < 0.01) this.limpiar();
    return { totalHits: rows[0].hits, resetTime: rows[0].expira };
  }

  async decrement(key) {
    await query(
      'UPDATE limite_intentos SET hits = GREATEST(hits - 1, 0) WHERE clave = $1 AND expira > now()',
      [this.clave(key)],
    );
  }

  async resetKey(key) {
    await query('DELETE FROM limite_intentos WHERE clave = $1', [this.clave(key)]);
  }

  async resetAll() {
    await query('DELETE FROM limite_intentos WHERE clave LIKE $1', [`${this.prefijo}%`]);
  }

  limpiar() {
    query('DELETE FROM limite_intentos WHERE expira < now()').catch(() => {});
  }
}

module.exports = { AlmacenLimitePostgres };
