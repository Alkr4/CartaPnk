'use strict';
const Restaurante = require('../models/restaurante.model');
const Carta = require('../models/carta.model');
const Item = require('../models/item.model');
const Comentario = require('../models/comentario.model');
const { enteroPositivo } = require('../utils/validadores');

function noEncontrado() {
  const err = new Error('Restaurante no encontrado');
  err.status = 404;
  err.expose = true;
  return err;
}

/** GET / — redirige al primer restaurante activo. */
async function inicio(req, res) {
  const id = await Restaurante.primerActivoId();
  if (!id) throw noEncontrado();
  res.redirect(302, `/restaurantes/${id}`);
}

/** GET /restaurantes/:id — carta digital (destacados, cartas/categorías/ítems y comentarios). */
async function ver(req, res) {
  const id = enteroPositivo(req.params.id);
  if (!id) throw noEncontrado();
  const restaurante = await Restaurante.buscarPorId(id);
  if (!restaurante) throw noEncontrado();

  req.session.restauranteId = id;
  const [destacados, cartas, comentarios] = await Promise.all([
    Item.destacados(id),
    Carta.menuDeRestaurante(id),
    Comentario.listarPorRestaurante(id),
  ]);
  res.render('pages/carta', { titulo: restaurante.nombre, restaurante, destacados, cartas, comentarios });
}

module.exports = { inicio, ver };
