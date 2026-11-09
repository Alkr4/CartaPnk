'use strict';

/** Expone el usuario y el mensaje flash de la sesión a todas las vistas. */
function localsDeVista(req, res, next) {
  res.locals.usuario = req.session?.usuario ?? null;
  res.locals.esAdmin = req.session?.usuario?.rol === 'admin';
  res.locals.flash = req.session?.flash ?? null;
  res.locals.flashTipo = req.session?.flashTipo ?? 'info';
  if (req.session?.flash) { delete req.session.flash; delete req.session.flashTipo; }
  // Foto de un restaurante/ítem: las subidas desde el panel viven en /media/...; las originales, en /imagenes/cod<id>/
  res.locals.urlFoto = (restauranteId, foto) => (String(foto).startsWith('media/') ? `/${foto}` : `/imagenes/cod${restauranteId}/${foto}`);
  next();
}

function error(estado, mensaje) {
  const err = new Error(mensaje);
  err.status = estado;
  err.expose = true;
  return err;
}

/**
 * Autorización del panel: exige sesión autenticada Y rol "admin", comprobado siempre en el servidor.
 * Sin sesión: las páginas redirigen al login de /admin y las demás peticiones responden 401; con otro rol: 403.
 */
function requiereAdmin(req, res, next) {
  const usuario = req.session?.usuario;
  if (!usuario) {
    if (req.method === 'GET' && req.accepts(['html', 'json']) === 'html') return res.redirect(303, '/admin/login');
    return next(error(401, 'Debes iniciar sesión como administrador'));
  }
  if (usuario.rol !== 'admin') return next(error(403, 'No tienes permiso para esta acción'));
  return next();
}

/** El panel nunca debe quedar en cachés ni en buscadores. */
function sinCacheNiIndexar(req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}

module.exports = { localsDeVista, requiereAdmin, sinCacheNiIndexar, error };
