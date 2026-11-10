'use strict';
const { nuevoAgente, tokenCsrf, iniciarSesion, adminConToken } = require('./ayudas');
const { pool } = require('../src/db/pool');

afterAll(() => pool.end());

describe('acceso al panel /api/admin (VUL-02, 09, 15, 16, 17)', () => {
  test('sin sesión, la API del panel responde 401', async () => {
    const agente = nuevoAgente();
    for (const ruta of ['/api/admin/restaurantes', '/api/admin/restaurantes/1', '/api/admin/items/1']) {
      const res = await agente.get(ruta);
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    }
  });

  test('las respuestas del panel no se cachean ni se indexan', async () => {
    const res = await nuevoAgente().get('/api/admin/restaurantes');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
  });

  test('credenciales incorrectas: 401 con mensaje genérico y sin acceso', async () => {
    const agente = nuevoAgente();
    const res = await iniciarSesion(agente, { email: 'admin@gmail.com', password: 'incorrecta' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Credenciales incorrectas.');
    expect((await agente.get('/api/admin/restaurantes')).status).toBe(401);
    expect((await agente.get('/api/sesion')).body.usuario).toBeNull();
  });

  test.each(["admin@gmail.com' -- -", "' OR '1'='1", "admin@gmail.com'; DROP TABLE usuarios; --"])(
    'inyección SQL en el login (%s) no da acceso', async (email) => {
      const agente = nuevoAgente();
      const res = await iniciarSesion(agente, { email, password: 'x' });
      expect(res.status).toBe(401);
      expect((await agente.get('/api/admin/restaurantes')).status).toBe(401);
    });

  test('un usuario con contraseña correcta pero rol "cliente" NO entra (misma respuesta que un error)', async () => {
    const agente = nuevoAgente();
    const res = await iniciarSesion(agente, { email: 'alondra@gmail.com', password: 'alondra01' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Credenciales incorrectas.');
    expect((await agente.get('/api/admin/restaurantes')).status).toBe(401);
  });

  test('login de administrador: entra y cambia el identificador de sesión y el token CSRF', async () => {
    const agente = nuevoAgente();
    const antes = await agente.get('/api/sesion');
    const sidAntes = antes.headers['set-cookie'].find((c) => c.startsWith('pnk.sid=')).split(';')[0];
    const res = await iniciarSesion(agente);
    expect(res.status).toBe(200);
    expect(res.body.usuario).toEqual({ nombre: expect.any(String), rol: 'admin' });
    expect(res.body.csrfToken).not.toBe(antes.body.csrfToken);
    const sidDespues = res.headers['set-cookie'].find((c) => c.startsWith('pnk.sid=')).split(';')[0];
    expect(sidDespues).not.toBe(sidAntes);
    const panel = await agente.get('/api/admin/restaurantes');
    expect(panel.status).toBe(200);
    expect(panel.body.restaurantes.length).toBeGreaterThan(0);
  });

  test('con sesión de admin, /api/sesion lo informa (el frontend muestra la barra de administrador)', async () => {
    const { agente } = await adminConToken();
    const sesion = await agente.get('/api/sesion');
    expect(sesion.body.usuario.rol).toBe('admin');
  });

  test('las contraseñas se guardan con hash bcrypt, nunca en texto plano, y existe el rol', async () => {
    const { rows } = await pool.query('SELECT password_hash, rol FROM usuarios');
    expect(rows.length).toBeGreaterThan(0);
    for (const { password_hash: h, rol } of rows) {
      expect(h).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(['admin', 'cliente']).toContain(rol);
    }
  });

  test('la respuesta del login no incluye hash ni datos sensibles', async () => {
    const res = await iniciarSesion(nuevoAgente());
    expect(JSON.stringify(res.body)).not.toMatch(/hash|password|\$2[aby]\$/i);
  });

  test('cerrar sesión destruye la sesión', async () => {
    const { agente, token } = await adminConToken();
    const res = await agente.post('/api/admin/logout').set('X-CSRF-Token', token);
    expect(res.status).toBe(200);
    expect((await agente.get('/api/admin/restaurantes')).status).toBe(401);
  });

  test('logout sin token CSRF -> 403', async () => {
    const { agente } = await adminConToken();
    expect((await agente.post('/api/admin/logout')).status).toBe(403);
  });
});

describe('fuerza bruta en el login de administración (VUL-16)', () => {
  test('tras 5 intentos fallidos se bloquea el login (429)', async () => {
    const agente = nuevoAgente();
    const email = `bloqueo-${Date.now()}@ejemplo.cl`;
    for (let i = 0; i < 5; i += 1) {
      await iniciarSesion(agente, { email, password: `mala-${i}` });
    }
    const res = await iniciarSesion(agente, { email, password: 'otra' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body.error).toContain('Demasiados intentos fallidos');
  });

  test('los inicios de sesión correctos no consumen el límite', async () => {
    for (let i = 0; i < 7; i += 1) {
      const res = await iniciarSesion(nuevoAgente());
      expect(res.status).toBe(200);
    }
  });

  test('el token CSRF se pide con GET /api/sesion', async () => {
    expect(await tokenCsrf(nuevoAgente())).toMatch(/^[a-f0-9]{64}$/);
  });
});
