'use strict';
const { app, request, nuevoAgente, tokenCsrf } = require('./ayudas');
const { pool } = require('../src/db/pool');

afterAll(() => pool.end());

describe('salud y navegación', () => {
  test('GET /salud responde ok y verifica la base de datos', async () => {
    const res = await request(app).get('/salud');
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('ok');
  });

  test('GET / redirige al primer restaurante', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/restaurantes/1');
  });

  test('la carta muestra el restaurante, los destacados y las cartas', async () => {
    const res = await request(app).get('/restaurantes/1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Restobar');
    expect(res.text).toContain('Menús Destacados');
    expect(res.text).toContain('Productos Seleccionados');
    expect(res.text).toContain('$ 12.500');
  });

  test.each(['9999', 'abc', '1%20UNION%20SELECT%201', '0', '-1', '1;DROP%20TABLE%20items'])(
    'id inválido o inexistente (%s) responde 404 sin error de base de datos', async (id) => {
      const res = await request(app).get(`/restaurantes/${id}`);
      expect(res.status).toBe(404);
      expect(res.text).not.toMatch(/syntax error|pg_|stack|node_modules/i);
    });
});

describe('sitio público sin login para los clientes', () => {
  test('la carta no muestra ningún formulario de login ni de comentarios', async () => {
    const res = await request(app).get('/restaurantes/1');
    expect(res.text).not.toMatch(/type="password"/);
    expect(res.text).not.toContain('/admin/login');
    expect(res.text).not.toContain('Ingresar');
    expect(res.text).not.toMatch(/<textarea/);
  });

  test.each(['/auth/login', '/restaurantes/1/comentarios'])('el endpoint público %s ya no existe', async (ruta) => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const res = await agente.post(ruta).type('form').send({ _csrf: token, comentario: 'x', email: 'a@b.cl', password: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('cabeceras y cookies de seguridad (VUL-10, 11, 12)', () => {
  test('la respuesta incluye CSP, nosniff, X-Frame-Options y no revela la tecnología', async () => {
    const res = await request(app).get('/restaurantes/1');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['permissions-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('la cookie de sesión es HttpOnly y SameSite=Lax', async () => {
    const res = await request(app).get('/restaurantes/1');
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('pnk.sid='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  test('las plantillas no contienen scripts en línea ni manejadores onclick (compatibles con la CSP)', async () => {
    const res = await request(app).get('/restaurantes/1');
    expect(res.text).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    expect(res.text).not.toMatch(/\son\w+\s*=/i);
  });
});

describe('CSRF (VUL-14)', () => {
  test('login sin token CSRF -> 403', async () => {
    const res = await request(app).post('/admin/login').type('form').send({ email: 'admin@gmail.com', password: 'admin01' });
    expect(res.status).toBe(403);
  });

  test('carrito sin token CSRF -> 403', async () => {
    const agente = nuevoAgente();
    await agente.get('/restaurantes/1');
    const res = await agente.post('/carrito/items').send({ itemId: 5 });
    expect(res.status).toBe(403);
  });

  test('token incorrecto -> 403', async () => {
    const agente = nuevoAgente();
    await agente.get('/restaurantes/1');
    const res = await agente.post('/carrito/items').set('X-CSRF-Token', 'a'.repeat(64)).send({ itemId: 5 });
    expect(res.status).toBe(403);
  });
});

describe('carrito (VUL-04)', () => {
  test('agregar, ver, quitar y vaciar el carrito (sin necesidad de login)', async () => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const json = (r) => r.set('X-CSRF-Token', token).set('Accept', 'application/json');

    expect((await json(agente.post('/carrito/items')).send({ itemId: 5 })).status).toBe(201);
    expect((await json(agente.post('/carrito/items')).send({ itemId: 2 })).status).toBe(201);
    const vista = await agente.get('/carrito?restaurante=1');
    expect(vista.status).toBe(200);
    expect(vista.text).toContain('Lomo a lo Pobre');
    expect(vista.text).toContain('$ 12.500');

    const quitado = await json(agente.delete('/carrito/items/1'));
    expect(quitado.body.cantidad).toBe(1);
    const vaciado = await json(agente.delete('/carrito'));
    expect(vaciado.body.cantidad).toBe(0);

    const pagina = await agente.get('/restaurantes/1');
    expect(pagina.status).toBe(200);
  });

  test.each([['1 OR 1=1'], ["1'"], [-1], [0], ['abc'], [null], [{ $gt: 0 }]])(
    'itemId inválido (%p) -> 400', async (itemId) => {
      const agente = nuevoAgente();
      const token = await tokenCsrf(agente);
      const res = await agente.post('/carrito/items').set('X-CSRF-Token', token).send({ itemId });
      expect(res.status).toBe(400);
    });

  test('ítem inexistente o no visible -> 404', async () => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const res = await agente.post('/carrito/items').set('X-CSRF-Token', token).send({ itemId: 99999 });
    expect(res.status).toBe(404);
  });

  test('el precio lo define la base de datos, no el cliente', async () => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    await agente.post('/carrito/items').set('X-CSRF-Token', token).send({ itemId: 5, precio: 1, nombre: 'Gratis' });
    const vista = await agente.get('/carrito?restaurante=1');
    expect(vista.text).toContain('$ 12.500');
    expect(vista.text).not.toContain('Gratis');
  });
});

describe('manejo de errores (VUL-13)', () => {
  test('JSON malformado -> 400 sin detalles internos', async () => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const res = await agente.post('/carrito/items').set('X-CSRF-Token', token).set('Content-Type', 'application/json').send('{"itemId":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body) + res.text).not.toMatch(/node_modules|at \w+ \(|stack/i);
  });

  test('ruta inexistente -> página 404 genérica', async () => {
    const res = await request(app).get('/no-existe').set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Volver al inicio');
  });

  test('archivos estáticos públicos se sirven; el código fuente y la configuración no', async () => {
    expect((await request(app).get('/css/style.css')).status).toBe(200);
    for (const ruta of ['/package.json', '/src/app.js', '/.env', '/db/seeds/catalogo.sql', '/../package.json']) {
      expect((await request(app).get(ruta)).status).toBe(404);
    }
  });
});
