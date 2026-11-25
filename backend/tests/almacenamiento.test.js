'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { detectarImagen, claveValida, nuevaClave, fotoDeClave, claveDeFoto, mimeDeClave } = require('../src/storage/imagen');
const { crearAlmacenLocal } = require('../src/storage/local');
const { crearAlmacenS3 } = require('../src/storage/s3');

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF'), Buffer.alloc(32)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(32)]);

describe('detección de imágenes por firma (no por nombre ni Content-Type)', () => {
  test('reconoce JPG, PNG y WEBP', () => {
    expect(detectarImagen(JPG)).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    expect(detectarImagen(PNG)).toEqual({ ext: 'png', mime: 'image/png' });
    expect(detectarImagen(WEBP)).toEqual({ ext: 'webp', mime: 'image/webp' });
  });

  test.each([
    ['SVG con script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['HTML', Buffer.from('<html><script>alert(1)</script></html>  ')],
    ['PHP', Buffer.from('<?php system($_GET["c"]); ?>          ')],
    ['ejecutable', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(40)])],
    ['GIF (no permitido)', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)])],
    ['demasiado corto', Buffer.from([0xff, 0xd8])],
    ['vacío', Buffer.alloc(0)],
  ])('rechaza %s', (_n, buf) => expect(detectarImagen(buf)).toBeNull());

  test('rechaza valores que no son Buffer', () => {
    expect(detectarImagen('texto')).toBeNull();
    expect(detectarImagen(null)).toBeNull();
  });
});

describe('claves de almacenamiento', () => {
  test('nuevaClave genera claves válidas, únicas y con el formato esperado', () => {
    const a = nuevaClave('items', 7, 'png');
    const b = nuevaClave('items', 7, 'png');
    expect(a).toMatch(/^items\/7\/[0-9a-f]{32}\.png$/);
    expect(a).not.toBe(b);
    expect(claveValida(a)).toBe(true);
  });

  test.each(['../etc/passwd', 'items/../../x.png', 'items/7/../../a.png', 'items/7/abc.png', 'otra/7/' + 'a'.repeat(32) + '.png',
    'items/0/' + 'a'.repeat(32) + '.png', 'items/7/' + 'a'.repeat(32) + '.svg', '/items/7/' + 'a'.repeat(32) + '.png',
    'items/7/' + 'a'.repeat(32) + '.png/extra', 'items\\7\\' + 'a'.repeat(32) + '.png', 'items/7/' + 'A'.repeat(32) + '.png', '', null, undefined, 7])(
    'rechaza la clave %p', (c) => expect(claveValida(c)).toBe(false));

  test('nuevaClave rechaza carpetas no permitidas', () => {
    expect(() => nuevaClave('../x', 1, 'png')).toThrow();
  });

  test('la foto en la base de datos lleva el prefijo media/ y se revierte a clave', () => {
    const clave = nuevaClave('restaurantes', 3, 'jpg');
    expect(fotoDeClave(clave)).toBe(`media/${clave}`);
    expect(claveDeFoto(`media/${clave}`)).toBe(clave);
    expect(claveDeFoto('resto1.jpg')).toBeNull();            // imagen original del sitio
    expect(claveDeFoto('media/../../etc/passwd')).toBeNull();
    expect(mimeDeClave(clave)).toBe('image/jpeg');
  });
});

describe('almacenamiento local', () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnk-img-')); });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('guarda, lee y borra una imagen', async () => {
    const almacen = crearAlmacenLocal({ directorio: dir });
    const clave = nuevaClave('items', 12, 'png');
    await almacen.guardar(clave, PNG);
    const leida = await almacen.leer(clave);
    expect(leida.contentType).toBe('image/png');
    expect(leida.length).toBe(PNG.length);
    const partes = [];
    for await (const trozo of leida.stream) partes.push(trozo);
    expect(Buffer.concat(partes).equals(PNG)).toBe(true);
    await almacen.borrar(clave);
    expect(await almacen.leer(clave)).toBeNull();
  });

  test('no sobrescribe una imagen existente', async () => {
    const almacen = crearAlmacenLocal({ directorio: dir });
    const clave = nuevaClave('items', 13, 'jpg');
    await almacen.guardar(clave, JPG);
    await expect(almacen.guardar(clave, JPG)).rejects.toThrow();
  });

  test('rechaza claves manipuladas (no puede salir del directorio)', async () => {
    const almacen = crearAlmacenLocal({ directorio: dir });
    await expect(almacen.leer('../../etc/passwd')).rejects.toThrow('inválida');
    await expect(almacen.guardar('items/1/../../../x.png', PNG)).rejects.toThrow('inválida');
    await expect(almacen.borrar('/etc/passwd')).rejects.toThrow('inválida');
  });

  test('una clave válida inexistente devuelve null', async () => {
    const almacen = crearAlmacenLocal({ directorio: dir });
    expect(await almacen.leer(nuevaClave('items', 99, 'png'))).toBeNull();
  });
});

describe('almacenamiento S3 (cliente simulado)', () => {
  const crearCliente = (respuestas = {}) => {
    const enviados = [];
    return { enviados, send: async (cmd) => {
      enviados.push({ tipo: cmd.constructor.name, ...cmd.input });
      const r = respuestas[cmd.constructor.name];
      if (r instanceof Error) throw r;
      return r ?? {};
    } };
  };

  test('exige un bucket', () => {
    expect(() => crearAlmacenS3({ bucket: '', region: 'us-east-1' })).toThrow('S3_BUCKET');
  });

  test('guarda con cifrado, tipo correcto y caché inmutable', async () => {
    const cliente = crearCliente();
    const almacen = crearAlmacenS3({ bucket: 'mi-bucket', region: 'us-east-1', cliente });
    const clave = nuevaClave('restaurantes', 5, 'webp');
    await almacen.guardar(clave, WEBP);
    expect(cliente.enviados[0]).toMatchObject({
      tipo: 'PutObjectCommand', Bucket: 'mi-bucket', Key: clave, ContentType: 'image/webp', ServerSideEncryption: 'AES256',
    });
    expect(cliente.enviados[0].CacheControl).toContain('immutable');
  });

  test('lee un objeto y devuelve null si no existe', async () => {
    const clave = nuevaClave('items', 2, 'jpg');
    const ok = crearAlmacenS3({ bucket: 'b', region: 'x', cliente: crearCliente({ GetObjectCommand: { Body: Readable.from([JPG]), ContentLength: JPG.length } }) });
    const r = await ok.leer(clave);
    expect(r.contentType).toBe('image/jpeg');
    expect(r.length).toBe(JPG.length);

    const noExiste = Object.assign(new Error('x'), { name: 'NoSuchKey' });
    const vacio = crearAlmacenS3({ bucket: 'b', region: 'x', cliente: crearCliente({ GetObjectCommand: noExiste }) });
    expect(await vacio.leer(clave)).toBeNull();
  });

  test('propaga errores distintos de "no existe" (p. ej. permisos)', async () => {
    const denegado = Object.assign(new Error('denegado'), { name: 'AccessDenied' });
    const almacen = crearAlmacenS3({ bucket: 'b', region: 'x', cliente: crearCliente({ GetObjectCommand: denegado }) });
    await expect(almacen.leer(nuevaClave('items', 2, 'jpg'))).rejects.toThrow('denegado');
  });

  test('rechaza claves inválidas antes de llamar a AWS', async () => {
    const cliente = crearCliente();
    const almacen = crearAlmacenS3({ bucket: 'b', region: 'x', cliente });
    await expect(almacen.guardar('../x.png', PNG)).rejects.toThrow('inválida');
    await expect(almacen.leer('otra/cosa')).rejects.toThrow('inválida');
    await expect(almacen.borrar('')).rejects.toThrow('inválida');
    expect(cliente.enviados).toHaveLength(0);
  });

  test('borra el objeto', async () => {
    const cliente = crearCliente();
    const almacen = crearAlmacenS3({ bucket: 'b', region: 'x', cliente });
    const clave = nuevaClave('items', 4, 'png');
    await almacen.borrar(clave);
    expect(cliente.enviados[0]).toMatchObject({ tipo: 'DeleteObjectCommand', Bucket: 'b', Key: clave });
  });
});
