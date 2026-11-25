'use strict';
const Restaurante = require('../models/restaurante.model');
const Carta = require('../models/carta.model');
const Categoria = require('../models/categoria.model');
const Item = require('../models/item.model');
const Comentario = require('../models/comentario.model');
const { almacen } = require('../storage');
const { nuevaClave, fotoDeClave, claveDeFoto } = require('../storage/imagen');
const { enteroPositivo } = require('../utils/validadores');
const { validar, ESQUEMAS } = require('../utils/validacionAdmin');
const { urlFoto } = require('../utils/fotos');
const auditoria = require('../utils/auditoria');
const { error } = require('../middlewares/auth');

// ------------------------------------------------------------------ utilidades

/** Id de la URL (entero positivo) o 404: nunca se llega a la base de datos con un valor sospechoso. */
function idDe(valor) {
  const n = enteroPositivo(valor);
  if (!n) throw error(404, 'No encontrado');
  return n;
}
function existe(registro) {
  if (!registro) throw error(404, 'No encontrado');
  return registro;
}

/**
 * Autorización a nivel de objeto (ASVS V8.2.2: IDOR / BOLA). Un dueño ("admin") sólo puede tocar los restaurantes que le
 * pertenecen y todo lo que cuelga de ellos (cartas, categorías, platillos, comentarios); el "superadmin" puede con todos.
 * Se aplica en el controlador que atiende la operación, sobre el recurso REAL (no sobre lo que diga el cliente).
 */
async function permitir(req, restauranteId) {
  const u = req.session.usuario;
  if (u.rol === 'superadmin') return;
  const propietario = await Restaurante.propietarioDe(restauranteId);
  if (propietario === undefined) throw error(404, 'No encontrado');
  if (propietario !== u.id) {
    auditoria.registrar('acceso_denegado', 'denegado', { req, usuario: u.id, detalle: `restaurante ${restauranteId} de otro propietario` });
    throw error(403, 'No tienes acceso a este restaurante');
  }
}

/** Valida el cuerpo contra un esquema (lista blanca). Si hay errores responde 422 con { error, errores: { campo: mensaje } }. */
function datosValidos(esquema, cuerpo) {
  const { valores, errores, valido } = validar(esquema, cuerpo);
  if (!valido) {
    const err = error(422, 'Hay datos que corregir');
    err.errores = errores;
    throw err;
  }
  return valores;
}

/**
 * Aplica la foto del formulario: subir una nueva, reemplazar o quitar (campo quitar_foto = "on").
 * La imagen anterior se borra del almacén (si falla el borrado no se interrumpe: sólo queda un archivo huérfano).
 */
async function aplicarFoto(req, carpeta, id, fotoActual, Modelo) {
  const quitar = req.body?.quitar_foto === 'on';
  if (!req.imagen && !quitar) return;
  let nueva = null;
  if (req.imagen) {
    const clave = nuevaClave(carpeta, id, req.imagen.ext);
    await almacen.guardar(clave, req.imagen.buffer);
    nueva = fotoDeClave(clave);
  }
  await Modelo.actualizarFoto(id, nueva);
  const anterior = claveDeFoto(fotoActual);
  if (anterior) await almacen.borrar(anterior).catch(() => {});
}

/** Si el almacén falla, el registro ya está guardado: se responde con una advertencia en vez de perder lo escrito. */
async function fotoSegura(req, ...args) {
  try {
    await aplicarFoto(req, ...args);
    return undefined;
  } catch (err) {
    console.error(JSON.stringify({ nivel: 'error', msg: 'No se pudo guardar la imagen', detalle: err.message }));
    return 'Los datos se guardaron, pero la imagen no se pudo guardar.';
  }
}

const conFoto = (restauranteId, o) => ({ ...o, foto: undefined, fotoUrl: urlFoto(restauranteId, o.foto) });

// ------------------------------------------------------------------ restaurantes

async function listaRestaurantes(req, res) {
  const u = req.session.usuario;
  const filas = await Restaurante.listarAdmin(u.rol === 'superadmin' ? null : u.id);
  res.json({ restaurantes: filas.map((r) => conFoto(r.id, r)) });
}

async function crearRestaurante(req, res) {
  const id = await Restaurante.crear(datosValidos(ESQUEMAS.restaurante, req.body), req.session.usuario.id);
  const advertencia = await fotoSegura(req, 'restaurantes', id, null, Restaurante);
  res.status(201).json({ id, advertencia });
}

async function detalleRestaurante(req, res) {
  const id = idDe(req.params.id);
  await permitir(req, id);
  const restaurante = existe(await Restaurante.obtenerAdmin(id));
  const [cartas, comentarios] = await Promise.all([Carta.arbolAdmin(id), Comentario.listarAdmin(id)]);
  res.json({
    restaurante: conFoto(id, restaurante),
    cartas: cartas.map((c) => ({ ...c, categorias: c.categorias.map((k) => ({ ...k, items: k.items.map((i) => conFoto(id, i)) })) })),
    comentarios,
  });
}

async function editarRestaurante(req, res) {
  const id = idDe(req.params.id);
  await permitir(req, id);
  const restaurante = existe(await Restaurante.obtenerAdmin(id));
  await Restaurante.actualizar(id, datosValidos(ESQUEMAS.restaurante, req.body));
  const advertencia = await fotoSegura(req, 'restaurantes', id, restaurante.foto, Restaurante);
  res.json({ ok: true, advertencia });
}

async function eliminarRestaurante(req, res) {
  const id = idDe(req.params.id);
  await permitir(req, id);
  existe(await Restaurante.eliminar(id));
  res.json({ ok: true });
}

// ------------------------------------------------------------------ cartas y categorías

async function crearCarta(req, res) {
  const rid = idDe(req.params.rid);
  await permitir(req, rid);
  existe(await Restaurante.obtenerAdmin(rid));
  const id = await Carta.crear(rid, datosValidos(ESQUEMAS.carta, req.body));
  res.status(201).json({ id });
}

async function verCarta(req, res) {
  const c = existe(await Carta.obtener(idDe(req.params.id)));
  await permitir(req, c.restaurante_id);
  res.json({ carta: c });
}

async function editarCarta(req, res) {
  const c = existe(await Carta.obtener(idDe(req.params.id)));
  await permitir(req, c.restaurante_id);
  await Carta.actualizar(c.id, datosValidos(ESQUEMAS.carta, req.body));
  res.json({ ok: true });
}

async function eliminarCarta(req, res) {
  const c = existe(await Carta.obtener(idDe(req.params.id)));
  await permitir(req, c.restaurante_id);
  await Carta.eliminar(c.id);
  res.json({ ok: true });
}

async function crearCategoria(req, res) {
  const c = existe(await Carta.obtener(idDe(req.params.cid)));
  await permitir(req, c.restaurante_id);
  const id = await Categoria.crear(c.id, datosValidos(ESQUEMAS.categoria, req.body));
  res.status(201).json({ id });
}

async function verCategoria(req, res) {
  const c = existe(await Categoria.obtener(idDe(req.params.id)));
  await permitir(req, c.restaurante_id);
  res.json({ categoria: c });
}

async function editarCategoria(req, res) {
  const c = existe(await Categoria.obtener(idDe(req.params.id)));
  await permitir(req, c.restaurante_id);
  await Categoria.actualizar(c.id, datosValidos(ESQUEMAS.categoria, req.body));
  res.json({ ok: true });
}

async function eliminarCategoria(req, res) {
  const c = existe(await Categoria.obtener(idDe(req.params.id)));
  await permitir(req, c.restaurante_id);
  await Categoria.eliminar(c.id);
  res.json({ ok: true });
}

// ------------------------------------------------------------------ ítems (platillos)

async function crearItem(req, res) {
  const c = existe(await Categoria.obtener(idDe(req.params.cid)));
  await permitir(req, c.restaurante_id);
  const id = await Item.crear(c.id, datosValidos(ESQUEMAS.item, req.body));
  const advertencia = await fotoSegura(req, 'items', id, null, Item);
  res.status(201).json({ id, advertencia });
}

async function verItem(req, res) {
  const it = existe(await Item.obtenerAdmin(idDe(req.params.id)));
  await permitir(req, it.restaurante_id);
  res.json({ item: conFoto(it.restaurante_id, it) });
}

async function editarItem(req, res) {
  const it = existe(await Item.obtenerAdmin(idDe(req.params.id)));
  await permitir(req, it.restaurante_id);
  await Item.actualizar(it.id, datosValidos(ESQUEMAS.item, req.body));
  const advertencia = await fotoSegura(req, 'items', it.id, it.foto, Item);
  res.json({ ok: true, advertencia });
}

async function eliminarItem(req, res) {
  const it = existe(await Item.obtenerAdmin(idDe(req.params.id)));
  await permitir(req, it.restaurante_id);
  await Item.eliminar(it.id);
  res.json({ ok: true });
}

// ------------------------------------------------------------------ comentarios (moderación)

async function eliminarComentario(req, res) {
  const c = existe(await Comentario.obtener(idDe(req.params.id)));
  await permitir(req, c.restaurante_id);
  await Comentario.eliminar(c.id);
  res.json({ ok: true });
}

module.exports = {
  listaRestaurantes, crearRestaurante, detalleRestaurante, editarRestaurante, eliminarRestaurante,
  crearCarta, verCarta, editarCarta, eliminarCarta,
  crearCategoria, verCategoria, editarCategoria, eliminarCategoria,
  crearItem, verItem, editarItem, eliminarItem,
  eliminarComentario,
};
