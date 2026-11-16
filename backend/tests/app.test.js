'use strict';
const { app, request, nuevoAgente, tokenCsrf } = require('./ayudas');
const { pool } = require('../src/db/pool');

afterAll(() => pool.end());

describe('salud y datos públicos de la carta', () => {
  test('GET /salud responde ok y verifica la base de datos', async () => {
    const res = await request(app).get('/salud');
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('ok');
  });

  test('GET /api/restaurantes/primero entrega el id del primer restaurante', async () => {
    const res = await request(app).get('/api/restaurantes/primero');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  test('GET /api/restaurantes/:id entrega restaurante, destacados, cartas y comentarios', async () => {
    const res = await request(app).get('/api/restaurantes/1');
    expect(res.status).toBe(200);
    expect(res.body.restaurante.nombre).toContain('Restobar');
    expect(res.body.restaurante.fotoUrl).toMatch(/^\/imagenes\/cod1\//);
    expect(res.body.destacados.length).toBeGreaterThan(0);
    expect(res.body.cartas.length).toBeGreaterThan(0);
    expect(res.body.cartas[0].categorias[0]).toHaveProperty('items');
    expect(Array.isArray(res.body.comentarios)).toBe(true);
    expect(JSON.stringify(res.body)).toMatch(/12500/);
  });

  test('la API no expone columnas internas (hash, eliminado, ids de dirección)', async () => {
    const res = await request(app).get('/api/restaurantes/1');
    expect(JSON.stringify(res.body)).not.toMatch(/password|eliminado|direccion_id|rut/i);
  });

  test.each(['9999', 'abc', '1%20UNION%20SELECT%201', '0', '-1', '1;DROP%20TABLE%20items'])(
    'id inválido o inexistente (%s) responde 404 sin error de base de datos', async (id) => {
      const res = await request(app).get(`/api/restaurantes/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(JSON.stringify(res.body)).not.toMatch(/syntax error|pg_|stack|node_modules/i);
    });
});

describe('API sin login para los clientes', () => {
  test('/api/sesion informa que no hay usuario y entrega el token CSRF', async () => {
    const res = await request(app).get('/api/sesion');
    expect(res.body.usuario).toBeNull();
    expect(res.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
  });

  test.each(['/api/auth/login', '/api/restaurantes/1/comentarios'])('el endpoint público %s no existe', async (ruta) => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const res = await agente.post(ruta).set('X-CSRF-Token', token).send({ comentario: 'x', email: 'a@b.cl', password: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('cabeceras y cookies de seguridad (VUL-10, 11, 12)', () => {
  test('la respuesta incluye CSP, nosniff, X-Frame-Options y no revela la tecnología', async () => {
    const res = await request(app).get('/api/restaurantes/1');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['permissions-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('la API no se cachea ni se indexa (depende de la sesión)', async () => {
    const res = await request(app).get('/api/restaurantes/1');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
  });

  test('la cookie de sesión es HttpOnly y SameSite=Lax', async () => {
    const res = await request(app).get('/api/sesion');
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('pnk.sid='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});

describe('CSRF (VUL-14)', () => {
  test('login sin token CSRF -> 403', async () => {
    const res = await request(app).post('/api/admin/login').send({ email: 'admin@gmail.com', password: 'admin01' });
    expect(res.status).toBe(403);
  });

  test('carrito sin token CSRF -> 403', async () => {
    const agente = nuevoAgente();
    await agente.get('/api/sesion');
    const res = await agente.post('/api/carrito/items').send({ itemId: 5 });
    expect(res.status).toBe(403);
  });

  test('token incorrecto -> 403', async () => {
    const agente = nuevoAgente();
    await agente.get('/api/sesion');
    const res = await agente.post('/api/carrito/items').set('X-CSRF-Token', 'a'.repeat(64)).send({ itemId: 5 });
    expect(res.status).toBe(403);
  });

  test('un sitio ajeno no puede usar la sesión: el token sólo viaja por la API del mismo origen', async () => {
    const victima = nuevoAgente();
    await victima.get('/api/sesion');
    const res = await victima.post('/api/carrito/items').set('Origin', 'https://sitio-malicioso.example').send({ itemId: 5 });
    expect(res.status).toBe(403);
  });
});

describe('carrito (VUL-04)', () => {
  test('agregar, ver, quitar y vaciar el carrito (sin necesidad de login)', async () => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const json = (r) => r.set('X-CSRF-Token', token);

    expect((await json(agente.post('/api/carrito/items')).send({ itemId: 5 })).status).toBe(201);
    expect((await json(agente.post('/api/carrito/items')).send({ itemId: 2 })).status).toBe(201);
    const vista = await agente.get('/api/carrito?restaurante=1');
    expect(vista.status).toBe(200);
    expect(vista.body.items.map((i) => i.nombre)).toContain('Lomo a lo Pobre');
    expect(vista.body.items.map((i) => i.precio)).toContain(12500);
    expect(vista.body.restaurante.nombre).toContain('Restobar');

    const quitado = await json(agente.delete('/api/carrito/items/1'));
    expect(quitado.body.cantidad).toBe(1);
    const vaciado = await json(agente.delete('/api/carrito'));
    expect(vaciado.body.cantidad).toBe(0);
    expect((await agente.get('/api/carrito?restaurante=1')).body.items).toEqual([]);
  });

  test('sin restaurante en contexto el carrito responde 404', async () => {
    expect((await nuevoAgente().get('/api/carrito')).status).toBe(404);
  });

  test.each([['1 OR 1=1'], ["1'"], [-1], [0], ['abc'], [null], [{ $gt: 0 }]])(
    'itemId inválido (%p) -> 400', async (itemId) => {
      const agente = nuevoAgente();
      const token = await tokenCsrf(agente);
      const res = await agente.post('/api/carrito/items').set('X-CSRF-Token', token).send({ itemId });
      expect(res.status).toBe(400);
    });

  test('ítem inexistente o no visible -> 404', async () => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const res = await agente.post('/api/carrito/items').set('X-CSRF-Token', token).send({ itemId: 99999 });
    expect(res.status).toBe(404);
  });

  test('el precio lo define la base de datos, no el cliente', async () => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    await agente.post('/api/carrito/items').set('X-CSRF-Token', token).send({ itemId: 5, precio: 1, nombre: 'Gratis' });
    const vista = await agente.get('/api/carrito?restaurante=1');
    expect(vista.body.items[0].precio).toBe(12500);
    expect(vista.body.items[0].nombre).not.toBe('Gratis');
  });
});

describe('manejo de errores (VUL-13)', () => {
  test('JSON malformado -> 400 sin detalles internos', async () => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const res = await agente.post('/api/carrito/items').set('X-CSRF-Token', token).set('Content-Type', 'application/json').send('{"itemId":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body) + res.text).not.toMatch(/node_modules|at \w+ \(|stack/i);
  });

  test('ruta inexistente -> 404 JSON genérico', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Recurso no encontrado');
  });

  test('la API no sirve archivos estáticos, código fuente ni configuración', async () => {
    for (const ruta of ['/package.json', '/src/app.js', '/.env', '/db/seeds/catalogo.sql', '/css/style.css', '/../package.json']) {
      expect((await request(app).get(ruta)).status).toBe(404);
    }
  });
});

describe('comentarios existentes (VUL-08)', () => {
  test('el texto del comentario viaja como dato JSON: el frontend lo inserta como texto, nunca como HTML', async () => {
    await pool.query(
      'INSERT INTO comentarios (usuario_id, restaurante_id, comentario) VALUES ((SELECT id FROM usuarios ORDER BY id LIMIT 1), 1, $1)',
      ['<script>alert(\'xss\')</script> "comillas"'],
    );
    const res = await nuevoAgente().get('/api/restaurantes/1');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.comentarios.map((c) => c.comentario)).toContain('<script>alert(\'xss\')</script> "comillas"');
    await pool.query("DELETE FROM comentarios WHERE comentario LIKE '<script>alert(%'");
  });
});
