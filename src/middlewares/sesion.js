'use strict';
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const config = require('../config');
const { pool } = require('../db/pool');

/**
 * Sesión en servidor guardada en PostgreSQL (tabla `sesiones`).
 * Cookie: HttpOnly, SameSite=Lax y Secure cuando el sitio se sirve por HTTPS (COOKIE_SECURE).
 */
function sesion() {
  return session({
    name: config.sesion.nombreCookie,
    secret: config.sesion.secreto,
    resave: false,
    saveUninitialized: false,
    store: new PgSession({ pool, tableName: 'sesiones', createTableIfMissing: false, pruneSessionInterval: 60 * 15 }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.sesion.cookieSecure,
      maxAge: config.sesion.duracionMs,
    },
  });
}

module.exports = { sesion };
