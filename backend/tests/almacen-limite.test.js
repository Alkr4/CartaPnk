'use strict';
const { AlmacenLimitePostgres } = require('../src/middlewares/almacenLimitePostgres');
const { pool, query } = require('../src/db/pool');

afterAll(() => pool.end());

const unico = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe('almacén del límite de intentos en PostgreSQL (global entre instancias)', () => {
  test('cuenta los intentos dentro de la ventana', async () => {
    const almacen = new AlmacenLimitePostgres('t1:');
    almacen.init({ windowMs: 60_000 });
    const clave = unico('a');
    expect((await almacen.increment(clave)).totalHits).toBe(1);
    expect((await almacen.increment(clave)).totalHits).toBe(2);
    const { resetTime } = await almacen.increment(clave);
    expect(resetTime.getTime()).toBeGreaterThan(Date.now());
  });

  test('es atómico: 25 incrementos simultáneos (como varias instancias a la vez) no pierden cuentas', async () => {
    const almacen = new AlmacenLimitePostgres('t2:');
    almacen.init({ windowMs: 60_000 });
    const clave = unico('b');
    const resultados = await Promise.all(Array.from({ length: 25 }, () => almacen.increment(clave)));
    const cuentas = resultados.map((r) => r.totalHits).sort((x, y) => x - y);
    expect(cuentas).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  test('la ventana se reinicia al vencer', async () => {
    const almacen = new AlmacenLimitePostgres('t3:');
    almacen.init({ windowMs: 150 });
    const clave = unico('c');
    await almacen.increment(clave);
    await almacen.increment(clave);
    await new Promise((r) => { setTimeout(r, 300); });
    expect((await almacen.increment(clave)).totalHits).toBe(1);
  });

  test('decrement resta sin bajar de cero y resetKey borra el contador', async () => {
    const almacen = new AlmacenLimitePostgres('t4:');
    almacen.init({ windowMs: 60_000 });
    const clave = unico('d');
    await almacen.increment(clave);
    await almacen.decrement(clave);
    await almacen.decrement(clave);
    expect((await almacen.increment(clave)).totalHits).toBe(1);
    await almacen.resetKey(clave);
    expect((await almacen.increment(clave)).totalHits).toBe(1);
  });

  test('los prefijos aíslan los contadores y resetAll sólo borra los de su prefijo', async () => {
    const a = new AlmacenLimitePostgres('t5a:');
    const b = new AlmacenLimitePostgres('t5b:');
    a.init({ windowMs: 60_000 });
    b.init({ windowMs: 60_000 });
    const clave = unico('e');
    await a.increment(clave);
    await a.increment(clave);
    expect((await b.increment(clave)).totalHits).toBe(1);
    await a.resetAll();
    const { rows } = await query("SELECT count(*)::int AS n FROM limite_intentos WHERE clave LIKE 't5a:%'");
    expect(rows[0].n).toBe(0);
    expect((await b.increment(clave)).totalHits).toBe(2);
  });
});
