'use strict';
const { app, request, nuevoAgente, tokenCsrf, iniciarSesion } = require('./ayudas');
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
    const res = await request(app).post('/auth/login').type('form').send({ email: 'admin@gmail.com', password: 'admin01' });
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

describe('autenticación (VUL-02, 15, 17)', () => {
  test('credenciales incorrectas no inician sesión y el mensaje es genérico', async () => {
    const agente = nuevoAgente();
    const res = await iniciarSesion(agente, { email: 'admin@gmail.com', password: 'incorrecta' });
    expect(res.status).toBe(303);
    const pagina = await agente.get('/restaurantes/1');
    expect(pagina.text).toContain('Usuario o contraseña incorrectos.');
    expect(pagina.text).not.toContain('Bienvenido');
  });

  test.each(["admin@gmail.com' -- -", "' OR '1'='1", "admin@gmail.com'; DROP TABLE usuarios; --"])(
    'inyección SQL en el login (%s) no inicia sesión', async (email) => {
      const agente = nuevoAgente();
      await iniciarSesion(agente, { email, password: 'x' });
      const pagina = await agente.get('/restaurantes/1');
      expect(pagina.text).not.toContain('Bienvenido');
    });

  test('login correcto: muestra el usuario y cambia el identificador de sesión', async () => {
    const agente = nuevoAgente();
    const antes = await agente.get('/restaurantes/1');
    const sidAntes = antes.headers['set-cookie'].find((c) => c.startsWith('pnk.sid=')).split(';')[0];
    const res = await iniciarSesion(agente);
    expect(res.status).toBe(303);
    const sidDespues = res.headers['set-cookie'].find((c) => c.startsWith('pnk.sid=')).split(';')[0];
    expect(sidDespues).not.toBe(sidAntes);
    const pagina = await agente.get('/restaurantes/1');
    expect(pagina.text).toContain('Bienvenido: Administrador');
  });

  test('las contraseñas se guardan con hash bcrypt, nunca en texto plano', async () => {
    const { rows } = await pool.query('SELECT password_hash FROM usuarios');
    expect(rows.length).toBeGreaterThan(0);
    for (const { password_hash: h } of rows) expect(h).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  test('cerrar sesión destruye la sesión', async () => {
    const agente = nuevoAgente();
    await iniciarSesion(agente);
    const token = await tokenCsrf(agente);
    const res = await agente.post('/auth/logout').type('form').send({ _csrf: token, restaurante: '1' });
    expect(res.status).toBe(303);
    const pagina = await agente.get('/restaurantes/1');
    expect(pagina.text).not.toContain('Bienvenido');
  });

  test('el redireccionamiento tras el login ignora destinos externos (sin open redirect)', async () => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const res = await agente.post('/auth/login').type('form')
      .send({ _csrf: token, email: 'admin@gmail.com', password: 'admin01', restaurante: 'https://evil.example' });
    expect(res.headers.location).toBe('/');
  });
});

describe('fuerza bruta (VUL-16)', () => {
  test('tras 5 intentos fallidos se bloquea el login', async () => {
    const agente = nuevoAgente();
    const email = `bloqueo-${Date.now()}@ejemplo.cl`;
    for (let i = 0; i < 5; i += 1) {
      await iniciarSesion(agente, { email, password: `mala-${i}` });
    }
    const res = await iniciarSesion(agente, { email, password: 'otra' });
    expect(res.status).toBe(303);
    expect(res.headers['retry-after']).toBeDefined();
    const pagina = await agente.get('/restaurantes/1');
    expect(pagina.text).toContain('Demasiados intentos fallidos');
  });

  test('los inicios de sesión correctos no consumen el límite', async () => {
    for (let i = 0; i < 7; i += 1) {
      const agente = nuevoAgente();
      await iniciarSesion(agente, { email: 'alondra@gmail.com', password: 'alondra01' });
      const pagina = await agente.get('/restaurantes/1');
      expect(pagina.text).toContain('Bienvenido: Alondra');
    }
  });
});

describe('comentarios (VUL-05, 08, 09)', () => {
  test('sin sesión no se puede comentar (401)', async () => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const res = await agente.post('/restaurantes/1/comentarios').type('form').send({ _csrf: token, comentario: 'hola' });
    expect(res.status).toBe(401);
  });

  test('el contenido se guarda y se muestra escapado (sin XSS) y admite comillas', async () => {
    const agente = nuevoAgente();
    await iniciarSesion(agente);
    const token = await tokenCsrf(agente);
    const payload = `<script>alert('xss')</script> "comillas" y 'apóstrofes'`;
    const res = await agente.post('/restaurantes/1/comentarios').type('form').send({ _csrf: token, comentario: payload });
    expect(res.status).toBe(303);
    const pagina = await agente.get('/restaurantes/1');
    expect(pagina.text).toContain('&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;');
    expect(pagina.text).not.toContain("<script>alert('xss')</script>");
  });

  test('el autor es el usuario de la sesión, no un valor enviado por el cliente', async () => {
    const agente = nuevoAgente();
    await iniciarSesion(agente, { email: 'alondra@gmail.com', password: 'alondra01' });
    const token = await tokenCsrf(agente);
    await agente.post('/restaurantes/1/comentarios').type('form').send({ _csrf: token, comentario: 'autor-real', usuario: 'Impostor' });
    const { rows } = await pool.query(
      "SELECT u.nombre FROM comentarios c JOIN usuarios u ON u.id = c.usuario_id WHERE c.comentario = 'autor-real' ORDER BY c.id DESC LIMIT 1");
    expect(rows[0].nombre).toBe('Alondra');
  });

  test('comentario vacío o demasiado largo -> 400', async () => {
    const agente = nuevoAgente();
    await iniciarSesion(agente);
    const token = await tokenCsrf(agente);
    const vacio = await agente.post('/restaurantes/1/comentarios').type('form').send({ _csrf: token, comentario: '   ' });
    const largo = await agente.post('/restaurantes/1/comentarios').type('form').send({ _csrf: token, comentario: 'x'.repeat(1001) });
    expect(vacio.status).toBe(400);
    expect(largo.status).toBe(400);
  });
});

describe('carrito (VUL-04)', () => {
  test('agregar, ver, quitar y vaciar; el carrito no cierra la sesión', async () => {
    const agente = nuevoAgente();
    await iniciarSesion(agente);
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
    expect(pagina.text).toContain('Bienvenido: Administrador');
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
