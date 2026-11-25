'use strict';
// Comentarios en la carta: sólo con sesión del panel, autor tomado de la sesión, texto validado y mostrado como texto.
const { nuevoAgente, tokenCsrf, adminConToken, iniciarSesion } = require('./ayudas');
const { pool, query } = require('../src/db/pool');

const creados = [];
afterAll(async () => {
  if (creados.length) await query('DELETE FROM comentarios WHERE id = ANY($1)', [creados]);
  await pool.end();
});

test('sin sesión del panel no se puede comentar (401), aunque se envíe el token CSRF', async () => {
  const agente = nuevoAgente();
  const token = await tokenCsrf(agente);
  const res = await agente.post('/api/restaurantes/1/comentarios').set('X-CSRF-Token', token).send({ comentario: 'hola' });
  expect(res.status).toBe(401);
});

test('sin token CSRF se rechaza (403)', async () => {
  const { agente } = await adminConToken();
  const res = await agente.post('/api/restaurantes/1/comentarios').send({ comentario: 'hola' });
  expect(res.status).toBe(403);
});

test('un dueño publica un comentario: queda a su nombre (no al que diga el cuerpo) y se ve en la carta', async () => {
  const agente = nuevoAgente();
  const login = await iniciarSesion(agente, { email: 'dueno1@gmail.com', password: 'dueno101' });
  expect(login.status).toBe(200);
  const texto = `Muy rico <script>alert(1)</script> ${Date.now()}`;
  const res = await agente.post('/api/restaurantes/1/comentarios').set('X-CSRF-Token', login.body.csrfToken)
    .send({ comentario: texto, usuario_id: 1, usuario: 'Otro' });
  expect(res.status).toBe(201);
  creados.push(res.body.id);
  const carta = await agente.get('/api/restaurantes/1');
  const publicado = carta.body.comentarios.find((c) => c.comentario === texto);
  expect(publicado).toEqual({ usuario: 'Dueño Uno', comentario: texto });
});

test.each([['vacío', ''], ['sólo espacios', '   '], ['muy largo', 'x'.repeat(1001)], ['no es texto', 123]])(
  'comentario %s -> 422 y no se guarda', async (_caso, comentario) => {
    const { agente, token } = await adminConToken();
    const antes = (await query('SELECT count(*)::int AS n FROM comentarios')).rows[0].n;
    const res = await agente.post('/api/restaurantes/1/comentarios').set('X-CSRF-Token', token).send({ comentario });
    expect(res.status).toBe(422);
    expect(res.body.errores.comentario).toBeDefined();
    expect((await query('SELECT count(*)::int AS n FROM comentarios')).rows[0].n).toBe(antes);
  });

test.each(['abc', '0', '99999999'])('restaurante inexistente (%s) -> 404', async (id) => {
  const { agente, token } = await adminConToken();
  const res = await agente.post(`/api/restaurantes/${id}/comentarios`).set('X-CSRF-Token', token).send({ comentario: 'hola' });
  expect(res.status).toBe(404);
});
