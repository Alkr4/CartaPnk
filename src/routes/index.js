'use strict';
const express = require('express');
const carta = require('../controllers/carta.controller');
const carrito = require('../controllers/carrito.controller');
const admin = require('./admin');

const router = express.Router();

// Carta digital (público: no hay login para los clientes)
router.get('/', carta.inicio);
router.get('/restaurantes/:id', carta.ver);

// Carrito (sesión de servidor)
router.get('/carrito', carrito.ver);
router.post('/carrito/items', carrito.agregar);
router.delete('/carrito/items/:posicion', carrito.quitar);
router.delete('/carrito', carrito.vaciar);

// Panel de administración (login y CRUD, sólo rol admin)
router.use('/admin', admin);

module.exports = router;
