'use strict';
const express = require('express');
const morgan = require('morgan');
const config = require('./config');
const { pool } = require('./db/pool');
const { cabecerasSeguridad } = require('./middlewares/seguridad');
const { sesion } = require('./middlewares/sesion');
const { csrf } = require('./middlewares/csrf');
const { limiteGlobal } = require('./middlewares/limitadores');
const { noEncontrado, manejadorErrores } = require('./middlewares/errores');
const routes = require('./routes');
const media = require('./routes/media');

/** Construye la API Express (JSON). El sitio web es un frontend estático aparte (carpeta frontend/). (separada de server.js para poder probarla con supertest). */
function crearApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

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

  // Imágenes subidas desde el panel (disco o S3): sin sesión ni límite global, con caché larga (nombres inmutables)
  app.use('/media', media);

  app.use(limiteGlobal());
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(express.json({ limit: '10kb' }));
  app.use(sesion());
  app.use(csrf);

  app.use('/api', routes);
  app.use(noEncontrado);
  app.use(manejadorErrores);
  return app;
}

module.exports = { crearApp };
