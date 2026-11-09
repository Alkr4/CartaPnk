'use strict';

/** Exige sesión autenticada; si no la hay responde 401 (AJAX) o redirige al inicio (formularios). */
function requiereSesion(req, res, next) {
  if (req.session?.usuario) return next();
  if (req.accepts(['html', 'json']) === 'json') return res.status(401).json({ error: 'Debes iniciar sesión' });
  const err = new Error('Debes iniciar sesión para realizar esta acción');
  err.status = 401;
  err.expose = true;
  return next(err);
}

/** Expone el usuario y el mensaje flash de la sesión a todas las vistas. */
function localsDeVista(req, res, next) {
  res.locals.usuario = req.session?.usuario ?? null;
  res.locals.flash = req.session?.flash ?? null;
  if (req.session?.flash) delete req.session.flash;
  next();
}

module.exports = { requiereSesion, localsDeVista };
