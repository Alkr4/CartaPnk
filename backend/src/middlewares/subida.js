'use strict';
const multer = require('multer');
const { detectarImagen } = require('../storage/imagen');

const MAX_IMAGEN_BYTES = 2 * 1024 * 1024; // 2 MB

function error(estado, mensaje) {
  const err = new Error(mensaje);
  err.status = estado;
  err.expose = true;
  return err;
}

// Los archivos se reciben en memoria (límite de 2 MB) y NO se escriben a disco hasta haber verificado su firma.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGEN_BYTES, files: 1, fields: 40, fieldSize: 16 * 1024, parts: 45 },
});

/** Analiza un formulario multipart (campo de archivo único "foto"). Los errores de multer se traducen a respuestas claras. */
function analizarMultipart(req, res, next) {
  upload.single('foto')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(error(413, 'La imagen supera el máximo de 2 MB'));
    return next(error(400, 'Formulario con archivos inválido'));
  });
}

/**
 * Valida la imagen subida (si hay una): tipo real por firma, no por nombre ni Content-Type.
 * Deja el resultado en req.imagen = { buffer, ext, mime } o req.imagen = null si no se subió archivo.
 */
function validarImagen(req, res, next) {
  req.imagen = null;
  if (!req.file || req.file.size === 0) return next();
  const tipo = detectarImagen(req.file.buffer);
  if (!tipo) return next(error(400, 'Formato de imagen no permitido: sólo JPG, PNG o WEBP'));
  req.imagen = { buffer: req.file.buffer, ext: tipo.ext, mime: tipo.mime };
  return next();
}

module.exports = { analizarMultipart, validarImagen, MAX_IMAGEN_BYTES };
