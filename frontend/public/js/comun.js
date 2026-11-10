// Utilidades comunes del frontend (JavaScript sin frameworks). Todo el contenido que viene de la API se inserta como
// NODOS DE TEXTO (nunca como HTML), así que un nombre o comentario con "<script>" se muestra tal cual y no se ejecuta (anti-XSS).
(function (g) {
  'use strict';

  // ------------------------------------------------------------------ DOM seguro
  function agregarHijo(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { agregarHijo(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  /** h('div', { class: 'x', onclick: fn }, 'texto', otroNodo) — crea un elemento; los textos nunca se interpretan como HTML. */
  function h(tag, props) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i += 1) agregarHijo(el, arguments[i]);
    return el;
  }

  /** Vacía un contenedor y pone el contenido nuevo. */
  function montar(contenedor, contenido) {
    while (contenedor.firstChild) contenedor.removeChild(contenedor.firstChild);
    agregarHijo(contenedor, contenido);
  }

  /** Texto con saltos de línea -> nodos de texto separados por <br> (equivale a nl2br(htmlspecialchars())). */
  function textoMultilinea(texto) {
    var frag = document.createDocumentFragment();
    String(texto).split(/\r\n|\r|\n/).forEach(function (linea, i) {
      if (i > 0) frag.appendChild(document.createElement('br'));
      frag.appendChild(document.createTextNode(linea));
    });
    return frag;
  }

  /** Sólo se aceptan rutas internas ("/media/…", "/imagenes/…") para src/href que vienen de la API. */
  function rutaInterna(url, porDefecto) {
    return typeof url === 'string' && /^\/[^/\\]/.test(url) ? url : porDefecto;
  }

  // ------------------------------------------------------------------ formato
  /** 12500 -> "$ 12.500" (igual que el sitio original). */
  function moneda(n) {
    var v = Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0;
    return '$ ' + (v < 0 ? '-' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // ------------------------------------------------------------------ iconos (SVG constantes, sin datos del usuario)
  var SVG = {
    alarma: '<svg width="1em" height="1em" viewBox="0 0 16 16" class="bi bi-alarm" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M6.5 0a.5.5 0 0 0 0 1H7v1.07a7.001 7.001 0 0 0-3.273 12.474l-.602.602a.5.5 0 0 0 .707.708l.746-.746A6.97 6.97 0 0 0 8 16a6.97 6.97 0 0 0 3.422-.892l.746.746a.5.5 0 0 0 .707-.708l-.601-.602A7.001 7.001 0 0 0 9 2.07V1h.5a.5.5 0 0 0 0-1h-3zm1.038 3.018a6.093 6.093 0 0 1 .924 0 6 6 0 1 1-.924 0zM8.5 5.5a.5.5 0 0 0-1 0v3.362l-1.429 2.38a.5.5 0 1 0 .858.515l1.5-2.5A.5.5 0 0 0 8.5 9V5.5zM0 3.5c0 .753.333 1.429.86 1.887A8.035 8.035 0 0 1 4.387 1.86 2.5 2.5 0 0 0 0 3.5zM13.5 1c-.753 0-1.429.333-1.887.86a8.035 8.035 0 0 1 3.527 3.527A2.5 2.5 0 0 0 13.5 1z"/></svg>',
    basurero: '<svg width="2em" height="2em" viewBox="0 0 16 16" class="bi bi-trash-fill text-danger" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1H2.5zm3 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5zM8 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 8 5zm3 .5a.5.5 0 0 0-1 0v7a.5.5 0 0 0 1 0v-7z"/></svg>',
    carrito: '<svg width="2em" height="2em" viewBox="0 0 16 16" class="bi bi-cart4" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M0 2.5A.5.5 0 0 1 .5 2H2a.5.5 0 0 1 .485.379L2.89 4H14.5a.5.5 0 0 1 .485.621l-1.5 6A.5.5 0 0 1 13 11H4a.5.5 0 0 1-.485-.379L1.61 3H.5a.5.5 0 0 1-.5-.5zM3.14 5l.5 2H5V5H3.14zM6 5v2h2V5H6zm3 0v2h2V5H9zm3 0v2h1.36l.5-2H12zm1.11 3H12v2h.61l.5-2zM11 8H9v2h2V8zM8 8H6v2h2V8zM5 8H3.89l.5 2H5V8zm0 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-2 1a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm9-1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-2 1a2 2 0 1 1 4 0 2 2 0 0 1-4 0z"/></svg>',
    correo: '<svg width="1em" height="1em" viewBox="0 0 16 16" class="bi bi-envelope-fill" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M.05 3.555A2 2 0 0 1 2 2h12a2 2 0 0 1 1.95 1.555L8 8.414.05 3.555zM0 4.697v7.104l5.803-3.558L0 4.697zM6.761 8.83l-6.57 4.027A2 2 0 0 0 2 14h12a2 2 0 0 0 1.808-1.144l-6.57-4.027L8 9.586l-1.239-.757zm3.436-.586L16 11.801V4.697l-5.803 3.546z"/></svg>',
    telefono: '<svg width="1em" height="1em" viewBox="0 0 16 16" class="bi bi-telephone-fill" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M2.267.98a1.636 1.636 0 0 1 2.448.152l1.681 2.162c.309.396.418.913.296 1.4l-.513 2.053a.636.636 0 0 0 .167.604L8.65 9.654a.636.636 0 0 0 .604.167l2.052-.513a1.636 1.636 0 0 1 1.401.296l2.162 1.681c.777.604.849 1.753.153 2.448l-.97.97c-.693.693-1.73.998-2.697.658a17.47 17.47 0 0 1-6.571-4.144A17.47 17.47 0 0 1 .639 4.646c-.34-.967-.035-2.004.658-2.698l.97-.969z"/></svg>',
    ubicacion: '<svg width="1em" height="1em" viewBox="0 0 16 16" class="bi bi-geo-alt" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M12.166 8.94C12.696 7.867 13 6.862 13 6A5 5 0 0 0 3 6c0 .862.305 1.867.834 2.94.524 1.062 1.234 2.12 1.96 3.07A31.481 31.481 0 0 0 8 14.58l.208-.22a31.493 31.493 0 0 0 1.998-2.35c.726-.95 1.436-2.008 1.96-3.07zM8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10z"/><path fill-rule="evenodd" d="M8 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>'
  };
  /** Devuelve un nodo <svg> (el texto del SVG es una constante de este archivo). */
  function icono(nombre) {
    var plantilla = document.createElement('template');
    plantilla.innerHTML = SVG[nombre]; // constante: no contiene datos del usuario
    return plantilla.content.firstElementChild;
  }

  // ------------------------------------------------------------------ API
  var csrf = null;

  /** Estado de la sesión (usuario o null) y token CSRF. */
  async function cargarSesion() {
    var res = await fetch('/api/sesion', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    var d = await res.json();
    csrf = d.csrfToken;
    return d;
  }

  /**
   * Llama a la API (mismo origen: /api/…). Las peticiones que cambian estado envían el token CSRF en X-CSRF-Token.
   * `cuerpo` puede ser un objeto (JSON) o un FormData (formularios con imagen).
   * Lanza Error con .status y, si la API lo informa, .errores = { campo: mensaje }.
   */
  async function api(metodo, ruta, cuerpo) {
    var opciones = { method: metodo, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (metodo !== 'GET') {
      if (!csrf) await cargarSesion();
      opciones.headers['X-CSRF-Token'] = csrf;
    }
    if (typeof FormData !== 'undefined' && cuerpo instanceof FormData) {
      opciones.body = cuerpo;
    } else if (cuerpo !== undefined) {
      opciones.headers['Content-Type'] = 'application/json';
      opciones.body = JSON.stringify(cuerpo);
    }
    var res = await fetch('/api' + ruta, opciones);
    var datos = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var err = new Error(datos.error || 'Error ' + res.status);
      err.status = res.status;
      err.errores = datos.errores;
      throw err;
    }
    return datos;
  }
  function fijarCsrf(token) { csrf = token; }

  // ------------------------------------------------------------------ pantalla de error (igual a la del sitio original)
  function pantallaError(contenedor, estado, mensaje) {
    montar(contenedor, h('section', null,
      h('div', { class: 'container contendor' },
        h('div', { class: 'row' },
          h('div', { class: 'col-lg-12 text-center', style: 'padding: 80px 0;' },
            h('img', { class: 'logosintituciones', src: '/img/logo.png', width: '170px', alt: '' }), h('br'), h('br'),
            h('h4', { class: 'intro-title', style: 'text-align: center' }, estado),
            h('h4', null, mensaje), h('br'),
            h('a', { class: 'volver', href: '/' }, 'Volver al inicio'))))));
  }

  /** Pie de página de la carta. */
  function pie(conLinea) {
    return h('footer', { class: conLinea ? 'container contendor' : 'footer-area section-gap' }, h('br'), conLinea ? h('hr') : null,
      h('div', { class: 'container' },
        h('div', { class: 'footer-bottom row align-items-center text-center' },
          h('p', { class: 'footer-text m-0 col-md-12' },
            'Copyright 2020, Todos los Derechos reservados PNK, ', h('br'),
            'Sitio desarrollado para la Explotación de Vulnerabilidades Web, Laboratorio de Programación Segura I', h('br'),
            h('b', null, 'Área Tecnologías de Información y Ciberseguridad - Inacap Sede La Serena'), h('br'), h('br')))));
  }

  g.PNK = {
    h: h, montar: montar, textoMultilinea: textoMultilinea, rutaInterna: rutaInterna, moneda: moneda, icono: icono,
    api: api, cargarSesion: cargarSesion, fijarCsrf: fijarCsrf, pantallaError: pantallaError, pie: pie
  };
}(window));
