'use strict';
const crypto = require('node:crypto');
const { analizarMultipart } = require('./subida');

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function verificar(req, res, next) {
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

/**
 * Protección CSRF por token de sesión (patrón "synchronizer token"):
 *  - cada sesión tiene un token aleatorio de 32 bytes, disponible para las vistas como `csrfToken`;
 *  - toda petición que cambia estado debe enviarlo en el campo `_csrf` del formulario o en la cabecera X-CSRF-Token;
 *  - se compara en tiempo constante.
 * Los formularios con archivos (multipart) se analizan aquí mismo, con los mismos límites para TODAS las rutas, para poder
 * leer el campo `_csrf` ANTES de que ninguna ruta procese la petición (así no existe ninguna ruta multipart sin protección).
 */
function csrf(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;

  if (METODOS_SEGUROS.has(req.method)) return next();
  if (req.is('multipart/form-data')) {
    return analizarMultipart(req, res, (err) => (err ? next(err) : verificar(req, res, next)));
  }
  return verificar(req, res, next);
}

module.exports = { csrf };
