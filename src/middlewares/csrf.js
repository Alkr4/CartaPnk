'use strict';
const crypto = require('node:crypto');

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protección CSRF por token de sesión (patrón "synchronizer token"):
 *  - cada sesión tiene un token aleatorio de 32 bytes, disponible para las vistas como `csrfToken`;
 *  - toda petición que cambia estado debe enviarlo en el campo `_csrf` del formulario o en la cabecera X-CSRF-Token;
 *  - se compara en tiempo constante.
 */
function csrf(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;

  if (METODOS_SEGUROS.has(req.method)) return next();

  const enviado = req.get('x-csrf-token') || req.body?._csrf;
  const esperado = Buffer.from(req.session.csrfToken);
  if (typeof enviado === 'string' && enviado.length === esperado.length
      && crypto.timingSafeEqual(Buffer.from(enviado), esperado)) {
    return next();
  }
  const err = new Error('Token CSRF inválido o ausente');
  err.status = 403;
  err.expose = true;
  return next(err);
}

module.exports = { csrf };
