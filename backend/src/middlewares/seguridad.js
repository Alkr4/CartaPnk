'use strict';
const helmet = require('helmet');
const config = require('../config');

/** Cabeceras de seguridad HTTP (CSP, X-Frame-Options, nosniff, Referrer-Policy, HSTS en producción…). */
function cabecerasSeguridad() {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          // La API sólo devuelve JSON e imágenes: no necesita cargar nada. El CSP de las páginas lo define el frontend (Nginx).
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      hsts: config.seguridad.hsts ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      frameguard: { action: 'deny' },
      xPoweredBy: false,
    }),
    (req, res, next) => {
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      next();
    },
  ];
}

module.exports = { cabecerasSeguridad };
