'use strict';
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');

/** Límite general por IP contra abuso/DoS básico. */
const limiteGlobal = () => rateLimit({
  windowMs: 60_000,
  limit: config.seguridad.limiteGlobalPorMinuto,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/salud',
});

/**
 * Fuerza bruta en el login: máximo N intentos FALLIDOS por IP + correo en la ventana (por defecto 5 en 15 min).
 * Los inicios de sesión correctos no cuentan. Al superar el límite se redirige con un mensaje genérico.
 * (Almacenamiento en memoria: válido para una réplica; con varias réplicas usar un store compartido, p. ej. Redis.)
 */
const limiteLogin = () => rateLimit({
  windowMs: config.seguridad.loginVentanaMs,
  limit: config.seguridad.loginMaxIntentos,
  skipSuccessfulRequests: true,
  // un login fallido también responde con redirección (<400): sólo cuenta como "exitoso" si el controlador lo marca
  requestWasSuccessful: (req, res) => res.locals.loginExitoso === true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').toLowerCase().slice(0, 255)}`,
  handler: (req, res) => {
    req.session.flash = 'Demasiados intentos fallidos. Inténtalo nuevamente en unos minutos.';
    res.set('Retry-After', String(Math.ceil(config.seguridad.loginVentanaMs / 1000)));
    res.redirect(303, volverA(req));
  },
});

/** Destino seguro tras login/logout: sólo rutas internas /restaurantes/:id (evita redirecciones abiertas). */
function volverA(req) {
  const id = /^[1-9]\d{0,9}$/.test(String(req.body?.restaurante ?? '')) ? req.body.restaurante : null;
  return id ? `/restaurantes/${id}` : '/';
}

module.exports = { limiteGlobal, limiteLogin, volverA };
