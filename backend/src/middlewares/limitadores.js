'use strict';
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');
const { AlmacenLimitePostgres } = require('./almacenLimitePostgres');

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
 * Los inicios de sesión correctos no cuentan. Al superar el límite se responde 429 con un mensaje genérico.
 * El contador vive en PostgreSQL, así que el límite es global aunque haya varias instancias (Auto Scaling).
 */
const limiteLogin = () => rateLimit({
  windowMs: config.seguridad.loginVentanaMs,
  limit: config.seguridad.loginMaxIntentos,
  skipSuccessfulRequests: true,
  store: new AlmacenLimitePostgres('login:'), // contador GLOBAL (varias instancias detrás del balanceador)
  // sólo cuenta como "exitoso" si el controlador lo marca (un login fallido responde 401 y siempre se cuenta)
  requestWasSuccessful: (req, res) => res.locals.loginExitoso === true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').toLowerCase().slice(0, 255)}`,
  handler: (req, res) => {
    res.set('Retry-After', String(Math.ceil(config.seguridad.loginVentanaMs / 1000)));
    res.status(429).json({ error: 'Demasiados intentos fallidos. Inténtalo nuevamente en unos minutos.' });
  },
});

module.exports = { limiteGlobal, limiteLogin };
