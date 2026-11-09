'use strict';
const request = require('supertest');
const { crearApp } = require('../src/app');

const app = crearApp();

/** Agente con cookies (una "sesión de navegador"). */
const nuevoAgente = () => request.agent(app);

/** Obtiene el token CSRF de la sesión leyendo la meta de una página (por defecto la carta pública). */
async function tokenCsrf(agente, ruta = '/restaurantes/1') {
  const res = await agente.get(ruta);
  const m = res.text.match(/name="csrf-token" content="([a-f0-9]+)"/);
  if (!m) throw new Error(`No se encontró el token CSRF en ${ruta}`);
  return m[1];
}

/** Inicia sesión en el panel de administración (por defecto con el administrador de demostración). */
async function iniciarSesion(agente, { email = 'admin@gmail.com', password = 'admin01' } = {}) {
  const token = await tokenCsrf(agente, '/admin/login');
  return agente.post('/admin/login').type('form').send({ _csrf: token, email, password });
}

module.exports = { app, request, nuevoAgente, tokenCsrf, iniciarSesion };
