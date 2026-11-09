'use strict';
const express = require('express');
const auth = require('../controllers/auth.controller');
const a = require('../controllers/admin.controller');
const { requiereAdmin, sinCacheNiIndexar } = require('../middlewares/auth');
const { limiteLogin } = require('../middlewares/limitadores');
const { validarImagen } = require('../middlewares/subida');

const router = express.Router();
router.use(sinCacheNiIndexar);

// Acceso (única puerta de entrada de la aplicación: el sitio público no muestra ningún login)
router.get('/login', auth.mostrarLogin);
router.post('/login', limiteLogin(), auth.login);
router.post('/logout', auth.logout);

// Todo lo que sigue exige sesión de administrador (comprobado en el servidor en cada petición).
// El CSRF y el análisis de formularios multipart ya se resolvieron en el middleware global de CSRF.
router.use(requiereAdmin);

router.get('/', a.listaRestaurantes);

// Restaurantes
router.get('/restaurantes/nuevo', a.formNuevoRestaurante);
router.post('/restaurantes', validarImagen, a.crearRestaurante);
router.get('/restaurantes/:id', a.detalleRestaurante);
router.get('/restaurantes/:id/editar', a.formEditarRestaurante);
router.post('/restaurantes/:id/editar', validarImagen, a.editarRestaurante);
router.post('/restaurantes/:id/eliminar', a.eliminarRestaurante);

// Cartas
router.get('/restaurantes/:rid/cartas/nueva', a.formNuevaCarta);
router.post('/restaurantes/:rid/cartas', a.crearCarta);
router.get('/cartas/:id/editar', a.formEditarCarta);
router.post('/cartas/:id/editar', a.editarCarta);
router.post('/cartas/:id/eliminar', a.eliminarCarta);

// Categorías
router.get('/cartas/:cid/categorias/nueva', a.formNuevaCategoria);
router.post('/cartas/:cid/categorias', a.crearCategoria);
router.get('/categorias/:id/editar', a.formEditarCategoria);
router.post('/categorias/:id/editar', a.editarCategoria);
router.post('/categorias/:id/eliminar', a.eliminarCategoria);

// Ítems (platillos)
router.get('/categorias/:cid/items/nuevo', a.formNuevoItem);
router.post('/categorias/:cid/items', validarImagen, a.crearItem);
router.get('/items/:id/editar', a.formEditarItem);
router.post('/items/:id/editar', validarImagen, a.editarItem);
router.post('/items/:id/eliminar', a.eliminarItem);

// Moderación de comentarios
router.post('/comentarios/:id/eliminar', a.eliminarComentario);

module.exports = router;
