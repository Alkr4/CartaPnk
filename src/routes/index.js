'use strict';
const express = require('express');
const carta = require('../controllers/carta.controller');
const carrito = require('../controllers/carrito.controller');
const auth = require('../controllers/auth.controller');
const comentario = require('../controllers/comentario.controller');
const { requiereSesion } = require('../middlewares/auth');
const { limiteLogin } = require('../middlewares/limitadores');

const router = express.Router();

// Carta digital
router.get('/', carta.inicio);
router.get('/restaurantes/:id', carta.ver);
router.post('/restaurantes/:id/comentarios', requiereSesion, comentario.crear);

// Carrito (sesión de servidor)
router.get('/carrito', carrito.ver);
router.post('/carrito/items', carrito.agregar);
router.delete('/carrito/items/:posicion', carrito.quitar);
router.delete('/carrito', carrito.vaciar);

// Autenticación
router.post('/auth/login', limiteLogin(), auth.login);
router.post('/auth/logout', auth.logout);

module.exports = router;
