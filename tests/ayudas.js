'use strict';
const request = require('supertest');
const { crearApp } = require('../src/app');

const app = crearApp();

/** Agente con cookies (una "sesión de navegador"). */
const nuevoAgente = () => request.agent(app);

/** Obtiene el token CSRF de la sesión leyendo la meta de la carta. */
async function tokenCsrf(agente, ruta = '/restaurantes/1') {
  const res = await agente.get(ruta);
  const m = res.text.match(/name="csrf-token" content="([a-f0-9]+)"/);
  if (!m) throw new Error('No se encontró el token CSRF en la página');
  return m[1];
}

async function iniciarSesion(agente, { email = 'admin@gmail.com', password = 'admin01' } = {}) {
  const token = await tokenCsrf(agente);
  return agente.post('/auth/login').type('form').send({ _csrf: token, email, password, restaurante: '1' });
}

module.exports = { app, request, nuevoAgente, tokenCsrf, iniciarSesion };
