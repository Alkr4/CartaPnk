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
  { nombre: 'Administrador', email: 'admin@gmail.com', password: 'admin01' },
  { nombre: 'Alondra', email: 'alondra@gmail.com', password: 'alondra01' },
];

async function crearUsuario({ nombre, email, password }) {
  const existe = await query('SELECT 1 FROM usuarios WHERE lower(email) = lower($1)', [email]);
  if (existe.rowCount) return false;
  const hash = await bcrypt.hash(password, config.seguridad.bcryptRondas);
  await query('INSERT INTO usuarios (nombre, email, password_hash) VALUES ($1, $2, $3)', [nombre, email, hash]);
  return true;
}

async function sembrarCatalogo() {
  const { rows } = await query('SELECT count(*)::int AS n FROM restaurantes');
  if (rows[0].n > 0) { console.log('[seed] catálogo ya cargado'); return; }
  const sql = fs.readFileSync(path.join(__dirname, 'seeds', 'catalogo.sql'), 'utf8');
  await pool.query(sql);
  console.log('[seed] catálogo cargado');
}

async function sembrar(env = process.env) {
  if (bool(env.SEED_CATALOGO)) await sembrarCatalogo();

  if (bool(env.SEED_USUARIOS_DEMO)) {
    if (config.esProduccion) throw new Error('SEED_USUARIOS_DEMO no está permitido en producción');
    for (const u of USUARIOS_DEMO) {
      if (await crearUsuario(u)) console.log(`[seed] usuario demo creado: ${u.email}`);
    }
  }

  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    if (env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres');
    if (await crearUsuario({ nombre: env.ADMIN_NOMBRE || 'Administrador', email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })) {
      console.log(`[seed] administrador creado: ${env.ADMIN_EMAIL}`);
    }
  }
}

module.exports = { sembrar, USUARIOS_DEMO };

if (require.main === module) {
  sembrar()
    .then(() => pool.end())
    .catch((err) => { console.error(err.message); process.exit(1); });
}
