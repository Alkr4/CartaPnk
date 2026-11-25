'use strict';
const Usuario = require('../models/usuario.model');
const auditoria = require('../utils/auditoria');

const ROLES_PANEL = ['admin', 'superadmin'];

function error(estado, mensaje) {
  const err = new Error(mensaje);
  err.status = estado;
  err.expose = true;
  return err;
}

/**
 * Autorización del panel (ASVS V8 / V7): exige sesión autenticada y un rol con acceso al panel ("admin" = dueño de
 * restaurantes, "superadmin"). Se comprueba SIEMPRE en el servidor y, en cada petición, contra la base de datos:
 *   - si la cuenta fue desactivada, la sesión deja de servir de inmediato (no espera a que venza);
 *   - si cambió el rol, rige el rol actual, no el que quedó guardado al iniciar sesión.
 * Sin sesión responde 401; con un rol sin acceso, 403.
 */
async function requiereAdmin(req, res, next) {
  try {
    const sesion = req.session?.usuario;
    if (!sesion) return next(error(401, 'Debes iniciar sesión como administrador'));
    const actual = await Usuario.buscarActivoPorId(sesion.id);
    if (!actual) {
      auditoria.registrar('sesion_invalidada', 'denegado', { req, usuario: sesion.id, detalle: 'cuenta inexistente o desactivada' });
      return req.session.destroy(() => next(error(401, 'La sesión ya no es válida')));
    }
    if (!ROLES_PANEL.includes(actual.rol)) {
      auditoria.registrar('acceso_denegado', 'denegado', { req, usuario: actual.id, detalle: `rol ${actual.rol} sin acceso al panel` });
      return next(error(403, 'No tienes permiso para esta acción'));
    }
    req.session.usuario = { id: actual.id, nombre: actual.nombre, rol: actual.rol };
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Acciones reservadas a ciertos roles (p. ej. administrar cuentas: sólo "superadmin"). Va DESPUÉS de requiereAdmin. */
const requiereRol = (...roles) => (req, res, next) => {
  const rol = req.session?.usuario?.rol;
  if (!roles.includes(rol)) {
    auditoria.registrar('acceso_denegado', 'denegado', { req, usuario: req.session?.usuario?.id, detalle: `acción reservada a: ${roles.join(', ')}` });
    return next(error(403, 'Esta acción está reservada a otro rol'));
  }
  return next();
};

/** Las respuestas de la API dependen de la sesión: nunca deben quedar en cachés (navegador, Cloudflare) ni en buscadores. */
function sinCacheNiIndexar(req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}

module.exports = { requiereAdmin, requiereRol, sinCacheNiIndexar, error, ROLES_PANEL };
