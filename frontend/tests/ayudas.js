'use strict';
// Ayudas para probar el frontend SIN navegador: jsdom carga la página real (los .html de public/) y ejecuta los mismos
// scripts que el navegador, pero con una API "falsa" (fetch simulado) para comprobar qué se dibuja y qué se envía.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUBLIC = path.join(__dirname, '..', 'public');
const leer = (ruta) => fs.readFileSync(path.join(PUBLIC, ruta), 'utf8');

/**
 * Abre una página del sitio. `api` es una función (metodo, ruta, opciones) => { estado?, cuerpo }.
 * Devuelve { window, document, llamadas } donde `llamadas` registra cada petición hecha con fetch.
 */
function abrirPagina(archivoHtml, scripts, { url = 'http://localhost/', api }) {
  const dom = new JSDOM(leer(archivoHtml).replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const llamadas = [];
  window.fetch = async (ruta, opciones = {}) => {
    const metodo = opciones.method || 'GET';
    llamadas.push({ metodo, ruta, cabeceras: opciones.headers || {}, cuerpo: opciones.body });
    const r = await api(metodo, ruta, opciones);
    const estado = r.estado || 200;
    return { ok: estado < 400, status: estado, json: async () => r.cuerpo };
  };
  window.confirm = () => true;
  for (const s of scripts) window.eval(leer(s));
  return { window, document: window.document, llamadas, dom };
}

/** Espera (hasta 2 s) a que se cumpla una condición, dando turno al bucle de eventos. */
async function esperar(condicion, mensaje = 'condición') {
  const limite = Date.now() + 2000;
  while (Date.now() < limite) {
    if (condicion()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Tiempo agotado esperando: ${mensaje}`);
}

module.exports = { abrirPagina, esperar, leer, PUBLIC };
