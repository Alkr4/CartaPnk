'use strict';
const Restaurante = require('../models/restaurante.model');
const Item = require('../models/item.model');
const { enteroPositivo } = require('../utils/validadores');
const { urlFoto } = require('../utils/fotos');
const { error } = require('../middlewares/auth');

const MAX_ITEMS_CARRITO = 100;

const carritoDe = (req) => {
  if (!Array.isArray(req.session.carrito)) req.session.carrito = [];
  return req.session.carrito;
};

/** GET /api/carrito?restaurante=ID — "Productos agregados para solicitar" + datos del restaurante para el encabezado. */
async function ver(req, res) {
  const id = enteroPositivo(req.query.restaurante) ?? enteroPositivo(req.session.restauranteId);
  const restaurante = id ? await Restaurante.buscarPorId(id) : null;
  if (!restaurante) throw error(404, 'Restaurante no encontrado');
  res.json({
    restaurante: { ...restaurante, foto: undefined, fotoUrl: urlFoto(id, restaurante.foto) },
    items: carritoDe(req),
  });
}

/** POST /api/carrito/items  {itemId} — agrega un ítem visible; el precio y el nombre salen de la base de datos, no del cliente. */
async function agregar(req, res) {
  const itemId = enteroPositivo(req.body?.itemId);
  if (!itemId) throw error(400, 'Ítem inválido');
  const item = await Item.buscarVisiblePorId(itemId);
  if (!item) throw error(404, 'El producto no existe');

  const carrito = carritoDe(req);
  if (carrito.length >= MAX_ITEMS_CARRITO) throw error(409, 'El pedido alcanzó el máximo de productos');
  const posicion = carrito.reduce((m, p) => Math.max(m, p.posicion), 0) + 1;
  carrito.push({ posicion, id: item.id, nombre: item.nombre, precio: item.precio });
  res.status(201).json({ ok: true, cantidad: carrito.length });
}

/** DELETE /api/carrito/items/:posicion */
function quitar(req, res) {
  const posicion = enteroPositivo(req.params.posicion);
  if (!posicion) throw error(400, 'Posición inválida');
  req.session.carrito = carritoDe(req).filter((p) => p.posicion !== posicion);
  res.json({ ok: true, cantidad: req.session.carrito.length });
}

/** DELETE /api/carrito — vacía el pedido (sin cerrar la sesión del usuario). */
function vaciar(req, res) {
  req.session.carrito = [];
  res.json({ ok: true, cantidad: 0 });
}

module.exports = { ver, agregar, quitar, vaciar };
