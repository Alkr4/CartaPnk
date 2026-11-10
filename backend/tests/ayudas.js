'use strict';
const request = require('supertest');
const { crearApp } = require('../src/app');

const app = crearApp();

/** Agente con cookies (una "sesión de navegador"). */
const nuevoAgente = () => request.agent(app);

/** Obtiene el token CSRF de la sesión (el frontend hace lo mismo con GET /api/sesion). */
async function tokenCsrf(agente) {
  const res = await agente.get('/api/sesion');
  if (!res.body.csrfToken) throw new Error('GET /api/sesion no devolvió un token CSRF');
  return res.body.csrfToken;
}

/** Inicia sesión en el panel de administración (por defecto con el administrador de demostración). */
async function iniciarSesion(agente, { email = 'admin@gmail.com', password = 'admin01' } = {}) {
  const token = await tokenCsrf(agente);
  return agente.post('/api/admin/login').set('X-CSRF-Token', token).send({ email, password });
}

/** Agente ya autenticado como administrador, con el token CSRF vigente de su sesión nueva. */
async function adminConToken() {
  const agente = nuevoAgente();
  const res = await iniciarSesion(agente);
  if (res.status !== 200) throw new Error(`No se pudo iniciar sesión de administrador (${res.status})`);
  return { agente, token: res.body.csrfToken };
}

module.exports = { app, request, nuevoAgente, tokenCsrf, iniciarSesion, adminConToken };
