'use strict';
const os = require('node:os');
const express = require('express');
const config = require('../config');
const auth = require('../controllers/auth.controller');
const carta = require('../controllers/carta.controller');
const carrito = require('../controllers/carrito.controller');
const admin = require('./admin');
const { sinCacheNiIndexar, requiereAdmin } = require('../middlewares/auth');

/** API JSON, montada en /api. El frontend (sitio estático) es quien dibuja las páginas. */
const router = express.Router();
router.use(sinCacheNiIndexar);

router.get('/sesion', auth.sesion);

/**
 * GET /api/version — qué versión está publicada y QUÉ instancia respondió. Es dinámica y sin caché (sirve para comprobar un despliegue
 * desde el dominio y para observar el balanceador al retirar un destino).
 */
router.get('/version', (req, res) => {
  res.json({ version: config.version, commit: config.commit, ambiente: config.ambiente, instancia: os.hostname(), hora: new Date().toISOString() });
});

// Carta digital (público: no hay login para los clientes)
router.get('/restaurantes/primero', carta.primero);
router.get('/restaurantes/:id', carta.ver);
// Comentarios: sólo con sesión del panel (dueño o superadmin); los clientes no tienen cuenta
router.post('/restaurantes/:id/comentarios', requiereAdmin, carta.comentar);

// Carrito (sesión de servidor)
router.get('/carrito', carrito.ver);
router.post('/carrito/items', carrito.agregar);
router.delete('/carrito/items/:posicion', carrito.quitar);
router.delete('/carrito', carrito.vaciar);

// Panel de administración (login y CRUD, sólo rol admin)
router.use('/admin', admin);

module.exports = router;
