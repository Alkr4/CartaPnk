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
function avisar(req, mensaje, tipo = 'success') {
  req.session.flash = mensaje;
  req.session.flashTipo = tipo;
}

/**
 * Aplica la foto del formulario: subir una nueva, reemplazar o quitar (casilla quitar_foto).
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

/** Foto tras crear: si el almacén falla, la entidad queda creada y se avisa (en vez de perder lo escrito). */
async function fotoNuevaSegura(req, ...args) {
  try {
    await aplicarFoto(req, ...args);
    return true;
  } catch (err) {
    req.log?.error?.({ err }, 'No se pudo guardar la imagen');
    return false;
  }
}

// ------------------------------------------------------------------ restaurantes

async function listaRestaurantes(req, res) {
  res.render('admin/restaurantes/lista', { titulo: 'Restaurantes', restaurantes: await Restaurante.listarAdmin() });
}

function formNuevoRestaurante(req, res) {
  res.render('admin/restaurantes/form', { titulo: 'Nuevo restaurante', restaurante: null, valores: {}, errores: {} });
}

async function crearRestaurante(req, res) {
  const { valores, errores, valido } = validar(ESQUEMAS.restaurante, req.body);
  if (!valido) {
    return res.status(422).render('admin/restaurantes/form', { titulo: 'Nuevo restaurante', restaurante: null, valores: req.body ?? {}, errores });
  }
  const id = await Restaurante.crear(valores);
  const fotoOk = await fotoNuevaSegura(req, 'restaurantes', id, null, Restaurante);
  avisar(req, fotoOk ? 'Restaurante creado' : 'Restaurante creado, pero la imagen no se pudo guardar', fotoOk ? 'success' : 'warning');
  return res.redirect(303, `/admin/restaurantes/${id}`);
}

async function detalleRestaurante(req, res) {
  const id = idDe(req.params.id);
  const restaurante = existe(await Restaurante.obtenerAdmin(id));
  const [cartas, comentarios] = await Promise.all([Carta.arbolAdmin(id), Comentario.listarAdmin(id)]);
  res.render('admin/restaurantes/detalle', { titulo: restaurante.nombre, restaurante, cartas, comentarios });
}

async function formEditarRestaurante(req, res) {
  const restaurante = existe(await Restaurante.obtenerAdmin(idDe(req.params.id)));
  res.render('admin/restaurantes/form', { titulo: 'Editar restaurante', restaurante, valores: restaurante, errores: {} });
}

async function editarRestaurante(req, res) {
  const id = idDe(req.params.id);
  const restaurante = existe(await Restaurante.obtenerAdmin(id));
  const { valores, errores, valido } = validar(ESQUEMAS.restaurante, req.body);
  if (!valido) {
    return res.status(422).render('admin/restaurantes/form', { titulo: 'Editar restaurante', restaurante, valores: req.body ?? {}, errores });
  }
  await Restaurante.actualizar(id, valores);
  const fotoOk = await fotoNuevaSegura(req, 'restaurantes', id, restaurante.foto, Restaurante);
  avisar(req, fotoOk ? 'Restaurante actualizado' : 'Datos guardados, pero la imagen no se pudo guardar', fotoOk ? 'success' : 'warning');
  return res.redirect(303, `/admin/restaurantes/${id}`);
}

async function eliminarRestaurante(req, res) {
  existe(await Restaurante.eliminar(idDe(req.params.id)));
  avisar(req, 'Restaurante eliminado');
  res.redirect(303, '/admin');
}

// ------------------------------------------------------------------ cartas y categorías (mismo formulario: nombre, orden, visible)

const formSimple = (res, titulo, accion, volver, valores, errores, estado = 200) =>
  res.status(estado).render('admin/form-simple', { titulo, accion, volver, valores, errores });

async function formNuevaCarta(req, res) {
  const id = idDe(req.params.rid);
  existe(await Restaurante.obtenerAdmin(id));
  formSimple(res, 'Nueva carta', `/admin/restaurantes/${id}/cartas`, `/admin/restaurantes/${id}`, { visible: 'on' }, {});
}

async function crearCarta(req, res) {
  const rid = idDe(req.params.rid);
  existe(await Restaurante.obtenerAdmin(rid));
  const { valores, errores, valido } = validar(ESQUEMAS.carta, req.body);
  if (!valido) return formSimple(res, 'Nueva carta', `/admin/restaurantes/${rid}/cartas`, `/admin/restaurantes/${rid}`, req.body ?? {}, errores, 422);
  await Carta.crear(rid, valores);
  avisar(req, 'Carta creada');
  return res.redirect(303, `/admin/restaurantes/${rid}`);
}

async function formEditarCarta(req, res) {
  const c = existe(await Carta.obtener(idDe(req.params.id)));
  formSimple(res, 'Editar carta', `/admin/cartas/${c.id}/editar`, `/admin/restaurantes/${c.restaurante_id}`, { ...c, visible: c.visible ? 'on' : '' }, {});
}

async function editarCarta(req, res) {
  const c = existe(await Carta.obtener(idDe(req.params.id)));
  const { valores, errores, valido } = validar(ESQUEMAS.carta, req.body);
  if (!valido) return formSimple(res, 'Editar carta', `/admin/cartas/${c.id}/editar`, `/admin/restaurantes/${c.restaurante_id}`, req.body ?? {}, errores, 422);
  await Carta.actualizar(c.id, valores);
  avisar(req, 'Carta actualizada');
  return res.redirect(303, `/admin/restaurantes/${c.restaurante_id}`);
}

async function eliminarCarta(req, res) {
  const c = existe(await Carta.obtener(idDe(req.params.id)));
  await Carta.eliminar(c.id);
  avisar(req, 'Carta eliminada');
  res.redirect(303, `/admin/restaurantes/${c.restaurante_id}`);
}

async function formNuevaCategoria(req, res) {
  const c = existe(await Carta.obtener(idDe(req.params.cid)));
  formSimple(res, 'Nueva categoría', `/admin/cartas/${c.id}/categorias`, `/admin/restaurantes/${c.restaurante_id}`, { visible: 'on' }, {});
}

async function crearCategoria(req, res) {
  const c = existe(await Carta.obtener(idDe(req.params.cid)));
  const { valores, errores, valido } = validar(ESQUEMAS.categoria, req.body);
  if (!valido) return formSimple(res, 'Nueva categoría', `/admin/cartas/${c.id}/categorias`, `/admin/restaurantes/${c.restaurante_id}`, req.body ?? {}, errores, 422);
  await Categoria.crear(c.id, valores);
  avisar(req, 'Categoría creada');
  return res.redirect(303, `/admin/restaurantes/${c.restaurante_id}`);
}

async function formEditarCategoria(req, res) {
  const c = existe(await Categoria.obtener(idDe(req.params.id)));
  formSimple(res, 'Editar categoría', `/admin/categorias/${c.id}/editar`, `/admin/restaurantes/${c.restaurante_id}`, { ...c, visible: c.visible ? 'on' : '' }, {});
}

async function editarCategoria(req, res) {
  const c = existe(await Categoria.obtener(idDe(req.params.id)));
  const { valores, errores, valido } = validar(ESQUEMAS.categoria, req.body);
  if (!valido) return formSimple(res, 'Editar categoría', `/admin/categorias/${c.id}/editar`, `/admin/restaurantes/${c.restaurante_id}`, req.body ?? {}, errores, 422);
  await Categoria.actualizar(c.id, valores);
  avisar(req, 'Categoría actualizada');
  return res.redirect(303, `/admin/restaurantes/${c.restaurante_id}`);
}

async function eliminarCategoria(req, res) {
  const c = existe(await Categoria.obtener(idDe(req.params.id)));
  await Categoria.eliminar(c.id);
  avisar(req, 'Categoría eliminada');
  res.redirect(303, `/admin/restaurantes/${c.restaurante_id}`);
}

// ------------------------------------------------------------------ ítems (platillos)

const formItem = (res, titulo, accion, volver, item, valores, errores, estado = 200) =>
  res.status(estado).render('admin/items/form', { titulo, accion, volver, item, valores, errores });

async function formNuevoItem(req, res) {
  const c = existe(await Categoria.obtener(idDe(req.params.cid)));
  formItem(res, 'Nuevo platillo', `/admin/categorias/${c.id}/items`, `/admin/restaurantes/${c.restaurante_id}`, null, { visible: 'on' }, {});
}

async function crearItem(req, res) {
  const c = existe(await Categoria.obtener(idDe(req.params.cid)));
  const volver = `/admin/restaurantes/${c.restaurante_id}`;
  const { valores, errores, valido } = validar(ESQUEMAS.item, req.body);
  if (!valido) return formItem(res, 'Nuevo platillo', `/admin/categorias/${c.id}/items`, volver, null, req.body ?? {}, errores, 422);
  const id = await Item.crear(c.id, valores);
  const fotoOk = await fotoNuevaSegura(req, 'items', id, null, Item);
  avisar(req, fotoOk ? 'Platillo creado' : 'Platillo creado, pero la imagen no se pudo guardar', fotoOk ? 'success' : 'warning');
  return res.redirect(303, volver);
}

async function formEditarItem(req, res) {
  const it = existe(await Item.obtenerAdmin(idDe(req.params.id)));
  formItem(res, 'Editar platillo', `/admin/items/${it.id}/editar`, `/admin/restaurantes/${it.restaurante_id}`, it,
    { ...it, visible: it.visible ? 'on' : '', destacado: it.destacado ? 'on' : '' }, {});
}

async function editarItem(req, res) {
  const it = existe(await Item.obtenerAdmin(idDe(req.params.id)));
  const volver = `/admin/restaurantes/${it.restaurante_id}`;
  const { valores, errores, valido } = validar(ESQUEMAS.item, req.body);
  if (!valido) return formItem(res, 'Editar platillo', `/admin/items/${it.id}/editar`, volver, it, req.body ?? {}, errores, 422);
  await Item.actualizar(it.id, valores);
  const fotoOk = await fotoNuevaSegura(req, 'items', it.id, it.foto, Item);
  avisar(req, fotoOk ? 'Platillo actualizado' : 'Datos guardados, pero la imagen no se pudo guardar', fotoOk ? 'success' : 'warning');
  return res.redirect(303, volver);
}

async function eliminarItem(req, res) {
  const it = existe(await Item.obtenerAdmin(idDe(req.params.id)));
  await Item.eliminar(it.id);
  avisar(req, 'Platillo eliminado');
  res.redirect(303, `/admin/restaurantes/${it.restaurante_id}`);
}

// ------------------------------------------------------------------ comentarios (moderación)

async function eliminarComentario(req, res) {
  const c = existe(await Comentario.obtener(idDe(req.params.id)));
  await Comentario.eliminar(c.id);
  avisar(req, 'Comentario eliminado');
  res.redirect(303, `/admin/restaurantes/${c.restaurante_id}`);
}

module.exports = {
  listaRestaurantes, formNuevoRestaurante, crearRestaurante, detalleRestaurante, formEditarRestaurante, editarRestaurante, eliminarRestaurante,
  formNuevaCarta, crearCarta, formEditarCarta, editarCarta, eliminarCarta,
  formNuevaCategoria, crearCategoria, formEditarCategoria, editarCategoria, eliminarCategoria,
  formNuevoItem, crearItem, formEditarItem, editarItem, eliminarItem,
  eliminarComentario,
};
