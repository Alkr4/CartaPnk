'use strict';
const express = require('express');
const auth = require('../controllers/auth.controller');
const a = require('../controllers/admin.controller');
const { requiereAdmin } = require('../middlewares/auth');
const { limiteLogin } = require('../middlewares/limitadores');
const { validarImagen } = require('../middlewares/subida');

/** /api/admin — acceso y CRUD. Todo, salvo el login, exige sesión de administrador (comprobado en el servidor). */
const router = express.Router();

router.post('/login', limiteLogin(), auth.login);
router.post('/logout', auth.logout);

// El CSRF y el análisis de formularios multipart ya se resolvieron en el middleware global de CSRF.
router.use(requiereAdmin);

// Restaurantes (los formularios con imagen llegan como multipart/form-data)
router.get('/restaurantes', a.listaRestaurantes);
router.post('/restaurantes', validarImagen, a.crearRestaurante);
router.get('/restaurantes/:id', a.detalleRestaurante);
router.put('/restaurantes/:id', validarImagen, a.editarRestaurante);
router.delete('/restaurantes/:id', a.eliminarRestaurante);

// Cartas
router.post('/restaurantes/:rid/cartas', a.crearCarta);
router.get('/cartas/:id', a.verCarta);
router.put('/cartas/:id', a.editarCarta);
router.delete('/cartas/:id', a.eliminarCarta);

// Categorías
router.post('/cartas/:cid/categorias', a.crearCategoria);
router.get('/categorias/:id', a.verCategoria);
router.put('/categorias/:id', a.editarCategoria);
router.delete('/categorias/:id', a.eliminarCategoria);

// Ítems (platillos)
router.post('/categorias/:cid/items', validarImagen, a.crearItem);
router.get('/items/:id', a.verItem);
router.put('/items/:id', validarImagen, a.editarItem);
router.delete('/items/:id', a.eliminarItem);

// Moderación de comentarios
router.delete('/comentarios/:id', a.eliminarComentario);

module.exports = router;
