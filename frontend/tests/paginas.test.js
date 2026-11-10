'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { abrirPagina, esperar, leer, PUBLIC } = require('./ayudas');

const XSS = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';

const datosCarta = {
  restaurante: { id: 1, nombre: `Restobar ${XSS}`, fono: '123', email: 'a@b.cl', calle: 'Calle', numero: '5', comuna: 'Centro', fotoUrl: '/media/restaurantes/1/' + 'a'.repeat(32) + '.png' },
  destacados: [{ id: 9, nombre: 'Destacado', descripcion: 'desc', observaciones: 'obs', tiempo: '10 min', puntuacion: 3, precio: 12500, fotoUrl: null }],
  cartas: [{ id: 1, nombre: 'Almuerzos', categorias: [
    { id: 1, nombre: 'Fondos', items: [
      { id: 5, nombre: `Lomo ${XSS}`, descripcion: 'rico', observaciones: '', tiempo: null, puntuacion: 4, precio: 1234567, fotoUrl: 'javascript:alert(1)' },
      { id: 6, nombre: 'Sopa', descripcion: '', observaciones: '', tiempo: null, puntuacion: 0, precio: 3000, fotoUrl: null },
    ] },
    { id: 2, nombre: 'Vacía', items: [] },
  ] }],
  comentarios: [{ usuario: 'Ana', comentario: `línea 1\n${XSS}` }],
};

// ---------------------------------------------------------------- carta
test('la carta se dibuja con los datos de la API y muestra los precios como el sitio original', async () => {
  const { document } = abrirPagina('carta.html', ['js/comun.js', 'js/carta.js'], {
    url: 'http://localhost/restaurantes/1',
    api: (m, ruta) => (ruta === '/api/sesion' ? { cuerpo: { usuario: null, csrfToken: 't' } } : { cuerpo: datosCarta }),
  });
  await esperar(() => document.querySelector('.food-card'), 'tarjetas de la carta');
  assert.match(document.title, /^Restobar/);
  assert.ok(document.body.textContent.includes('Menús Destacados'));
  assert.ok(document.body.textContent.includes('Productos Seleccionados'));
  assert.ok(document.body.textContent.includes('$ 12.500'));
  assert.ok(document.body.textContent.includes('$ 1.234.567'));
  assert.ok(document.body.textContent.includes('No Información para Mostrar')); // categoría sin ítems
  assert.equal(document.querySelectorAll('.food-card').length, 2);
  assert.equal(document.querySelectorAll('.nav-tabs .nav-link').length, 1);
});

test('anti-XSS: nombres y comentarios con HTML se muestran como texto, nunca se interpretan', async () => {
  const { window, document } = abrirPagina('carta.html', ['js/comun.js', 'js/carta.js'], {
    url: 'http://localhost/restaurantes/1',
    api: (m, ruta) => (ruta === '/api/sesion' ? { cuerpo: { usuario: null, csrfToken: 't' } } : { cuerpo: datosCarta }),
  });
  await esperar(() => document.querySelector('.food-card'));
  assert.equal(window.pwned, undefined);
  assert.equal(document.querySelector('img[src="x"]'), null);
  assert.equal(document.querySelectorAll('#app script').length, 0);
  assert.ok(document.body.textContent.includes(XSS)); // el texto literal está en la página
  assert.equal(document.querySelectorAll('[onerror]').length, 0);
});

test('una URL de imagen que no es ruta interna (javascript:, //otro-sitio) se reemplaza por la imagen por defecto', async () => {
  const { document } = abrirPagina('carta.html', ['js/comun.js', 'js/carta.js'], {
    url: 'http://localhost/restaurantes/1',
    api: (m, ruta) => (ruta === '/api/sesion' ? { cuerpo: { usuario: null, csrfToken: 't' } } : { cuerpo: datosCarta }),
  });
  await esperar(() => document.querySelector('.food-card'));
  const srcs = [...document.querySelectorAll('img')].map((i) => i.getAttribute('src'));
  assert.ok(srcs.every((s) => s.startsWith('/')), `src inesperados: ${srcs}`);
  assert.ok(!srcs.some((s) => s.startsWith('javascript:')));
});

test('seleccionar un producto envía POST /api/carrito/items con el token CSRF', async () => {
  const { document, llamadas } = abrirPagina('carta.html', ['js/comun.js', 'js/carta.js'], {
    url: 'http://localhost/restaurantes/1',
    api: (m, ruta) => {
      if (ruta === '/api/sesion') return { cuerpo: { usuario: null, csrfToken: 'token-123' } };
      if (m === 'POST') return { estado: 201, cuerpo: { ok: true, cantidad: 1 } };
      return { cuerpo: datosCarta };
    },
  });
  await esperar(() => document.querySelector('.food-card .button'));
  document.querySelector('.food-card .button').click();
  await esperar(() => llamadas.some((l) => l.metodo === 'POST'), 'POST del carrito');
  const post = llamadas.find((l) => l.metodo === 'POST');
  assert.equal(post.ruta, '/api/carrito/items');
  assert.equal(post.cabeceras['X-CSRF-Token'], 'token-123');
  assert.deepEqual(JSON.parse(post.cuerpo), { itemId: 5 });
});

test('en "/" pide primero el id del restaurante', async () => {
  const { document, llamadas } = abrirPagina('carta.html', ['js/comun.js', 'js/carta.js'], {
    url: 'http://localhost/',
    api: (m, ruta) => {
      if (ruta === '/api/restaurantes/primero') return { cuerpo: { id: 1 } };
      if (ruta === '/api/sesion') return { cuerpo: { usuario: null, csrfToken: 't' } };
      return { cuerpo: datosCarta };
    },
  });
  await esperar(() => document.querySelector('.food-card'));
  assert.equal(llamadas[0].ruta, '/api/restaurantes/primero');
});

test('un 404 de la API muestra la pantalla de error del sitio', async () => {
  const { document } = abrirPagina('carta.html', ['js/comun.js', 'js/carta.js'], {
    url: 'http://localhost/restaurantes/999',
    api: () => ({ estado: 404, cuerpo: { error: 'Restaurante no encontrado' } }),
  });
  await esperar(() => document.querySelector('.volver'));
  assert.ok(document.body.textContent.includes('404'));
  assert.ok(document.body.textContent.includes('Restaurante no encontrado'));
});

test('el administrador con sesión ve la barra "Ir al panel"; el cliente no ve ningún login', async () => {
  const comoAdmin = abrirPagina('carta.html', ['js/comun.js', 'js/carta.js'], {
    url: 'http://localhost/restaurantes/1',
    api: (m, ruta) => (ruta === '/api/sesion' ? { cuerpo: { usuario: { nombre: 'Admin', rol: 'admin' }, csrfToken: 't' } } : { cuerpo: datosCarta }),
  });
  await esperar(() => comoAdmin.document.querySelector('.food-card'));
  assert.ok(comoAdmin.document.body.textContent.includes('Ir al panel'));

  const cliente = abrirPagina('carta.html', ['js/comun.js', 'js/carta.js'], {
    url: 'http://localhost/restaurantes/1',
    api: (m, ruta) => (ruta === '/api/sesion' ? { cuerpo: { usuario: null, csrfToken: 't' } } : { cuerpo: datosCarta }),
  });
  await esperar(() => cliente.document.querySelector('.food-card'));
  assert.equal(cliente.document.querySelector('input[type=password]'), null);
  assert.ok(!cliente.document.body.textContent.includes('panel'));
});

// ---------------------------------------------------------------- carrito
test('el carrito lista los productos y permite quitar uno y vaciar', async () => {
  const items = [{ posicion: 1, id: 5, nombre: `Lomo ${XSS}`, precio: 12500 }, { posicion: 2, id: 2, nombre: 'Sopa', precio: 3000 }];
  const { document, window, llamadas } = abrirPagina('carrito.html', ['js/comun.js', 'js/carrito.js'], {
    url: 'http://localhost/carrito?restaurante=1',
    api: (m, ruta) => {
      if (ruta === '/api/sesion') return { cuerpo: { usuario: null, csrfToken: 'tk' } };
      if (m === 'DELETE') return { cuerpo: { ok: true, cantidad: 0 } };
      return { cuerpo: { restaurante: datosCarta.restaurante, items } };
    },
  });
  await esperar(() => document.querySelector('table tbody tr'));
  assert.equal(document.querySelectorAll('tbody tr').length, 2);
  assert.ok(document.body.textContent.includes('$ 12.500'));
  assert.equal(window.pwned, undefined);
  assert.equal(document.querySelector('img[src="x"]'), null);
  assert.equal(llamadas[0].ruta, '/api/carrito?restaurante=1');

  document.querySelector('.elim').click();
  await esperar(() => llamadas.some((l) => l.metodo === 'DELETE'));
  const quitar = llamadas.find((l) => l.metodo === 'DELETE');
  assert.equal(quitar.ruta, '/api/carrito/items/1');
  assert.equal(quitar.cabeceras['X-CSRF-Token'], 'tk');

  document.querySelector('.limpiar').click();
  await esperar(() => llamadas.some((l) => l.metodo === 'DELETE' && l.ruta === '/api/carrito'));
});

// ---------------------------------------------------------------- panel
const restaurantesAdmin = { restaurantes: [{ id: 1, nombre: `Resto ${XSS}`, calle: 'C', numero: '1', comuna: 'X', fono: '1', email: 'e@e.cl', fotoUrl: null, cartas: 2, comentarios: 0 }] };

test('panel: sin sesión de administrador muestra el login y NO consulta datos del panel', async () => {
  const { document, llamadas } = abrirPagina('admin.html', ['js/comun.js', 'js/admin.js'], {
    url: 'http://localhost/admin',
    api: () => ({ cuerpo: { usuario: null, csrfToken: 't' } }),
  });
  await esperar(() => document.querySelector('input[type=password]'));
  assert.ok(document.body.textContent.includes('Acceso de administración'));
  assert.ok(!llamadas.some((l) => l.ruta.startsWith('/api/admin')));
});

test('panel: un usuario con rol cliente también ve el login', async () => {
  const { document } = abrirPagina('admin.html', ['js/comun.js', 'js/admin.js'], {
    url: 'http://localhost/admin',
    api: () => ({ cuerpo: { usuario: { nombre: 'Ana', rol: 'cliente' }, csrfToken: 't' } }),
  });
  await esperar(() => document.querySelector('input[type=password]'));
});

test('panel: login correcto muestra el listado; el texto de la API va escapado', async () => {
  let dentro = false;
  const { document, window, llamadas } = abrirPagina('admin.html', ['js/comun.js', 'js/admin.js'], {
    url: 'http://localhost/admin',
    api: (m, ruta) => {
      if (ruta === '/api/sesion') return { cuerpo: { usuario: dentro ? { nombre: 'Admin', rol: 'admin' } : null, csrfToken: 'tk' } };
      if (ruta === '/api/admin/login') { dentro = true; return { cuerpo: { usuario: { nombre: 'Admin', rol: 'admin' }, csrfToken: 'tk2' } }; }
      if (ruta === '/api/admin/restaurantes') return { cuerpo: restaurantesAdmin };
      return { estado: 404, cuerpo: { error: 'no' } };
    },
  });
  await esperar(() => document.querySelector('input[type=password]'));
  document.querySelector('#email').value = 'admin@x.cl';
  document.querySelector('#password').value = 'secreto';
  document.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await esperar(() => document.querySelector('table'), 'listado de restaurantes');
  const login = llamadas.find((l) => l.ruta === '/api/admin/login');
  assert.deepEqual(JSON.parse(login.cuerpo), { email: 'admin@x.cl', password: 'secreto' });
  assert.equal(login.cabeceras['X-CSRF-Token'], 'tk');
  assert.ok(document.body.textContent.includes(XSS));
  assert.equal(window.pwned, undefined);
  assert.equal(document.querySelector('img[src="x"]'), null);
});

test('panel: el formulario envía multipart con el token CSRF y muestra los errores 422 por campo', async () => {
  const { document, window, llamadas } = abrirPagina('admin.html', ['js/comun.js', 'js/admin.js'], {
    url: 'http://localhost/admin#/restaurantes/nuevo',
    api: (m, ruta) => {
      if (ruta === '/api/sesion') return { cuerpo: { usuario: { nombre: 'Admin', rol: 'admin' }, csrfToken: 'tk' } };
      if (m === 'POST') return { estado: 422, cuerpo: { error: 'Hay datos que corregir', errores: { nombre: 'El nombre es obligatorio', rut: 'El RUT no es válido' } } };
      return { estado: 404, cuerpo: {} };
    },
  });
  await esperar(() => document.querySelector('#f-nombre'));
  document.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await esperar(() => document.querySelector('.invalid-feedback'), 'errores de validación');
  const post = llamadas.find((l) => l.metodo === 'POST');
  assert.equal(post.ruta, '/api/admin/restaurantes');
  assert.equal(post.cabeceras['X-CSRF-Token'], 'tk');
  assert.ok(post.cuerpo instanceof window.FormData);
  assert.ok(document.body.textContent.includes('El nombre es obligatorio'));
  assert.ok(document.body.textContent.includes('El RUT no es válido'));
  assert.ok(document.querySelector('#f-nombre').classList.contains('is-invalid'));
});

test('panel: eliminar pide confirmación y usa DELETE con CSRF', async () => {
  const detalle = { restaurante: { id: 1, nombre: 'R', rut: '1-9', fono: '1', email: '', calle: 'C', numero: '1', comuna: 'X', region: '', fotoUrl: null },
    cartas: [{ id: 3, nombre: 'Carta', visible: true, categorias: [] }], comentarios: [{ id: 8, usuario: 'Ana', comentario: 'hola' }] };
  const { document, llamadas, window } = abrirPagina('admin.html', ['js/comun.js', 'js/admin.js'], {
    url: 'http://localhost/admin#/restaurantes/1',
    api: (m, ruta) => {
      if (ruta === '/api/sesion') return { cuerpo: { usuario: { nombre: 'Admin', rol: 'admin' }, csrfToken: 'tk' } };
      if (m === 'DELETE') return { cuerpo: { ok: true } };
      if (ruta === '/api/admin/restaurantes') return { cuerpo: { restaurantes: [] } };
      return { cuerpo: detalle };
    },
  });
  await esperar(() => document.querySelector('.card .btn-outline-danger'));
  let preguntas = 0;
  window.confirm = () => { preguntas += 1; return false; };
  const botones = [...document.querySelectorAll('.btn-outline-danger')];
  botones[botones.length - 1].click(); // el del comentario
  assert.equal(preguntas, 1);
  assert.ok(!llamadas.some((l) => l.metodo === 'DELETE'), 'si el usuario cancela no se borra nada');
  window.confirm = () => true;
  botones[botones.length - 1].click();
  await esperar(() => llamadas.some((l) => l.metodo === 'DELETE'));
  const del = llamadas.find((l) => l.metodo === 'DELETE');
  assert.equal(del.ruta, '/api/admin/comentarios/8');
  assert.equal(del.cabeceras['X-CSRF-Token'], 'tk');
});

// ---------------------------------------------------------------- compatibilidad con la CSP (script-src 'self')
test('las páginas HTML no tienen scripts en línea ni manejadores onclick (compatibles con la CSP de Nginx)', () => {
  for (const f of ['carta.html', 'carrito.html', 'admin.html', '404.html']) {
    const html = leer(f);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, `${f}: script en línea`);
    assert.doesNotMatch(html, /\son\w+\s*=/i, `${f}: manejador en línea`);
  }
});

test('los scripts propios no usan innerHTML/document.write/eval con datos (sólo el SVG constante de los iconos)', () => {
  for (const f of ['js/carta.js', 'js/carrito.js', 'js/admin.js']) {
    assert.doesNotMatch(leer(f), /innerHTML|outerHTML|document\.write|insertAdjacentHTML|\beval\(/, f);
  }
  const comun = leer('js/comun.js');
  assert.equal((comun.match(/innerHTML/g) || []).length, 1, 'comun.js sólo debe usar innerHTML para el SVG constante');
});

test('la configuración de Nginx reenvía /api, /media y /salud a la API y define la CSP', () => {
  const conf = fs.readFileSync(path.join(PUBLIC, '..', 'nginx', 'default.conf'), 'utf8');
  for (const ruta of ['location /api/', 'location /media/', 'location = /salud']) assert.ok(conf.includes(ruta), ruta);
  assert.ok(conf.includes('http://back:3000'));
  const seg = fs.readFileSync(path.join(PUBLIC, '..', 'nginx', 'seguridad.inc'), 'utf8');
  assert.ok(seg.includes("script-src 'self'"));
  assert.ok(seg.includes("frame-ancestors 'none'"));
});
