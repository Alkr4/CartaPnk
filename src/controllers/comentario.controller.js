'use strict';
const Restaurante = require('../models/restaurante.model');
const Comentario = require('../models/comentario.model');
const { enteroPositivo, texto } = require('../utils/validadores');

/** POST /restaurantes/:id/comentarios — sólo usuarios autenticados; el autor es el usuario de la sesión. */
async function crear(req, res) {
  const restauranteId = enteroPositivo(req.params.id);
  const comentario = texto(req.body?.comentario, 1000);
  if (!restauranteId || !comentario) {
    const err = new Error('Comentario inválido (máximo 1000 caracteres)');
    err.status = 400;
    err.expose = true;
    throw err;
  }
  if (!(await Restaurante.buscarPorId(restauranteId))) {
    const err = new Error('Restaurante no encontrado');
    err.status = 404;
    err.expose = true;
    throw err;
  }
  await Comentario.crear({ usuarioId: req.session.usuario.id, restauranteId, comentario });
  res.redirect(303, `/restaurantes/${restauranteId}`);
}

module.exports = { crear };
