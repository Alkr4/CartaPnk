'use strict';
const { pipeline } = require('node:stream');
const express = require('express');
const { almacen } = require('../storage');
const { claveValida } = require('../storage/imagen');

const router = express.Router();

/**
 * GET /media/<carpeta>/<id>/<nombre>.<ext> — sirve las imágenes subidas desde el almacén (disco o S3 privado).
 * Sólo claves con el formato exacto que genera la aplicación; cualquier otra cosa es 404.
 * Los nombres son aleatorios e inmutables, por eso se pueden cachear un año (navegador y Cloudflare).
 */
router.get('/*clave', async (req, res, next) => {
  try {
    const partes = req.params.clave;
    const clave = Array.isArray(partes) ? partes.join('/') : String(partes);
    if (!claveValida(clave)) return next();

    const imagen = await almacen.leer(clave);
    if (!imagen) return next();

    res.set({
      'Content-Type': imagen.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      // aunque alguien lograra subir contenido activo, el navegador no ejecutaría nada de esta respuesta
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
    });
    if (imagen.length !== undefined) res.set('Content-Length', String(imagen.length));
    return pipeline(imagen.stream, res, (err) => { if (err && !res.headersSent) next(err); });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
