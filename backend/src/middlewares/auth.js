'use strict';

function error(estado, mensaje) {
  const err = new Error(mensaje);
  err.status = estado;
  err.expose = true;
  return err;
}

/**
 * Autorización del panel: exige sesión autenticada Y rol "admin", comprobado siempre en el servidor.
 * Sin sesión responde 401; con otro rol, 403. (La API sólo habla JSON: el frontend decide a qué pantalla llevar al usuario.)
 */
function requiereAdmin(req, res, next) {
  const usuario = req.session?.usuario;
  if (!usuario) return next(error(401, 'Debes iniciar sesión como administrador'));
  if (usuario.rol !== 'admin') return next(error(403, 'No tienes permiso para esta acción'));
  return next();
}

/** Las respuestas de la API dependen de la sesión: nunca deben quedar en cachés (navegador, Cloudflare) ni en buscadores. */
function sinCacheNiIndexar(req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}

module.exports = { requiereAdmin, sinCacheNiIndexar, error };
