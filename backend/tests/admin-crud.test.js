'use strict';
const { nuevoAgente, tokenCsrf, adminConToken } = require('./ayudas');
const { pool, query } = require('../src/db/pool');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const RESTAURANTE = {
  nombre: 'Café de Prueba', rut: '76123456-7', fono: '+56 9 1234 5678', email: 'cafe@prueba.cl',
  calle: 'Av. Test', numero: '123', comuna: 'Santiago', region: 'Metropolitana',
};

const creados = []; // ids de restaurantes creados por estas pruebas (se eliminan al final)

afterAll(async () => {
  for (const id of creados) await query('UPDATE restaurantes SET eliminado = now() WHERE id = $1', [id]);
  await pool.end();
});

/** Envía un formulario multipart (como lo hace el frontend con FormData), con imagen opcional. */
function multipart(peticion, token, campos, imagen) {
  let r = peticion.set('X-CSRF-Token', token);
  for (const [k, v] of Object.entries(campos)) r = r.field(k, v);
  if (imagen) r = r.attach('foto', imagen.buffer, { filename: imagen.nombre, contentType: imagen.mime ?? 'image/png' });
  return r;
}

describe('panel: control de acceso', () => {
  test.each([
    ['get', '/api/admin/restaurantes/1'],
    ['get', '/api/admin/items/1'],
    ['delete', '/api/admin/restaurantes/1'],
    ['delete', '/api/admin/cartas/1'],
    ['delete', '/api/admin/categorias/1'],
    ['delete', '/api/admin/items/1'],
    ['delete', '/api/admin/comentarios/1'],
  ])('sin sesión %s %s -> 401 (aun con token CSRF válido)', async (metodo, ruta) => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    // eslint-disable-next-line security/detect-object-injection -- `metodo` es una constante de la tabla de casos
    const res = await agente[metodo](ruta).set('X-CSRF-Token', token);
    expect(res.status).toBe(401);
  });

  test('un cliente (rol distinto de admin) no puede usar el panel aunque tenga sesión', async () => {
    // se simula una sesión con otro rol directamente en la tabla de sesiones
    const agente = nuevoAgente();
    await agente.get('/api/sesion');
    await query(`UPDATE sesiones SET sess = jsonb_set(sess::jsonb, '{usuario}', '{"id": 2, "nombre": "Cliente", "rol": "cliente"}')::json
                  WHERE sid = (SELECT sid FROM sesiones ORDER BY expire DESC LIMIT 1)`);
    const res = await agente.get('/api/admin/restaurantes');
    expect([401, 403]).toContain(res.status);
  });

  test('un DELETE de administrador sin token CSRF se rechaza y no borra nada', async () => {
    const { agente } = await adminConToken();
    const res = await agente.delete('/api/admin/restaurantes/1');
    expect(res.status).toBe(403);
    expect((await nuevoAgente().get('/api/restaurantes/1')).status).toBe(200);
  });

  test('un POST multipart sin token CSRF se rechaza', async () => {
    const { agente } = await adminConToken();
    const res = await agente.post('/api/admin/restaurantes').field('nombre', 'x').attach('foto', PNG, 'a.png');
    expect(res.status).toBe(403);
  });
});

describe('panel: CRUD completo', () => {
  test('crear restaurante con imagen, carta, categoría y platillo; se ven en el sitio público', async () => {
    const { agente, token } = await adminConToken();

    const crear = await multipart(agente.post('/api/admin/restaurantes'), token, RESTAURANTE, { buffer: PNG, nombre: 'logo.png' });
    expect(crear.status).toBe(201);
    const rid = crear.body.id;
    creados.push(rid);

    const detalle = await agente.get(`/api/admin/restaurantes/${rid}`);
    expect(detalle.status).toBe(200);
    expect(detalle.body.restaurante.nombre).toBe('Café de Prueba');
    expect(detalle.body.restaurante.fotoUrl).toMatch(/^\/media\/restaurantes\/\d+\/[0-9a-f]{32}\.png$/);

    // la imagen se sirve con cabeceras seguras
    const media = await nuevoAgente().get(detalle.body.restaurante.fotoUrl);
    expect(media.status).toBe(200);
    expect(media.headers['content-type']).toBe('image/png');
    expect(media.headers['x-content-type-options']).toBe('nosniff');
    expect(media.headers['content-security-policy']).toContain('sandbox');

    const carta = await multipart(agente.post(`/api/admin/restaurantes/${rid}/cartas`), token, { nombre: 'Almuerzos', orden: '1', visible: 'on' });
    expect(carta.status).toBe(201);
    const cat = await multipart(agente.post(`/api/admin/cartas/${carta.body.id}/categorias`), token, { nombre: 'Platos de fondo', visible: 'on' });
    expect(cat.status).toBe(201);

    const item = await multipart(agente.post(`/api/admin/categorias/${cat.body.id}/items`), token,
      { nombre: 'Lasaña', descripcion: 'Con <b>salsa</b>', precio: '5990', puntuacion: '4', visible: 'on', destacado: 'on' },
      { buffer: PNG, nombre: 'plato.png' });
    expect(item.status).toBe(201);

    const publica = await nuevoAgente().get(`/api/restaurantes/${rid}`);
    expect(publica.status).toBe(200);
    expect(publica.body.cartas[0].nombre).toBe('Almuerzos');
    const lasana = publica.body.cartas[0].categorias[0].items[0];
    expect(lasana).toMatchObject({ nombre: 'Lasaña', precio: 5990, puntuacion: 4 });
    expect(lasana.descripcion).toBe('Con <b>salsa</b>'); // texto plano: el frontend lo inserta como texto
    expect(lasana.fotoUrl).toMatch(/^\/media\/items\/\d+\//);
    expect(publica.body.destacados.map((d) => d.nombre)).toContain('Lasaña');

    // editar: ocultar el platillo lo saca del sitio público pero no del panel
    const editar = await multipart(agente.put(`/api/admin/items/${item.body.id}`), token, { nombre: 'Lasaña', precio: '5990', puntuacion: '4' });
    expect(editar.status).toBe(200);
    expect(JSON.stringify((await nuevoAgente().get(`/api/restaurantes/${rid}`)).body.cartas)).not.toContain('Lasaña');
    expect(JSON.stringify((await agente.get(`/api/admin/restaurantes/${rid}`)).body.cartas)).toContain('Lasaña');

    // eliminar platillo, categoría, carta y restaurante (borrado lógico)
    for (const ruta of [`items/${item.body.id}`, `categorias/${cat.body.id}`, `cartas/${carta.body.id}`]) {
      expect((await agente.delete(`/api/admin/${ruta}`).set('X-CSRF-Token', token)).status).toBe(200);
    }
    expect((await agente.delete(`/api/admin/restaurantes/${rid}`).set('X-CSRF-Token', token)).status).toBe(200);
    expect((await nuevoAgente().get(`/api/restaurantes/${rid}`)).status).toBe(404);
    expect((await agente.get(`/api/admin/restaurantes/${rid}`)).status).toBe(404);
  });

  test('editar y reemplazar la imagen borra la anterior', async () => {
    const { agente, token } = await adminConToken();
    const rid = (await multipart(agente.post('/api/admin/restaurantes'), token, RESTAURANTE, { buffer: PNG, nombre: 'a.png' })).body.id;
    creados.push(rid);
    const { rows: [antes] } = await query('SELECT foto FROM restaurantes WHERE id = $1', [rid]);

    const res = await multipart(agente.put(`/api/admin/restaurantes/${rid}`), token, { ...RESTAURANTE, nombre: 'Nombre nuevo' }, { buffer: PNG, nombre: 'b.png' });
    expect(res.status).toBe(200);
    const { rows: [despues] } = await query('SELECT nombre, foto FROM restaurantes WHERE id = $1', [rid]);
    expect(despues.nombre).toBe('Nombre nuevo');
    expect(despues.foto).not.toBe(antes.foto);
    expect((await nuevoAgente().get(`/${antes.foto}`)).status).toBe(404);
    expect((await nuevoAgente().get(`/${despues.foto}`)).status).toBe(200);

    const quitar = await multipart(agente.put(`/api/admin/restaurantes/${rid}`), token, { ...RESTAURANTE, quitar_foto: 'on' });
    expect(quitar.status).toBe(200);
    expect((await query('SELECT foto FROM restaurantes WHERE id = $1', [rid])).rows[0].foto).toBeNull();
  });

  test('moderación: el administrador elimina un comentario', async () => {
    const { agente, token } = await adminConToken();
    const { rows: [u] } = await query('SELECT id FROM usuarios LIMIT 1');
    const { rows: [c] } = await query('INSERT INTO comentarios (comentario, usuario_id, restaurante_id) VALUES ($1, $2, 1) RETURNING id', ['spam', u.id]);
    expect((await agente.delete(`/api/admin/comentarios/${c.id}`).set('X-CSRF-Token', token)).status).toBe(200);
    expect((await query('SELECT 1 FROM comentarios WHERE id = $1', [c.id])).rowCount).toBe(0);
  });
});

describe('panel: validación y subidas hostiles', () => {
  test('datos inválidos devuelven 422 con los errores por campo y no crean nada', async () => {
    const { agente, token } = await adminConToken();
    const antes = (await query('SELECT count(*)::int AS n FROM restaurantes')).rows[0].n;
    const res = await multipart(agente.post('/api/admin/restaurantes'), token, { ...RESTAURANTE, nombre: '', rut: '<script>', email: 'no-es-correo' });
    expect(res.status).toBe(422);
    expect(res.body.errores.nombre).toBe('El nombre: campo obligatorio');
    expect(res.body.errores.rut).toContain('El RUT sólo admite');
    expect(res.body.errores.email).toBeDefined();
    expect((await query('SELECT count(*)::int AS n FROM restaurantes')).rows[0].n).toBe(antes);
  });

  test('campos que no están en el esquema se ignoran (sin asignación masiva)', async () => {
    const { agente, token } = await adminConToken();
    const res = await multipart(agente.post('/api/admin/restaurantes'), token, { ...RESTAURANTE, id: '999', eliminado: '2020-01-01', foto: 'media/x' });
    expect(res.status).toBe(201);
    creados.push(res.body.id);
    const { rows: [r] } = await query('SELECT id, eliminado, foto FROM restaurantes WHERE id = $1', [res.body.id]);
    expect(r.id).not.toBe(999);
    expect(r.eliminado).toBeNull();
    expect(r.foto).toBeNull();
  });

  test('un SVG, un script o un ejecutable disfrazado de imagen se rechazan', async () => {
    const { agente, token } = await adminConToken();
    const malos = [
      { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), nombre: 'x.svg', mime: 'image/svg+xml' },
      { buffer: Buffer.from('<?php system($_GET["c"]); ?>'.padEnd(40, ' ')), nombre: 'shell.png', mime: 'image/png' },
      { buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]), nombre: 'virus.png', mime: 'image/png' },
    ];
    for (const imagen of malos) {
      const res = await multipart(agente.post('/api/admin/restaurantes'), token, RESTAURANTE, imagen);
      expect(res.status).toBe(400);
    }
  });

  test('una imagen de más de 2 MB responde 413', async () => {
    const { agente, token } = await adminConToken();
    const grande = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);
    const res = await multipart(agente.post('/api/admin/restaurantes'), token, RESTAURANTE, { buffer: grande, nombre: 'grande.png' });
    expect(res.status).toBe(413);
  });

  test.each(['abc', '0', '-1', '1;DROP TABLE items', '99999999999'])('id inválido (%s) en la URL responde 404', async (id) => {
    const { agente } = await adminConToken();
    expect((await agente.get(`/api/admin/restaurantes/${encodeURIComponent(id)}`)).status).toBe(404);
    expect((await agente.get(`/api/admin/items/${encodeURIComponent(id)}`)).status).toBe(404);
  });

  test('/media sólo sirve claves con el formato exacto (sin path traversal)', async () => {
    for (const ruta of ['/media/../../package.json', '/media/restaurantes/1/../../../package.json', '/media/restaurantes/1/abc.png', `/media/otra/1/${'a'.repeat(32)}.png`]) {
      expect((await nuevoAgente().get(ruta)).status).toBe(404);
    }
  });
});
