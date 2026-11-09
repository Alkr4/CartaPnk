'use strict';
const path = require('node:path');
const express = require('express');
const morgan = require('morgan');
const config = require('./config');
const { pool } = require('./db/pool');
const { cabecerasSeguridad } = require('./middlewares/seguridad');
const { sesion } = require('./middlewares/sesion');
const { csrf } = require('./middlewares/csrf');
const { localsDeVista } = require('./middlewares/auth');
const { limiteGlobal } = require('./middlewares/limitadores');
const { noEncontrado, manejadorErrores } = require('./middlewares/errores');
const routes = require('./routes');
const media = require('./routes/media');
const { monedaChilena } = require('./utils/formato');

/** Construye la aplicación Express (separada de server.js para poder probarla con supertest). */
function crearApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.locals.monedaChilena = monedaChilena;

  if (!config.esTest) app.use(morgan(config.logs));
  app.use(cabecerasSeguridad());

  // Chequeo de salud para Docker / balanceadores: sin sesión ni límites.
  app.get('/salud', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ estado: 'ok', ambiente: config.ambiente });
    } catch {
      res.status(503).json({ estado: 'sin-base-de-datos' });
    }
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), {
    index: false,
    maxAge: config.esProduccion ? '7d' : 0,
  }));

  // Imágenes subidas desde el panel (disco o S3): sin sesión ni límite global, con caché larga (nombres inmutables)
  app.use('/media', media);

  app.use(limiteGlobal());
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(express.json({ limit: '10kb' }));
  app.use(sesion());
  app.use(csrf);
  app.use(localsDeVista);

  app.use(routes);
  app.use(noEncontrado);
  app.use(manejadorErrores);
  return app;
}

module.exports = { crearApp };
