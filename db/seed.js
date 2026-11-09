'use strict';
/**
 * Carga de datos iniciales, controlada por variables de entorno:
 *   SEED_CATALOGO=true       inserta restaurantes, cartas, categorías e ítems (sólo si la tabla está vacía)
 *   SEED_USUARIOS_DEMO=true  crea los usuarios de laboratorio con contraseña hasheada (NUNCA en producción)
 *   ADMIN_EMAIL / ADMIN_PASSWORD  crea un administrador si no existe (≥ 12 caracteres); válido en cualquier ambiente
 */
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { pool, query } = require('../src/db/pool');

const bool = (v) => ['1', 'true', 'si', 'yes'].includes(String(v ?? '').toLowerCase());

const USUARIOS_DEMO = [
  { nombre: 'Administrador', email: 'admin@gmail.com', password: 'admin01', rol: 'admin' },
  { nombre: 'Alondra', email: 'alondra@gmail.com', password: 'alondra01', rol: 'cliente' },
];

async function crearUsuario({ nombre, email, password, rol = 'cliente' }) {
  const existe = await query('SELECT 1 FROM usuarios WHERE lower(email) = lower($1)', [email]);
  if (existe.rowCount) return false;
  const hash = await bcrypt.hash(password, config.seguridad.bcryptRondas);
  await query('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4)', [nombre, email, hash, rol]);
  return true;
}

async function sembrarCatalogo() {
  const { rows } = await query('SELECT count(*)::int AS n FROM restaurantes');
  if (rows[0].n > 0) { console.log('[seed] catálogo ya cargado'); return; }
  const sql = fs.readFileSync(path.join(__dirname, 'seeds', 'catalogo.sql'), 'utf8');
  await pool.query(sql);
  console.log('[seed] catálogo cargado');
}

const BLOQUEO_SEED = 727002; // distinto del de las migraciones

/** Siembra con un bloqueo global: con Auto Scaling varias instancias pueden arrancar a la vez. */
async function sembrar(env = process.env) {
  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [BLOQUEO_SEED]);
    await sembrarConBloqueo(env);
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [BLOQUEO_SEED]).catch(() => {});
    cliente.release();
  }
}

async function sembrarConBloqueo(env) {
  if (bool(env.SEED_CATALOGO)) await sembrarCatalogo();

  if (bool(env.SEED_USUARIOS_DEMO)) {
    if (config.esProduccion) throw new Error('SEED_USUARIOS_DEMO no está permitido en producción');
    for (const u of USUARIOS_DEMO) {
      if (await crearUsuario(u)) console.log(`[seed] usuario demo creado: ${u.email}`);
    }
  }

  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    if (env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres');
    if (await crearUsuario({ nombre: env.ADMIN_NOMBRE || 'Administrador', email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, rol: 'admin' })) {
      console.log(`[seed] administrador creado: ${env.ADMIN_EMAIL}`);
    } else {
      // si el correo ya existía (p. ej. creado antes de existir los roles) se garantiza que sea administrador
      await query("UPDATE usuarios SET rol = 'admin' WHERE lower(email) = lower($1) AND rol <> 'admin'", [env.ADMIN_EMAIL]);
    }
  }
}

module.exports = { sembrar, USUARIOS_DEMO };

if (require.main === module) {
  sembrar()
    .then(() => pool.end())
    .catch((err) => { console.error(err.message); process.exit(1); });
}
