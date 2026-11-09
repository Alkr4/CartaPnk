'use strict';
const bcrypt = require('bcryptjs');
const config = require('../config');
const Usuario = require('../models/usuario.model');
const { texto } = require('../utils/validadores');

// Hash de una contraseña inexistente: se compara igualmente cuando el usuario no existe para que el
// tiempo de respuesta no revele si el correo está registrado (enumeración de cuentas).
const HASH_FICTICIO = bcrypt.hashSync('contraseña-ficticia-no-valida', config.seguridad.bcryptRondas);

/** GET /admin/login */
function mostrarLogin(req, res) {
  if (req.session.usuario?.rol === 'admin') return res.redirect(303, '/admin');
  return res.render('admin/login', { titulo: 'Administración' });
}

/**
 * POST /admin/login — sólo administradores. Un usuario con otro rol, una contraseña incorrecta o un correo
 * inexistente reciben exactamente la misma respuesta (y consumen el límite de intentos).
 */
async function login(req, res, next) {
  const email = texto(req.body?.email, 255);
  const password = typeof req.body?.password === 'string' && req.body.password.length <= 1024 ? req.body.password : '';

  const usuario = email ? await Usuario.buscarActivoPorEmail(email) : null;
  const coincide = await bcrypt.compare(password, usuario?.password_hash ?? HASH_FICTICIO);

  if (!usuario || !coincide || !password || usuario.rol !== 'admin') {
    req.session.flash = 'Credenciales incorrectas.';
    return res.redirect(303, '/admin/login');
  }

  res.locals.loginExitoso = true; // el limitador de intentos sólo cuenta los fallidos
  const { restauranteId, carrito } = req.session;
  // Se emite un identificador de sesión nuevo al autenticar (previene la fijación de sesión).
  return req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.usuario = { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol };
    req.session.restauranteId = restauranteId;
    req.session.carrito = carrito ?? [];
    req.session.cookie.maxAge = config.sesion.duracionAdminMs; // sesión de administrador más corta
    return req.session.save((errGuardar) => (errGuardar ? next(errGuardar) : res.redirect(303, '/admin')));
  });
}

/** POST /admin/logout — destruye la sesión y borra la cookie. */
function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(config.sesion.nombreCookie, { httpOnly: true, sameSite: 'lax', secure: config.sesion.cookieSecure, path: '/' });
    return res.redirect(303, '/');
  });
}

module.exports = { mostrarLogin, login, logout };
