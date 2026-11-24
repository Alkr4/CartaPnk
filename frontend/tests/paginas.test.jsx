// Pruebas del frontend React SIN navegador ni backend: jsdom + Testing Library dibujan los componentes reales y una API
// "falsa" (fetch simulado) permite comprobar qué se muestra y qué se envía (CSRF, métodos, rutas, anti-XSS).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fijarCsrf, moneda, rutaInterna } from '../src/comun.jsx';
import { Carta } from '../src/carta.jsx';
import { Carrito } from '../src/carrito.jsx';
import { Admin } from '../src/admin.jsx';

const RAIZ = path.join(import.meta.dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const XSS = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';

const datosCarta = {
  restaurante: { id: 1, nombre: `Restobar ${XSS}`, fono: '123', email: 'a@b.cl', calle: 'Calle', numero: '5', comuna: 'Centro', fotoUrl: '/media/restaurantes/1/' + 'a'.repeat(32) + '.png' },
  destacados: [{ id: 9, nombre: 'Destacado', descripcion: 'desc', observaciones: 'obs', tiempo: '10 min', puntuacion: 3, precio: 12500, fotoUrl: null }],
  cartas: [{ id: 1, nombre: 'Almuerzos', categorias: [
    { id: 1, nombre: 'Fondos', items: [
      { id: 5, nombre: `Lomo ${XSS}`, descripcion: 'rico', observaciones: '', tiempo: null, puntuacion: 4, precio: 1234567, fotoUrl: 'javascript:alert(1)' },
      { id: 6, nombre: 'Sopa', descripcion: '', observaciones: '', tiempo: null, puntuacion: 0, precio: 3000, fotoUrl: '//evil.example/x.png' },
    ] },
    { id: 2, nombre: 'Vacía', items: [] },
  ] }, { id: 2, nombre: 'Bebidas', categorias: [] }],
  comentarios: [{ usuario: 'Ana', comentario: `línea 1\n${XSS}` }],
};
const sinSesion = { usuario: null, csrfToken: 't' };

/** Reemplaza fetch: `responder(metodo, ruta, opciones)` -> { estado?, cuerpo }. Devuelve el registro de llamadas. */
function simularApi(responder) {
  const llamadas = [];
  vi.stubGlobal('fetch', async (ruta, op = {}) => {
    const metodo = op.method || 'GET';
    llamadas.push({ metodo, ruta, cabeceras: op.headers || {}, cuerpo: op.body });
    const r = await responder(metodo, ruta, op);
    const estado = r.estado || 200;
    return { ok: estado < 400, status: estado, json: async () => r.cuerpo };
  });
  return llamadas;
}
const irA = (url) => window.history.replaceState(null, '', url);

beforeEach(() => { fijarCsrf(null); delete window.pwned; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Ningún dato de la API se interpretó como HTML. */
function sinXss(container) {
  expect(window.pwned).toBeUndefined();
  expect(container.querySelector('img[src="x"]')).toBeNull();
  expect(container.querySelectorAll('script, [onerror]')).toHaveLength(0);
}

// ---------------------------------------------------------------- utilidades
test('moneda y rutaInterna', () => {
  expect(moneda(12500)).toBe('$ 12.500');
  expect(moneda(1234567)).toBe('$ 1.234.567');
  expect(moneda('abc')).toBe('$ 0');
  expect(rutaInterna('/media/a.png', 'x')).toBe('/media/a.png');
  for (const mala of ['javascript:alert(1)', '//evil.example/a', '/\\evil', 'https://evil.example', null]) expect(rutaInterna(mala, 'x')).toBe('x');
});

// ---------------------------------------------------------------- carta
test('la carta se dibuja con los datos de la API, precios del sitio original y pestañas por carta', async () => {
  irA('/restaurantes/1');
  simularApi((m, ruta) => ({ cuerpo: ruta === '/api/sesion' ? sinSesion : datosCarta }));
  const { container } = render(<Carta />);
  await waitFor(() => expect(container.querySelectorAll('.food-card')).toHaveLength(2));
  expect(document.title).toMatch(/^Restobar/);
  for (const t of ['Menús Destacados', 'Productos Seleccionados', '$ 12.500', '$ 1.234.567', 'No Información para Mostrar']) {
    expect(container.textContent).toContain(t);
  }
  const pestanas = container.querySelectorAll('.nav-tabs .nav-link');
  expect(pestanas).toHaveLength(2);
  fireEvent.click(pestanas[1]);
  expect(pestanas[1].getAttribute('aria-selected')).toBe('true');
  expect(container.querySelector('#carta-2').className).toContain('active');
  expect(container.textContent).toContain('No hay información para Mostrar');
});

test('anti-XSS: nombres y comentarios con HTML se muestran como texto, nunca se interpretan', async () => {
  irA('/restaurantes/1');
  simularApi((m, ruta) => ({ cuerpo: ruta === '/api/sesion' ? sinSesion : datosCarta }));
  const { container } = render(<Carta />);
  await waitFor(() => expect(container.querySelector('.food-card')).not.toBeNull());
  sinXss(container);
  expect(container.textContent).toContain(XSS);
});

test('una URL de imagen que no es ruta interna (javascript:, //otro-sitio) se reemplaza por la imagen por defecto', async () => {
  irA('/restaurantes/1');
  simularApi((m, ruta) => ({ cuerpo: ruta === '/api/sesion' ? sinSesion : datosCarta }));
  const { container } = render(<Carta />);
  await waitFor(() => expect(container.querySelector('.food-card')).not.toBeNull());
  const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
  expect(srcs.every((s) => /^\/[^/]/.test(s))).toBe(true);
});

test('seleccionar un producto envía POST /api/carrito/items con el token CSRF y muestra el aviso', async () => {
  irA('/restaurantes/1');
  const llamadas = simularApi((m, ruta) => {
    if (ruta === '/api/sesion') return { cuerpo: { usuario: null, csrfToken: 'token-123' } };
    if (m === 'POST') return { estado: 201, cuerpo: { ok: true, cantidad: 1 } };
    return { cuerpo: datosCarta };
  });
  const { container } = render(<Carta />);
  await waitFor(() => expect(container.querySelector('.food-card .button')).not.toBeNull());
  fireEvent.click(container.querySelector('.food-card .button'));
  await screen.findByRole('dialog');
  const post = llamadas.find((l) => l.metodo === 'POST');
  expect(post.ruta).toBe('/api/carrito/items');
  expect(post.cabeceras['X-CSRF-Token']).toBe('token-123');
  expect(JSON.parse(post.cuerpo)).toEqual({ itemId: 5 });
  fireEvent.click(screen.getByLabelText('Cerrar'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('en "/" pide primero el id del restaurante', async () => {
  irA('/');
  const llamadas = simularApi((m, ruta) => {
    if (ruta === '/api/restaurantes/primero') return { cuerpo: { id: 1 } };
    return { cuerpo: ruta === '/api/sesion' ? sinSesion : datosCarta };
  });
  const { container } = render(<Carta />);
  await waitFor(() => expect(container.querySelector('.food-card')).not.toBeNull());
  expect(llamadas.map((l) => l.ruta).slice(0, 3)).toEqual(['/api/sesion', '/api/restaurantes/primero', '/api/restaurantes/1']);
});

test('un 404 de la API muestra la pantalla de error del sitio', async () => {
  irA('/restaurantes/999');
  simularApi(() => ({ estado: 404, cuerpo: { error: 'Restaurante no encontrado' } }));
  const { container } = render(<Carta />);
  await screen.findByText('Restaurante no encontrado');
  expect(container.textContent).toContain('404');
  expect(container.querySelector('.volver')).not.toBeNull();
});

test('sin restaurantes creados, "/" muestra un aviso (no una pantalla de error)', async () => {
  irA('/');
  simularApi((m, ruta) => (ruta === '/api/restaurantes/primero' ? { estado: 404, cuerpo: { error: 'Restaurante no encontrado' } } : { cuerpo: sinSesion }));
  const { container } = render(<Carta />);
  await screen.findByText('Aún no hay restaurantes publicados');
  expect(container.querySelector('.volver')).toBeNull();
});

test('el administrador (dueño o superadmin) ve "Ir al panel"; el cliente no ve ningún login', async () => {
  irA('/restaurantes/1');
  for (const rol of ['admin', 'superadmin']) {
    simularApi((m, ruta) => ({ cuerpo: ruta === '/api/sesion' ? { usuario: { nombre: 'Admin', rol }, csrfToken: 't' } : datosCarta }));
    render(<Carta />);
    await screen.findByText('Ir al panel');
    cleanup();
  }
  simularApi((m, ruta) => ({ cuerpo: ruta === '/api/sesion' ? sinSesion : datosCarta }));
  const { container } = render(<Carta />);
  await waitFor(() => expect(container.querySelector('.food-card')).not.toBeNull());
  expect(container.querySelector('input[type=password]')).toBeNull();
  expect(container.textContent).not.toContain('panel');
});

test('con sesión del panel se puede comentar (POST con CSRF y la carta se recarga); el cliente no ve el formulario', async () => {
  irA('/restaurantes/1');
  let comentarios = [];
  const llamadas = simularApi((m, ruta) => {
    if (ruta === '/api/sesion') return { cuerpo: { usuario: { nombre: 'Dueño', rol: 'admin' }, csrfToken: 'tk' } };
    if (m === 'POST') { comentarios = [{ usuario: 'Dueño', comentario: 'Excelente' }]; return { estado: 201, cuerpo: { id: 1 } }; }
    return { cuerpo: { ...datosCarta, comentarios } };
  });
  render(<Carta />);
  await screen.findByText('Aún no hay comentarios.');
  fireEvent.change(screen.getByLabelText('Escribe un comentario'), { target: { value: 'Excelente' } });
  fireEvent.click(screen.getByText('Publicar'));
  await screen.findByText('Excelente', { selector: 'span' });
  const post = llamadas.find((l) => l.metodo === 'POST');
  expect(post.ruta).toBe('/api/restaurantes/1/comentarios');
  expect(post.cabeceras['X-CSRF-Token']).toBe('tk');
  expect(JSON.parse(post.cuerpo)).toEqual({ comentario: 'Excelente' });
  cleanup();

  simularApi((m, ruta) => ({ cuerpo: ruta === '/api/sesion' ? sinSesion : datosCarta }));
  const { container } = render(<Carta />);
  await waitFor(() => expect(container.querySelector('.food-card')).not.toBeNull());
  expect(screen.queryByText('Publicar')).toBeNull();
});

test('un error al comentar (p. ej. 422) se muestra junto al campo', async () => {
  irA('/restaurantes/1');
  simularApi((m, ruta) => {
    if (ruta === '/api/sesion') return { cuerpo: { usuario: { nombre: 'S', rol: 'superadmin' }, csrfToken: 'tk' } };
    if (m === 'POST') return { estado: 422, cuerpo: { error: 'El comentario debe tener entre 1 y 1000 caracteres' } };
    return { cuerpo: datosCarta };
  });
  render(<Carta />);
  fireEvent.change(await screen.findByLabelText('Escribe un comentario'), { target: { value: ' ' } });
  fireEvent.click(screen.getByText('Publicar'));
  await screen.findByText('El comentario debe tener entre 1 y 1000 caracteres');
});

// ---------------------------------------------------------------- carrito
test('el carrito lista los productos y permite quitar uno y vaciar (con CSRF)', async () => {
  irA('/carrito?restaurante=1');
  const items = [{ posicion: 1, id: 5, nombre: `Lomo ${XSS}`, precio: 12500 }, { posicion: 2, id: 2, nombre: 'Sopa', precio: 3000 }];
  const llamadas = simularApi((m, ruta) => {
    if (ruta === '/api/sesion') return { cuerpo: { usuario: null, csrfToken: 'tk' } };
    if (m === 'DELETE') return { cuerpo: { ok: true, cantidad: 0 } };
    return { cuerpo: { restaurante: datosCarta.restaurante, items } };
  });
  const { container } = render(<Carrito />);
  await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(2));
  expect(container.textContent).toContain('$ 12.500');
  sinXss(container);
  expect(llamadas[0].ruta).toBe('/api/carrito?restaurante=1');

  fireEvent.click(container.querySelector('.elim'));
  await waitFor(() => expect(llamadas.some((l) => l.metodo === 'DELETE')).toBe(true));
  const quitar = llamadas.find((l) => l.metodo === 'DELETE');
  expect(quitar.ruta).toBe('/api/carrito/items/1');
  expect(quitar.cabeceras['X-CSRF-Token']).toBe('tk');

  fireEvent.click(container.querySelector('.limpiar'));
  await waitFor(() => expect(llamadas.some((l) => l.metodo === 'DELETE' && l.ruta === '/api/carrito')).toBe(true));
});

// ---------------------------------------------------------------- panel
const restaurantesAdmin = { restaurantes: [{ id: 1, nombre: `Resto ${XSS}`, calle: 'C', numero: '1', comuna: 'X', fono: '1', email: 'e@e.cl', fotoUrl: null, cartas: 2, comentarios: 0 }] };
const sesionDe = (rol) => ({ usuario: { nombre: 'Admin', rol }, csrfToken: 'tk' });

test('panel: sin sesión, o con rol cliente, muestra el login y NO consulta datos del panel', async () => {
  irA('/admin');
  for (const usuario of [null, { nombre: 'Ana', rol: 'cliente' }]) {
    const llamadas = simularApi(() => ({ cuerpo: { usuario, csrfToken: 't' } }));
    render(<Admin />);
    await screen.findByText('Acceso de administración');
    expect(llamadas.some((l) => l.ruta.startsWith('/api/admin'))).toBe(false);
    cleanup();
  }
});

test('panel: login correcto muestra el listado; el texto de la API va escapado', async () => {
  irA('/admin');
  const llamadas = simularApi((m, ruta) => {
    if (ruta === '/api/sesion') return { cuerpo: { usuario: null, csrfToken: 'tk' } };
    if (ruta === '/api/admin/login') return { cuerpo: { usuario: { nombre: 'Admin', rol: 'admin' }, csrfToken: 'tk2' } };
    if (ruta === '/api/admin/restaurantes') return { cuerpo: restaurantesAdmin };
    return { estado: 404, cuerpo: { error: 'no' } };
  });
  const { container } = render(<Admin />);
  fireEvent.change(await screen.findByLabelText('Correo'), { target: { value: 'admin@x.cl' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto' } });
  fireEvent.click(screen.getByText('Ingresar'));
  await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
  const login = llamadas.find((l) => l.ruta === '/api/admin/login');
  expect(JSON.parse(login.cuerpo)).toEqual({ email: 'admin@x.cl', password: 'secreto' });
  expect(login.cabeceras['X-CSRF-Token']).toBe('tk');
  expect(container.textContent).toContain(XSS);
  sinXss(container);
  expect(screen.queryByText('Cuentas')).toBeNull(); // un dueño no ve la gestión de cuentas
});

/** Llena el formulario de restaurante con datos válidos (el navegador deja enviarlo). */
function llenarRestaurante(cambios = {}) {
  const datos = { nombre: 'Mi Resto', rut: '76.123.456-0', fono: '+56 9 1234 5678', calle: 'Calle', numero: 'S/N', comuna: 'La Serena', ...cambios };
  for (const [campo, valor] of Object.entries(datos)) {
    const el = document.querySelector('#f-' + campo);
    fireEvent.change(el, { target: { value: valor } });
    fireEvent.input(el);
  }
}

test('panel: el navegador no envía un formulario inválido (obligatorios, RUT, precio) y marca los campos', async () => {
  irA('/admin#/restaurantes/nuevo');
  const llamadas = simularApi((m, ruta) => (ruta === '/api/sesion' ? { cuerpo: sesionDe('admin') } : { estado: 404, cuerpo: {} }));
  const { container } = render(<Admin />);
  fireEvent.click(await screen.findByText('Guardar'));
  expect(container.querySelector('form').className).toContain('was-validated'); // Bootstrap pinta rojo/verde
  expect(container.querySelector('#f-nombre').validity.valueMissing).toBe(true);

  llenarRestaurante({ rut: '76.123.456-7' }); // dígito verificador incorrecto
  fireEvent.click(screen.getByText('Guardar'));
  expect(container.querySelector('#f-rut').validationMessage).toBe('El dígito verificador no corresponde a este RUT');
  await screen.findByText('El dígito verificador no corresponde a este RUT');
  expect(llamadas.some((l) => l.metodo === 'POST')).toBe(false);
  cleanup();

  // precio: ni negativo ni exagerado
  irA('/admin#/categorias/4/items/nuevo');
  const llamadas2 = simularApi((m, ruta) => {
    if (ruta === '/api/sesion') return { cuerpo: sesionDe('admin') };
    return { cuerpo: { categoria: { id: 4, restaurante_id: 1 } } };
  });
  render(<Admin />);
  const precio = await screen.findByLabelText('Precio ($)');
  fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Plato' } });
  for (const [valor, malo] of [['-500', true], ['1000001', true], ['0', true], ['5990', false]]) {
    fireEvent.change(precio, { target: { value: valor } });
    expect(precio.validity.valid).toBe(!malo);
  }
  expect(precio.min).toBe('1');
  expect(precio.max).toBe('1000000');
  expect(llamadas2.some((l) => l.metodo === 'POST')).toBe(false);
});

test('panel: datos válidos se envían como multipart con CSRF; los errores 422 de la API se muestran en su campo', async () => {
  irA('/admin#/restaurantes/nuevo');
  const llamadas = simularApi((m, ruta) => {
    if (ruta === '/api/sesion') return { cuerpo: sesionDe('admin') };
    if (m === 'POST') return { estado: 422, cuerpo: { error: 'Hay datos que corregir', errores: { nombre: 'Ese nombre ya existe' } } };
    return { estado: 404, cuerpo: {} };
  });
  const { container } = render(<Admin />);
  await screen.findByText('Guardar');
  llenarRestaurante();
  fireEvent.click(screen.getByText('Guardar'));
  await screen.findByText('Ese nombre ya existe');
  const post = llamadas.find((l) => l.metodo === 'POST');
  expect(post.ruta).toBe('/api/admin/restaurantes');
  expect(post.cabeceras['X-CSRF-Token']).toBe('tk');
  expect(post.cuerpo).toBeInstanceOf(FormData);
  expect(post.cuerpo.get('rut')).toBe('76.123.456-0');
  const nombre = container.querySelector('#f-nombre');
  expect(nombre.validity.customError).toBe(true); // marcado en rojo
  fireEvent.input(nombre); // al corregir, el error de la API se quita
  expect(nombre.validity.valid).toBe(true);
});

test('panel: tras cerrar sesión, el siguiente login usa el token CSRF de la sesión nueva', async () => {
  irA('/admin#/');
  let token = 'viejo';
  let conSesion = true;
  const llamadas = simularApi((m, ruta) => {
    if (ruta === '/api/sesion') return { cuerpo: { usuario: conSesion ? { nombre: 'S', rol: 'superadmin' } : null, csrfToken: token } };
    if (ruta === '/api/admin/logout') { conSesion = false; token = 'nuevo'; return { cuerpo: { ok: true } }; }
    if (ruta === '/api/admin/login') return { cuerpo: { usuario: { nombre: 'D', rol: 'admin' }, csrfToken: 'otro' } };
    return { cuerpo: { restaurantes: [] } };
  });
  render(<Admin />);
  fireEvent.click(await screen.findByText('Cerrar sesión'));
  fireEvent.change(await screen.findByLabelText('Correo'), { target: { value: 'd@x.cl' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave-de-prueba' } });
  fireEvent.click(screen.getByText('Ingresar'));
  await waitFor(() => expect(llamadas.some((l) => l.ruta === '/api/admin/login')).toBe(true));
  expect(llamadas.find((l) => l.ruta === '/api/admin/login').cabeceras['X-CSRF-Token']).toBe('nuevo');
});

test('panel: eliminar pide confirmación EN LA PÁGINA (sin confirm del navegador) y usa DELETE con CSRF', async () => {
  irA('/admin#/restaurantes/1');
  const detalle = { restaurante: { id: 1, nombre: 'R', rut: '1-9', fono: '1', email: '', calle: 'C', numero: '1', comuna: 'X', region: '', fotoUrl: null },
    cartas: [{ id: 3, nombre: 'Carta', visible: true, categorias: [] }], comentarios: [{ id: 8, usuario: 'Ana', comentario: 'hola' }] };
  const llamadas = simularApi((m, ruta) => {
    if (ruta === '/api/sesion') return { cuerpo: sesionDe('admin') };
    if (m === 'DELETE') return { cuerpo: { ok: true } };
    return { cuerpo: detalle };
  });
  render(<Admin />);
  await screen.findByText('hola');
  const confirmar = vi.spyOn(window, 'confirm');
  const botones = screen.getAllByText('Eliminar');
  fireEvent.click(botones[botones.length - 1]); // el del comentario
  expect(screen.getByRole('dialog').textContent).toContain('¿Eliminar el comentario?');
  fireEvent.click(screen.getByText('Cancelar'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(llamadas.some((l) => l.metodo === 'DELETE')).toBe(false); // si el usuario cancela no se borra nada
  fireEvent.click(botones[botones.length - 1]);
  fireEvent.keyDown(document, { key: 'Escape' }); // Escape también cancela
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(botones[botones.length - 1]);
  fireEvent.click(screen.getByText('Sí, eliminar'));
  expect(confirmar).not.toHaveBeenCalled();
  await waitFor(() => expect(llamadas.some((l) => l.metodo === 'DELETE')).toBe(true));
  const del = llamadas.find((l) => l.metodo === 'DELETE');
  expect(del.ruta).toBe('/api/admin/comentarios/8');
  expect(del.cabeceras['X-CSRF-Token']).toBe('tk');
  await screen.findByText('Eliminado');
});

test('panel: superadmin ve "Cuentas", crea una cuenta (JSON) y desactiva otra (PATCH)', async () => {
  irA('/admin#/cuentas');
  const usuarios = [
    { id: 1, nombre: 'Super', email: 's@x.cl', rol: 'superadmin', activo: true, restaurantes: 0 },
    { id: 2, nombre: `Dueño ${XSS}`, email: 'd@x.cl', rol: 'admin', activo: true, restaurantes: 1 },
  ];
  const llamadas = simularApi((m, ruta) => {
    if (ruta === '/api/sesion') return { cuerpo: sesionDe('superadmin') };
    if (ruta === '/api/admin/usuarios' && m === 'GET') return { cuerpo: { usuarios } };
    if (m === 'POST') return { estado: 201, cuerpo: { id: 3 } };
    return { cuerpo: { ok: true } };
  });
  const { container } = render(<Admin />);
  await screen.findByText('d@x.cl');
  sinXss(container);
  expect(screen.getAllByText('Desactivar')).toHaveLength(1); // la cuenta superadmin no se puede desactivar desde aquí
  fireEvent.click(screen.getByText('Desactivar'));
  await screen.findByText('Cuenta desactivada');
  const patch = llamadas.find((l) => l.metodo === 'PATCH');
  expect(patch.ruta).toBe('/api/admin/usuarios/2');
  expect(JSON.parse(patch.cuerpo)).toEqual({ activo: false });
  expect(patch.cabeceras['X-CSRF-Token']).toBe('tk');

  window.location.hash = '#/cuentas/nueva';
  fireEvent.change(await screen.findByLabelText(/^Nombre/), { target: { value: 'Nuevo' } });
  fireEvent.change(screen.getByLabelText(/^Correo/), { target: { value: 'n@x.cl' } });
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: 'una-clave-larga' } });
  fireEvent.click(screen.getByText('Guardar'));
  await screen.findByText('Cuenta creada');
  const post = llamadas.find((l) => l.metodo === 'POST');
  expect(post.ruta).toBe('/api/admin/usuarios');
  expect(JSON.parse(post.cuerpo)).toEqual({ nombre: 'Nuevo', email: 'n@x.cl', password: 'una-clave-larga' });
});

test('panel: si la API responde 401 (sesión vencida o cuenta desactivada) vuelve al login', async () => {
  irA('/admin#/');
  simularApi((m, ruta) => (ruta === '/api/sesion' ? { cuerpo: sesionDe('admin') } : { estado: 401, cuerpo: { error: 'La sesión ya no es válida' } }));
  render(<Admin />);
  await screen.findByText('Acceso de administración');
});

test('panel: un 403 de la API (p. ej. dueño que entra a #/cuentas) se muestra como aviso, sin datos', async () => {
  irA('/admin#/cuentas');
  simularApi((m, ruta) => (ruta === '/api/sesion' ? { cuerpo: sesionDe('admin') } : { estado: 403, cuerpo: { error: 'Esta acción está reservada a otro rol' } }));
  const { container } = render(<Admin />);
  await screen.findByText('Esta acción está reservada a otro rol');
  expect(container.querySelector('table')).toBeNull();
});

// ---------------------------------------------------------------- análisis estático (CSP y anti-XSS)
test('las páginas HTML no tienen scripts en línea ni manejadores onclick (compatibles con la CSP de Nginx)', () => {
  for (const f of ['carta.html', 'carrito.html', 'admin.html', 'public/404.html']) {
    const html = leer(f);
    expect(html, f).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    expect(html, f).not.toMatch(/\son\w+\s*=/i);
  }
});

test('el código React no usa dangerouslySetInnerHTML, innerHTML, document.write ni eval', () => {
  for (const f of fs.readdirSync(path.join(RAIZ, 'src'))) {
    expect(leer('src/' + f), f).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|document\.write|insertAdjacentHTML|\beval\(/);
  }
});

test('la configuración de Nginx reenvía /api, /media y /salud a la API y define la CSP', () => {
  const conf = leer('nginx/default.conf');
  for (const ruta of ['location /api/', 'location /media/', 'location = /salud', 'http://back:3000']) expect(conf).toContain(ruta);
  const seg = leer('nginx/seguridad.inc');
  expect(seg).toContain("script-src 'self'");
  expect(seg).toContain("frame-ancestors 'none'");
});
