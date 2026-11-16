'use strict';
const config = require('../config');

function noEncontrado(req, res, next) {
  const err = new Error('Recurso no encontrado');
  err.status = 404;
  err.expose = true;
  next(err);
}

/**
 * Manejador global de errores (la API sólo responde JSON). Al cliente sólo se le entrega un mensaje genérico (o el mensaje de
 * errores "esperados", con expose=true); el detalle técnico (stack, SQL, rutas) queda únicamente en el log del servidor.
 * Los errores de validación (422) incluyen además `errores`: { campo: mensaje }.
 */
function manejadorErrores(err, req, res, next) {
  const estado = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (estado >= 500) {
    console.error(JSON.stringify({ nivel: 'error', msg: err.message, ruta: req.originalUrl, stack: config.ambiente === 'development' ? err.stack : undefined }));
  }
  if (res.headersSent) return next(err);

  const cuerpo = { error: err.expose ? err.message : 'Ocurrió un problema al procesar la solicitud.' };
  if (err.expose && err.errores) cuerpo.errores = err.errores;
  return res.status(estado).json(cuerpo);
}

module.exports = { noEncontrado, manejadorErrores };
