'use strict';
const { nuevoAgente, tokenCsrf, iniciarSesion } = require('./ayudas');
const { pool } = require('../src/db/pool');

afterAll(() => pool.end());

describe('acceso al panel /admin (VUL-02, 09, 15, 16, 17)', () => {
  test('sin sesión, /admin redirige al login', async () => {
    const agente = nuevoAgente();
    const res = await agente.get('/admin');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/login');
    const login = await agente.get('/admin/login');
    expect(login.status).toBe(200);
    expect(login.text).toContain('Acceso de administración');
  });

  test('las páginas del panel no se cachean ni se indexan', async () => {
    const res = await nuevoAgente().get('/admin/login');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
  });

  test('credenciales incorrectas: mensaje genérico y sin acceso', async () => {
    const agente = nuevoAgente();
    const res = await iniciarSesion(agente, { email: 'admin@gmail.com', password: 'incorrecta' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/login');
    const pagina = await agente.get('/admin/login');
    expect(pagina.text).toContain('Credenciales incorrectas.');
    expect((await agente.get('/admin')).status).toBe(303);
  });

  test.each(["admin@gmail.com' -- -", "' OR '1'='1", "admin@gmail.com'; DROP TABLE usuarios; --"])(
    'inyección SQL en el login (%s) no da acceso', async (email) => {
      const agente = nuevoAgente();
      await iniciarSesion(agente, { email, password: 'x' });
      expect((await agente.get('/admin')).status).toBe(303);
    });

  test('un usuario con contraseña correcta pero rol "cliente" NO entra (misma respuesta que un error)', async () => {
    const agente = nuevoAgente();
    const res = await iniciarSesion(agente, { email: 'alondra@gmail.com', password: 'alondra01' });
    expect(res.headers.location).toBe('/admin/login');
    // el mensaje flash se muestra una sola vez: leerlo antes de hacer otra petición
    expect((await agente.get('/admin/login')).text).toContain('Credenciales incorrectas.');
    expect((await agente.get('/admin')).status).toBe(303);
  });

  test('login de administrador: entra al panel y cambia el identificador de sesión', async () => {
    const agente = nuevoAgente();
    const antes = await agente.get('/admin/login');
    const sidAntes = antes.headers['set-cookie'].find((c) => c.startsWith('pnk.sid=')).split(';')[0];
    const res = await iniciarSesion(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin');
    const sidDespues = res.headers['set-cookie'].find((c) => c.startsWith('pnk.sid=')).split(';')[0];
    expect(sidDespues).not.toBe(sidAntes);
    const panel = await agente.get('/admin');
    expect(panel.status).toBe(200);
    expect(panel.text).toContain('Nuevo restaurante');
  });

  test('con sesión de admin, el sitio público muestra la barra de administrador (no un login)', async () => {
    const agente = nuevoAgente();
    await iniciarSesion(agente);
    const pagina = await agente.get('/restaurantes/1');
    expect(pagina.text).toContain('Sesión de administrador');
    expect(pagina.text).not.toMatch(/type="password"/);
  });

  test('las contraseñas se guardan con hash bcrypt, nunca en texto plano, y existe el rol', async () => {
    const { rows } = await pool.query('SELECT password_hash, rol FROM usuarios');
    expect(rows.length).toBeGreaterThan(0);
    for (const { password_hash: h, rol } of rows) {
      expect(h).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(['admin', 'cliente']).toContain(rol);
    }
  });

  test('cerrar sesión destruye la sesión', async () => {
    const agente = nuevoAgente();
    await iniciarSesion(agente);
    const token = await tokenCsrf(agente, '/admin');
    const res = await agente.post('/admin/logout').type('form').send({ _csrf: token });
    expect(res.status).toBe(303);
    expect((await agente.get('/admin')).status).toBe(303);
  });

  test('logout sin token CSRF -> 403', async () => {
    const agente = nuevoAgente();
    await iniciarSesion(agente);
    const res = await agente.post('/admin/logout').type('form').send({});
    expect(res.status).toBe(403);
  });
});

describe('fuerza bruta en el login de administración (VUL-16)', () => {
  test('tras 5 intentos fallidos se bloquea el login', async () => {
    const agente = nuevoAgente();
    const email = `bloqueo-${Date.now()}@ejemplo.cl`;
    for (let i = 0; i < 5; i += 1) {
      await iniciarSesion(agente, { email, password: `mala-${i}` });
    }
    const res = await iniciarSesion(agente, { email, password: 'otra' });
    expect(res.status).toBe(303);
    expect(res.headers['retry-after']).toBeDefined();
    const pagina = await agente.get('/admin/login');
    expect(pagina.text).toContain('Demasiados intentos fallidos');
  });

  test('los inicios de sesión correctos no consumen el límite', async () => {
    for (let i = 0; i < 7; i += 1) {
      const agente = nuevoAgente();
      const res = await iniciarSesion(agente);
      expect(res.headers.location).toBe('/admin');
    }
  });
});

describe('comentarios existentes en el sitio público (VUL-08)', () => {
  test('el contenido de un comentario se muestra siempre escapado (sin XSS)', async () => {
    await pool.query(
      'INSERT INTO comentarios (usuario_id, restaurante_id, comentario) VALUES ((SELECT id FROM usuarios ORDER BY id LIMIT 1), 1, $1)',
      ['<script>alert(\'xss\')</script> "comillas"'],
    );
    const pagina = await nuevoAgente().get('/restaurantes/1');
    expect(pagina.text).toContain('&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;');
    expect(pagina.text).not.toContain("<script>alert('xss')</script>");
    await pool.query("DELETE FROM comentarios WHERE comentario LIKE '<script>alert(%'");
  });
});
