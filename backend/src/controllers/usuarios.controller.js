'use strict';
const bcrypt = require('bcryptjs');
const config = require('../config');
const Usuario = require('../models/usuario.model');
const { validar } = require('../utils/validacionAdmin');
const { enteroPositivo } = require('../utils/validadores');
const auditoria = require('../utils/auditoria');
const { error } = require('../middlewares/auth');

/** Esquema de una cuenta de dueño. Contraseña: 12 a 128 caracteres (ASVS V6.2: largo mínimo sin reglas de composición arbitrarias). */
const ESQUEMA_DUENO = {
  nombre: { tipo: 'texto', etiqueta: 'El nombre', requerido: true, max: 255 },
  email: { tipo: 'email', etiqueta: 'El correo', requerido: true, max: 255 },
  password: { tipo: 'texto', etiqueta: 'La contraseña', requerido: true, max: 128, minimo: 12 },
};

/** GET /api/admin/usuarios — cuentas con acceso al panel (sólo superadmin). */
async function listar(req, res) {
  res.json({ usuarios: await Usuario.listar() });
}

/** POST /api/admin/usuarios {nombre, email, password} — crea una cuenta de dueño (rol "admin"). Sólo superadmin. */
async function crear(req, res) {
  const { valores, errores, valido } = validar(ESQUEMA_DUENO, req.body);
  if (!valido) {
    const err = error(422, 'Hay datos que corregir');
    err.errores = errores;
    throw err;
  }
  // se usa el valor tal cual lo escribió la persona (el validador recorta espacios sólo para medir el largo)
  const passwordHash = await bcrypt.hash(req.body.password, config.seguridad.bcryptRondas);
  const id = await Usuario.crearDueno({ nombre: valores.nombre, email: valores.email, passwordHash });
  if (!id) throw error(409, 'Ya existe una cuenta con ese correo');
  auditoria.registrar('cuenta_creada', 'exito', { req, usuario: valores.email, detalle: `creada por ${req.session.usuario.id}` });
  res.status(201).json({ id });
}

/** PATCH /api/admin/usuarios/:id {activo: true|false} — activa o desactiva una cuenta de dueño. Sólo superadmin. */
async function cambiarEstado(req, res) {
  const id = enteroPositivo(req.params.id);
  if (!id || typeof req.body?.activo !== 'boolean') throw error(400, 'Datos inválidos');
  if (!(await Usuario.cambiarEstadoDueno(id, req.body.activo))) throw error(404, 'No encontrado');
  auditoria.registrar(req.body.activo ? 'cuenta_activada' : 'cuenta_desactivada', 'exito', { req, usuario: id, detalle: `por ${req.session.usuario.id}` });
  res.json({ ok: true });
}

module.exports = { listar, crear, cambiarEstado };
