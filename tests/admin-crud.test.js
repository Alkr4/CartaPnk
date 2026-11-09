'use strict';
const { nuevoAgente, tokenCsrf, iniciarSesion } = require('./ayudas');
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

async function adminConToken() {
  const agente = nuevoAgente();
  await iniciarSesion(agente);
  return { agente, token: await tokenCsrf(agente, '/admin') };
}

/** Envía un formulario multipart (con imagen opcional). */
function multipart(agente, ruta, token, campos, imagen) {
  let r = agente.post(ruta).field('_csrf', token);
  for (const [k, v] of Object.entries(campos)) r = r.field(k, v);
  if (imagen) r = r.attach('foto', imagen.buffer, { filename: imagen.nombre, contentType: imagen.mime ?? 'image/png' });
  return r;
}

const idDeRedireccion = (res) => Number(res.headers.location.match(/\/admin\/restaurantes\/(\d+)/)[1]);

describe('panel: control de acceso', () => {
  test.each([
    ['get', '/admin/restaurantes/nuevo'],
    ['get', '/admin/restaurantes/1'],
    ['get', '/admin/items/1/editar'],
  ])('sin sesión %s %s redirige al login', async (metodo, ruta) => {
    // eslint-disable-next-line security/detect-object-injection -- `metodo` es una constante de la tabla de casos
    const res = await nuevoAgente()[metodo](ruta);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/login');
  });

  test.each([
    '/admin/restaurantes', '/admin/restaurantes/1/eliminar', '/admin/cartas/1/eliminar',
    '/admin/categorias/1/eliminar', '/admin/items/1/eliminar', '/admin/comentarios/1/eliminar',
  ])('sin sesión POST %s no hace nada (CSRF/401)', async (ruta) => {
    const agente = nuevoAgente();
    const token = await tokenCsrf(agente);
    const res = await agente.post(ruta).type('form').send({ _csrf: token });
    expect(res.status).toBe(401);
  });

  test('un POST de administrador sin token CSRF se rechaza', async () => {
    const { agente } = await adminConToken();
    const res = await agente.post('/admin/restaurantes/1/eliminar').type('form').send({});
    expect(res.status).toBe(403);
    expect((await nuevoAgente().get('/restaurantes/1')).status).toBe(200);
  });

  test('un POST multipart sin token CSRF se rechaza', async () => {
    const { agente } = await adminConToken();
    const res = await agente.post('/admin/restaurantes').field('nombre', 'x').attach('foto', PNG, 'a.png');
    expect(res.status).toBe(403);
  });
});

describe('panel: CRUD completo', () => {
  test('crear restaurante con imagen, carta, categoría y platillo; se ven en el sitio público', async () => {
    const { agente, token } = await adminConToken();

    const crear = await multipart(agente, '/admin/restaurantes', token, RESTAURANTE, { buffer: PNG, nombre: 'logo.png' });
    expect(crear.status).toBe(303);
    const rid = idDeRedireccion(crear);
    creados.push(rid);

    const detalle = await agente.get(`/admin/restaurantes/${rid}`);
    expect(detalle.status).toBe(200);
    expect(detalle.text).toContain('Café de Prueba');
    expect(detalle.text).toContain('Restaurante creado');
    const foto = detalle.text.match(/src="(\/media\/restaurantes\/\d+\/[0-9a-f]{32}\.png)"/);
    expect(foto).not.toBeNull();

    // la imagen se sirve con cabeceras seguras
    const media = await nuevoAgente().get(foto[1]);
    expect(media.status).toBe(200);
    expect(media.headers['content-type']).toBe('image/png');
    expect(media.headers['x-content-type-options']).toBe('nosniff');
    expect(media.headers['content-security-policy']).toContain('sandbox');

    const carta = await agente.post(`/admin/restaurantes/${rid}/cartas`).type('form').send({ _csrf: token, nombre: 'Almuerzos', orden: '1', visible: 'on' });
    expect(carta.status).toBe(303);
    const { rows: [c] } = await query('SELECT id FROM cartas WHERE restaurante_id = $1', [rid]);

    const cat = await agente.post(`/admin/cartas/${c.id}/categorias`).type('form').send({ _csrf: token, nombre: 'Platos de fondo', visible: 'on' });
    expect(cat.status).toBe(303);
    const { rows: [k] } = await query('SELECT id FROM categorias WHERE carta_id = $1', [c.id]);

    const item = await multipart(agente, `/admin/categorias/${k.id}/items`, token,
      { nombre: 'Lasaña', descripcion: 'Con <b>salsa</b>', precio: '5990', puntuacion: '4', visible: 'on', destacado: 'on' },
      { buffer: PNG, nombre: 'plato.png' });
    expect(item.status).toBe(303);

    const publica = await nuevoAgente().get(`/restaurantes/${rid}`);
    expect(publica.status).toBe(200);
    expect(publica.text).toContain('Lasaña');
    expect(publica.text).toContain('Almuerzos');
    expect(publica.text).not.toContain('<b>salsa</b>'); // el HTML se escapa
    expect(publica.text).toMatch(/src="\/media\/items\/\d+\/[0-9a-f]{32}\.png"/);

    // editar: ocultar el platillo lo saca del sitio público pero no del panel
    const { rows: [it] } = await query('SELECT id FROM items WHERE categoria_id = $1', [k.id]);
    const editar = await multipart(agente, `/admin/items/${it.id}/editar`, token, { nombre: 'Lasaña', precio: '5990', puntuacion: '4' });
    expect(editar.status).toBe(303);
    expect((await nuevoAgente().get(`/restaurantes/${rid}`)).text).not.toContain('Lasaña');
    expect((await agente.get(`/admin/restaurantes/${rid}`)).text).toContain('Lasaña');

    // eliminar platillo, categoría, carta y restaurante (borrado lógico)
    for (const ruta of [`/admin/items/${it.id}/eliminar`, `/admin/categorias/${k.id}/eliminar`, `/admin/cartas/${c.id}/eliminar`]) {
      expect((await agente.post(ruta).type('form').send({ _csrf: token })).status).toBe(303);
    }
    const borrar = await agente.post(`/admin/restaurantes/${rid}/eliminar`).type('form').send({ _csrf: token });
    expect(borrar.status).toBe(303);
    expect((await nuevoAgente().get(`/restaurantes/${rid}`)).status).toBe(404);
    expect((await agente.get(`/admin/restaurantes/${rid}`)).status).toBe(404);
  });

  test('editar y reemplazar la imagen borra la anterior', async () => {
    const { agente, token } = await adminConToken();
    const rid = idDeRedireccion(await multipart(agente, '/admin/restaurantes', token, RESTAURANTE, { buffer: PNG, nombre: 'a.png' }));
    creados.push(rid);
    const { rows: [antes] } = await query('SELECT foto FROM restaurantes WHERE id = $1', [rid]);

    const res = await multipart(agente, `/admin/restaurantes/${rid}/editar`, token, { ...RESTAURANTE, nombre: 'Nombre nuevo' }, { buffer: PNG, nombre: 'b.png' });
    expect(res.status).toBe(303);
    const { rows: [despues] } = await query('SELECT nombre, foto FROM restaurantes WHERE id = $1', [rid]);
    expect(despues.nombre).toBe('Nombre nuevo');
    expect(despues.foto).not.toBe(antes.foto);
    expect((await nuevoAgente().get(`/${antes.foto}`)).status).toBe(404);
    expect((await nuevoAgente().get(`/${despues.foto}`)).status).toBe(200);

    const quitar = await multipart(agente, `/admin/restaurantes/${rid}/editar`, token, { ...RESTAURANTE, quitar_foto: 'on' });
    expect(quitar.status).toBe(303);
    expect((await query('SELECT foto FROM restaurantes WHERE id = $1', [rid])).rows[0].foto).toBeNull();
  });

  test('moderación: el administrador elimina un comentario', async () => {
    const { agente, token } = await adminConToken();
    const { rows: [u] } = await query('SELECT id FROM usuarios LIMIT 1');
    const { rows: [c] } = await query('INSERT INTO comentarios (comentario, usuario_id, restaurante_id) VALUES ($1, $2, 1) RETURNING id', ['spam', u.id]);
    expect((await agente.post(`/admin/comentarios/${c.id}/eliminar`).type('form').send({ _csrf: token })).status).toBe(303);
    expect((await query('SELECT 1 FROM comentarios WHERE id = $1', [c.id])).rowCount).toBe(0);
  });
});

describe('panel: validación y subidas hostiles', () => {
  test('datos inválidos devuelven 422 con los errores y no crean nada', async () => {
    const { agente, token } = await adminConToken();
    const antes = (await query('SELECT count(*)::int AS n FROM restaurantes')).rows[0].n;
    const res = await multipart(agente, '/admin/restaurantes', token, { ...RESTAURANTE, nombre: '', rut: '<script>', email: 'no-es-correo' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('El nombre es obligatorio');
    expect(res.text).toContain('El RUT sólo admite');
    expect(res.text).not.toContain('<script>alert');
    expect((await query('SELECT count(*)::int AS n FROM restaurantes')).rows[0].n).toBe(antes);
  });

  test('el texto del usuario se escapa al volver a mostrarse en el formulario', async () => {
    const { agente, token } = await adminConToken();
    const res = await multipart(agente, '/admin/restaurantes', token, { ...RESTAURANTE, nombre: '"><img src=x onerror=alert(1)>', rut: '' });
    expect(res.status).toBe(422);
    expect(res.text).not.toContain('"><img src=x');
    expect(res.text).toContain('&#34;&gt;&lt;img');
  });

  test('un SVG, un script o un ejecutable disfrazado de imagen se rechazan', async () => {
    const { agente, token } = await adminConToken();
    const malos = [
      { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), nombre: 'x.svg', mime: 'image/svg+xml' },
      { buffer: Buffer.from('<?php system($_GET["c"]); ?>'.padEnd(40, ' ')), nombre: 'shell.png', mime: 'image/png' },
      { buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]), nombre: 'virus.png', mime: 'image/png' },
    ];
    for (const imagen of malos) {
      const res = await multipart(agente, '/admin/restaurantes', token, RESTAURANTE, imagen);
      expect(res.status).toBe(400);
    }
  });

  test('una imagen de más de 2 MB responde 413', async () => {
    const { agente, token } = await adminConToken();
    const grande = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);
    const res = await multipart(agente, '/admin/restaurantes', token, RESTAURANTE, { buffer: grande, nombre: 'grande.png' });
    expect(res.status).toBe(413);
  });

  test.each(['abc', '0', '-1', '1;DROP TABLE items', '99999999999'])('id inválido (%s) en la URL responde 404', async (id) => {
    const { agente } = await adminConToken();
    expect((await agente.get(`/admin/restaurantes/${encodeURIComponent(id)}`)).status).toBe(404);
    expect((await agente.get(`/admin/items/${encodeURIComponent(id)}/editar`)).status).toBe(404);
  });

  test('/media sólo sirve claves con el formato exacto (sin path traversal)', async () => {
    for (const ruta of ['/media/../../package.json', '/media/restaurantes/1/../../../package.json', '/media/restaurantes/1/abc.png', '/media/otra/1/' + 'a'.repeat(32) + '.png']) {
      expect((await nuevoAgente().get(ruta)).status).toBe(404);
    }
  });
});
