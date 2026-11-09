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
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // La hoja de estilos original importa Google Fonts, por eso se permiten sus dos dominios.
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          styleSrcAttr: ["'unsafe-inline'"], // atributos style="" de la plantilla original
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: config.seguridad.hsts ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginEmbedderPolicy: false, // permite cargar las fuentes de Google
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
