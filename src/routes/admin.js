'use strict';
const express = require('express');
const auth = require('../controllers/auth.controller');
const { requiereAdmin, sinCacheNiIndexar } = require('../middlewares/auth');
const { limiteLogin } = require('../middlewares/limitadores');

const router = express.Router();
router.use(sinCacheNiIndexar);

// Acceso (única puerta de entrada de la aplicación: el sitio público no muestra ningún login)
router.get('/login', auth.mostrarLogin);
router.post('/login', limiteLogin(), auth.login);
router.post('/logout', auth.logout);

// Todo lo que sigue exige sesión de administrador
router.use(requiereAdmin);
router.get('/', (req, res) => res.render('admin/inicio', { titulo: 'Panel' }));

module.exports = router;
