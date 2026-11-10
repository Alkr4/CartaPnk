'use strict';
const Restaurante = require('../models/restaurante.model');
const Carta = require('../models/carta.model');
const Item = require('../models/item.model');
const Comentario = require('../models/comentario.model');
const { enteroPositivo } = require('../utils/validadores');
const { urlFoto } = require('../utils/fotos');
const { error } = require('../middlewares/auth');

const noEncontrado = () => error(404, 'Restaurante no encontrado');

/** GET /api/restaurantes/primero — id del primer restaurante activo (la página de inicio del frontend muestra ése). */
async function primero(req, res) {
  const id = await Restaurante.primerActivoId();
  if (!id) throw noEncontrado();
  res.json({ id });
}

/** GET /api/restaurantes/:id — todo lo que muestra la carta digital: restaurante, destacados, cartas > categorías > ítems y comentarios. */
async function ver(req, res) {
  const id = enteroPositivo(req.params.id);
  if (!id) throw noEncontrado();
  const restaurante = await Restaurante.buscarPorId(id);
  if (!restaurante) throw noEncontrado();

  req.session.restauranteId = id; // el carrito vuelve a "su" restaurante
  const [destacados, cartas, comentarios] = await Promise.all([
    Item.destacados(id),
    Carta.menuDeRestaurante(id),
    Comentario.listarPorRestaurante(id),
  ]);

  const conFoto = (it) => ({ ...it, foto: undefined, fotoUrl: urlFoto(id, it.foto) });
  res.json({
    restaurante: { ...restaurante, foto: undefined, fotoUrl: urlFoto(id, restaurante.foto) },
    destacados: destacados.map(conFoto),
    cartas: cartas.map((c) => ({ ...c, categorias: c.categorias.map((k) => ({ ...k, items: k.items.map(conFoto) })) })),
    comentarios,
  });
}

module.exports = { primero, ver };
