'use strict';
const config = require('../config');

function noEncontrado(req, res, next) {
  const err = new Error('Página no encontrada');
  err.status = 404;
  err.expose = true;
  next(err);
}

/**
 * Manejador global de errores. Al cliente sólo se le entrega un mensaje genérico (o el mensaje de errores
 * "esperados", con expose=true); el detalle técnico (stack, SQL, rutas) queda únicamente en el log del servidor.
 */
function manejadorErrores(err, req, res, next) {
  const estado = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (estado >= 500) {
    console.error(JSON.stringify({ nivel: 'error', msg: err.message, ruta: req.originalUrl, stack: config.ambiente === 'development' ? err.stack : undefined }));
  }
  if (res.headersSent) return next(err);

  const mensaje = err.expose ? err.message : 'Ocurrió un problema al procesar la solicitud.';
  if (req.accepts(['html', 'json']) === 'json') return res.status(estado).json({ error: mensaje });
  return res.status(estado).render('pages/error', { titulo: `Error ${estado}`, estado, mensaje, restauranteId: null });
}

module.exports = { noEncontrado, manejadorErrores };
