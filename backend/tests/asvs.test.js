'use strict';
/**
 * Pruebas de seguridad de la aplicación según OWASP ASVS 5.0.0 (una "ficha" por control).
 * Cada bloque indica: requisito, componente, precondiciones, datos, pasos y resultado esperado.
 * Los resultados observados quedan registrados por Jest (y en el informe, con commit y repetición tras cada corrección).
 */
const bcrypt = require('bcryptjs');
const { nuevoAgente, iniciarSesion, adminConToken } = require('./ayudas');
const { pool, query } = require('../src/db/pool');
const config = require('../src/config');
const Usuario = require('../src/models/usuario.model');
const Restaurante = require('../src/models/restaurante.model');

const CLAVE = 'ClaveDePrueba-123';
const RESTAURANTE = {
  nombre: 'Local de Prueba', rut: '76123456-0', fono: '+56 9 1234 5678', email: 'local@prueba.cl',
  calle: 'Av. Test', numero: '123', comuna: 'Santiago', region: 'Metropolitana',
};
const sufijo = Date.now();
const creados = [];
let duenoA; let duenoB;

async function crearCuenta(nombre) {
  const email = `${nombre}-${sufijo}@prueba.cl`;
  const id = await Usuario.crearDueno({ nombre, email, passwordHash: await bcrypt.hash(CLAVE, config.seguridad.bcryptRondas) });
  return { id, email };
}

/** Inicia sesión como una cuenta y devuelve { agente, token }. */
async function entrar(cuenta) {
  const agente = nuevoAgente();
  const res = await iniciarSesion(agente, { email: cuenta.email, password: CLAVE });
  if (res.status !== 200) throw new Error(`login de ${cuenta.email} falló (${res.status})`);
  return { agente, token: res.body.csrfToken, cookie: res.headers['set-cookie'].find((c) => c.startsWith('pnk.sid=')).split(';')[0] };
}

const enviar = (peticion, token, campos = {}) => {
  let r = peticion.set('X-CSRF-Token', token);
  for (const [k, v] of Object.entries(campos)) r = r.field(k, v);
  return r;
};

beforeAll(async () => {
  duenoA = await crearCuenta('dueno-a');
  duenoB = await crearCuenta('dueno-b');
});

afterAll(async () => {
  for (const id of creados) await query('UPDATE restaurantes SET eliminado = now() WHERE id = $1', [id]);
  await pool.end();
});

afterEach(() => jest.restoreAllMocks());

// ====================================================================================================================
// FICHA 1 · ASVS 2.2.2 — Validación en el servidor
// Componente: POST /api/admin/categorias/:id/items (platillo) · Precondición: dueño autenticado con carta y categoría propias
// Datos: puntuación 4 (permitida, rango 0–5) y puntuación 9 (fuera de rango) · Esperado: 201 y 422; el rechazado NO se guarda
// ====================================================================================================================
describe('ASVS 2.2.2 · validación en el servidor', () => {
  test('un valor permitido se guarda y uno fuera de rango se rechaza (422) sin guardarse', async () => {
    const { agente, token } = await entrar(duenoA);
    const rid = (await enviar(agente.post('/api/admin/restaurantes'), token, RESTAURANTE)).body.id;
    creados.push(rid);
    const cid = (await enviar(agente.post(`/api/admin/restaurantes/${rid}/cartas`), token, { nombre: 'Carta', visible: 'on' })).body.id;
    const kid = (await enviar(agente.post(`/api/admin/cartas/${cid}/categorias`), token, { nombre: 'Fondos', visible: 'on' })).body.id;

    const valido = await enviar(agente.post(`/api/admin/categorias/${kid}/items`), token, { nombre: 'Plato válido', precio: '5000', puntuacion: '4' });
    const invalido = await enviar(agente.post(`/api/admin/categorias/${kid}/items`), token, { nombre: 'Plato inválido', precio: '5000', puntuacion: '9' });

    expect(valido.status).toBe(201);
    expect(invalido.status).toBe(422);
    expect(invalido.body.errores.puntuacion).toMatch(/no puede superar 5/);
    const { rows } = await query("SELECT nombre FROM items WHERE nombre IN ('Plato válido', 'Plato inválido') AND categoria_id = $1", [kid]);
    expect(rows.map((r) => r.nombre)).toEqual(['Plato válido']); // el dato rechazado no se guardó
  });
});

// ====================================================================================================================
// FICHA 2 · ASVS 1.2.4 — Consultas seguras (parametrización)
// Componente: backend/src/models/restaurante.model.js (crear: INSERT ... VALUES ($1, $2, ...)) · Datos: nombre con apóstrofo
// ====================================================================================================================
describe('ASVS 1.2.4 · consultas parametrizadas', () => {
  test('un valor legítimo con apóstrofo se guarda tal cual y una carga de inyección SQL queda como texto inofensivo', async () => {
    const { agente, token } = await entrar(duenoA);
    const legitimo = await enviar(agente.post('/api/admin/restaurantes'), token, { ...RESTAURANTE, nombre: "O'Brien's Grill" });
    expect(legitimo.status).toBe(201);
    creados.push(legitimo.body.id);
    expect((await query('SELECT nombre FROM restaurantes WHERE id = $1', [legitimo.body.id])).rows[0].nombre).toBe("O'Brien's Grill");

    const ataque = "x'); DROP TABLE items; --";
    const res = await enviar(agente.post('/api/admin/restaurantes'), token, { ...RESTAURANTE, nombre: ataque });
    expect(res.status).toBe(201);
    creados.push(res.body.id);
    expect((await query('SELECT nombre FROM restaurantes WHERE id = $1', [res.body.id])).rows[0].nombre).toBe(ataque); // texto literal
    expect((await query("SELECT to_regclass('public.items') AS t")).rows[0].t).not.toBeNull(); // la tabla sigue existiendo
  });
});

// ====================================================================================================================
// FICHA 3 · ASVS V8 — Autorización (V8.2.1 función reservada a un rol · V8.2.2 acceso a datos propios, IDOR/BOLA)
// Componente: controladores de administración (permitir) y rutas /api/admin/usuarios (requiereRol)
// Datos: dos cuentas del mismo rol ("admin") y una cuenta superadmin
// ====================================================================================================================
describe('ASVS V8 · autorización', () => {
  test('dos cuentas del mismo rol: cada una accede a su registro y se le deniega el de la otra (V8.2.2)', async () => {
    const a = await entrar(duenoA);
    const b = await entrar(duenoB);
    const rid = (await enviar(a.agente.post('/api/admin/restaurantes'), a.token, { ...RESTAURANTE, nombre: 'Solo de A' })).body.id;
    creados.push(rid);
    const cid = (await enviar(a.agente.post(`/api/admin/restaurantes/${rid}/cartas`), a.token, { nombre: 'Carta de A', visible: 'on' })).body.id;

    expect((await a.agente.get(`/api/admin/restaurantes/${rid}`)).status).toBe(200); // registro propio
    expect((await b.agente.get(`/api/admin/restaurantes/${rid}`)).status).toBe(403); // registro ajeno
    expect((await b.agente.get(`/api/admin/cartas/${cid}`)).status).toBe(403); // objeto anidado del restaurante ajeno
    expect((await enviar(b.agente.put(`/api/admin/restaurantes/${rid}`), b.token, { ...RESTAURANTE, nombre: 'Robado' })).status).toBe(403);
    expect((await b.agente.delete(`/api/admin/restaurantes/${rid}`).set('X-CSRF-Token', b.token)).status).toBe(403);
    expect((await query('SELECT nombre, eliminado FROM restaurantes WHERE id = $1', [rid])).rows[0]).toMatchObject({ nombre: 'Solo de A', eliminado: null });

    const listaB = await b.agente.get('/api/admin/restaurantes');
    expect(listaB.body.restaurantes.map((r) => r.id)).not.toContain(rid); // ni siquiera aparece en su listado
  });

  test('una acción reservada a otro rol (administrar cuentas) se deniega al dueño y se permite al superadmin (V8.2.1)', async () => {
    const dueno = await entrar(duenoA);
    const intento = await enviar(dueno.agente.post('/api/admin/usuarios'), dueno.token, { nombre: 'Intruso', email: `intruso-${sufijo}@prueba.cl`, password: CLAVE });
    expect(intento.status).toBe(403);
    expect((await dueno.agente.get('/api/admin/usuarios')).status).toBe(403);

    const { agente, token } = await adminConToken(); // superadmin de demostración
    const creada = await agente.post('/api/admin/usuarios').set('X-CSRF-Token', token).send({ nombre: 'Nuevo Dueño', email: `nuevo-${sufijo}@prueba.cl`, password: CLAVE });
    expect(creada.status).toBe(201);
    expect((await agente.get('/api/admin/usuarios')).body.usuarios.map((u) => u.email)).toContain(`nuevo-${sufijo}@prueba.cl`);
    // el superadmin sí puede ver el restaurante de cualquier dueño
    const propio = await entrar(duenoA);
    const rid = (await enviar(propio.agente.post('/api/admin/restaurantes'), propio.token, RESTAURANTE)).body.id;
    creados.push(rid);
    expect((await agente.get(`/api/admin/restaurantes/${rid}`)).status).toBe(200);
  });

  test('la validación de la cuenta nueva exige contraseña de al menos 12 caracteres (V6.2) y no admite correos repetidos', async () => {
    const { agente, token } = await adminConToken();
    const corta = await agente.post('/api/admin/usuarios').set('X-CSRF-Token', token).send({ nombre: 'X', email: `corta-${sufijo}@prueba.cl`, password: 'corta' });
    expect(corta.status).toBe(422);
    expect(corta.body.errores.password).toMatch(/al menos 12/);
    const repetida = await agente.post('/api/admin/usuarios').set('X-CSRF-Token', token).send({ nombre: 'Otra', email: duenoA.email, password: CLAVE });
    expect(repetida.status).toBe(409);
  });
});

// ====================================================================================================================
// FICHA 4 · ASVS V6 y V7 — Autenticación y gestión de sesión
// Componente: auth.controller (login/logout), middlewares/auth.requiereAdmin, sesión en PostgreSQL
// Política de sesión: identificador opaco en cookie HttpOnly; vigencia del administrador 2 h; se invalida al cerrar sesión
// ====================================================================================================================
describe('ASVS V6 y V7 · autenticación y sesión', () => {
  test('operación protegida: antes de iniciar sesión (401), durante la sesión (200) y tras cerrarla (401, también al reutilizar la cookie)', async () => {
    const agente = nuevoAgente();
    expect((await agente.get('/api/admin/restaurantes')).status).toBe(401); // antes

    const login = await iniciarSesion(agente, { email: duenoA.email, password: CLAVE });
    const cookie = login.headers['set-cookie'].find((c) => c.startsWith('pnk.sid=')).split(';')[0];
    expect((await agente.get('/api/admin/restaurantes')).status).toBe(200); // durante

    expect((await agente.post('/api/admin/logout').set('X-CSRF-Token', login.body.csrfToken)).status).toBe(200);
    expect((await agente.get('/api/admin/restaurantes')).status).toBe(401); // después
    const reutilizada = await nuevoAgente().get('/api/admin/restaurantes').set('Cookie', cookie); // el identificador ya no sirve
    expect(reutilizada.status).toBe(401);
  });

  test('vigencia: la cookie de sesión de administrador vence en 2 horas (ADMIN_SESION_HORAS) y es HttpOnly con SameSite=Lax', async () => {
    const login = await iniciarSesion(nuevoAgente(), { email: duenoA.email, password: CLAVE });
    const cookie = login.headers['set-cookie'].find((c) => c.startsWith('pnk.sid='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const vence = new Date(cookie.match(/Expires=([^;]+)/i)[1]).getTime();
    const horas = (vence - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(1.9);
    expect(horas).toBeLessThanOrEqual(config.sesion.duracionAdminMs / 3_600_000 + 0.01);
  });

  test('una cuenta desactivada pierde el acceso de inmediato aunque su sesión siga vigente', async () => {
    const cuenta = await crearCuenta('temporal');
    const { agente } = await entrar(cuenta);
    expect((await agente.get('/api/admin/restaurantes')).status).toBe(200);
    await query('UPDATE usuarios SET activo = false WHERE id = $1', [cuenta.id]);
    expect((await agente.get('/api/admin/restaurantes')).status).toBe(401);
  });
});

// ====================================================================================================================
// FICHA 5 · ASVS 16.5.1 — Manejo de errores
// Componente: middlewares/errores.manejadorErrores · Simulación: el acceso a datos lanza un error con información sensible
// ====================================================================================================================
describe('ASVS 16.5.1 · manejo de errores', () => {
  test('un fallo de acceso a datos devuelve una respuesta controlada, sin trazas, rutas ni credenciales', async () => {
    const sensible = 'connection to 10.0.3.7:5432 refused (user=pnk password=secreto-db) at /app/src/models/restaurante.model.js:12';
    jest.spyOn(Restaurante, 'buscarPorId').mockRejectedValue(new Error(sensible));
    jest.spyOn(console, 'error').mockImplementation(() => {}); // el detalle técnico queda sólo en el registro del servidor

    const res = await nuevoAgente().get('/api/restaurantes/1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Ocurrió un problema al procesar la solicitud.' });
    const texto = JSON.stringify(res.body) + res.text;
    for (const secreto of ['secreto-db', '10.0.3.7', 'restaurante.model.js', 'password', 'stack', 'at ']) expect(texto).not.toContain(secreto);
    expect(console.error).toHaveBeenCalled(); // el error sí se registró en el servidor
  });
});

// ====================================================================================================================
// FICHA 6 · ASVS 16.3.1 — Registro de eventos de seguridad
// Componente: utils/auditoria.registrar (login exitoso y fallido, acceso denegado)
// ====================================================================================================================
describe('ASVS 16.3.1 · registro de eventos', () => {
  const eventos = (espia) => espia.mock.calls.map((c) => { try { return JSON.parse(c[0]); } catch { return null; } }).filter((l) => l?.nivel === 'seguridad');

  test('un inicio de sesión exitoso y otro fallido quedan registrados con fecha, evento y resultado, sin secretos', async () => {
    const espia = jest.spyOn(console, 'log').mockImplementation(() => {});
    const agente = nuevoAgente();
    await iniciarSesion(agente, { email: duenoA.email, password: 'contraseña-incorrecta' });
    await iniciarSesion(nuevoAgente(), { email: duenoA.email, password: CLAVE });

    const lineas = eventos(espia).filter((l) => l.evento === 'login');
    expect(lineas.map((l) => l.resultado)).toEqual(['fallo', 'exito']);
    for (const l of lineas) {
      expect(new Date(l.ts).toISOString()).toBe(l.ts); // fecha ISO válida
      expect(l.usuario).toMatch(/^[0-9a-f]{12}$/); // seudónimo, no el correo
    }
    const crudo = espia.mock.calls.map((c) => c[0]).join('\n');
    for (const secreto of [CLAVE, 'contraseña-incorrecta', duenoA.email]) expect(crudo).not.toContain(secreto);
    expect(lineas[0].ip === undefined || /\.0$/.test(lineas[0].ip)).toBe(true); // IP truncada
  });

  test('un acceso denegado (dueño que pide el restaurante de otro) queda registrado como evento de seguridad', async () => {
    const a = await entrar(duenoA);
    const b = await entrar(duenoB);
    const rid = (await enviar(a.agente.post('/api/admin/restaurantes'), a.token, RESTAURANTE)).body.id;
    creados.push(rid);
    const espia = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect((await b.agente.get(`/api/admin/restaurantes/${rid}`)).status).toBe(403);
    const denegado = eventos(espia).find((l) => l.evento === 'acceso_denegado');
    expect(denegado).toMatchObject({ resultado: 'denegado', ruta: `/api/admin/restaurantes/${rid}` });
  });
});

// ====================================================================================================================
// Trazabilidad del despliegue: /api/version identifica la versión publicada y la instancia que respondió
// ====================================================================================================================
describe('versión publicada', () => {
  test('GET /api/version es dinámico y sin caché, e identifica versión, commit e instancia', async () => {
    const res = await nuevoAgente().get('/api/version');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ version: config.version, commit: config.commit, ambiente: 'test' });
    expect(res.body.instancia).toEqual(expect.any(String));
    expect(new Date(res.body.hora).getTime()).not.toBeNaN();
  });
});
