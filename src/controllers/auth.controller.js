'use strict';
const bcrypt = require('bcryptjs');
const config = require('../config');
const Usuario = require('../models/usuario.model');
const { texto } = require('../utils/validadores');
const { volverA } = require('../middlewares/limitadores');

// Hash de una contraseña inexistente: se compara igualmente cuando el usuario no existe para que el
// tiempo de respuesta no revele si el correo está registrado (enumeración de cuentas).
const HASH_FICTICIO = bcrypt.hashSync('contraseña-ficticia-no-valida', config.seguridad.bcryptRondas);

/** POST /auth/login */
async function login(req, res, next) {
  const email = texto(req.body?.email, 255);
  const password = typeof req.body?.password === 'string' && req.body.password.length <= 1024 ? req.body.password : '';
  const destino = volverA(req);

  const usuario = email ? await Usuario.buscarActivoPorEmail(email) : null;
  const coincide = await bcrypt.compare(password, usuario?.password_hash ?? HASH_FICTICIO);

  if (!usuario || !coincide || !password) {
    req.session.flash = 'Usuario o contraseña incorrectos.';
    return res.redirect(303, destino);
  }

  res.locals.loginExitoso = true; // el limitador de intentos sólo cuenta los fallidos
  const { restauranteId, carrito } = req.session;
  // Se emite un identificador de sesión nuevo al autenticar (previene la fijación de sesión).
  return req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.usuario = { id: usuario.id, nombre: usuario.nombre };
    req.session.restauranteId = restauranteId;
    req.session.carrito = carrito ?? [];
    return req.session.save((errGuardar) => (errGuardar ? next(errGuardar) : res.redirect(303, destino)));
  });
}

/** POST /auth/logout — destruye la sesión y borra la cookie. */
function logout(req, res, next) {
  const destino = volverA(req);
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(config.sesion.nombreCookie, { httpOnly: true, sameSite: 'lax', secure: config.sesion.cookieSecure, path: '/' });
    return res.redirect(303, destino);
  });
}

module.exports = { login, logout };
