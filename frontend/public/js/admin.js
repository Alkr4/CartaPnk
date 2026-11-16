// Panel de administración (aplicación de una sola página sin frameworks). Rutas con "#/..." para que el servidor web
// sólo tenga que entregar admin.html. TODA la autorización se hace en la API: esta pantalla sólo muestra u oculta cosas.
(function () {
  'use strict';
  var P = window.PNK;
  var h = P.h;
  var app = document.getElementById('app');
  var aviso = null; // mensaje que se muestra tras guardar { tipo, texto }

  // ------------------------------------------------------------------ piezas de interfaz
  function barra(usuario) {
    return h('nav', { class: 'navbar navbar-dark bg-dark admin-nav' }, h('div', { class: 'container-fluid' },
      h('a', { class: 'navbar-brand', href: '#/' }, 'PNK · Administración'),
      h('div', { class: 'd-flex align-items-center gap-3' },
        h('a', { class: 'text-light small', href: '/', target: '_blank', rel: 'noopener' }, 'Ver sitio público'),
        h('span', { class: 'text-light small' }, usuario.nombre),
        h('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: cerrarSesion }, 'Cerrar sesión'))));
  }

  function pagina(usuario, contenido) {
    var mensaje = aviso;
    aviso = null;
    P.montar(app, [barra(usuario), h('main', { class: 'container admin-main' },
      mensaje ? h('div', { class: 'alert alert-' + mensaje.tipo + ' mt-3', role: 'alert' }, mensaje.texto) : null, contenido)]);
  }

  function irA(ruta, mensaje) {
    if (mensaje) aviso = mensaje;
    if (window.location.hash === '#' + ruta) renderizar(); else window.location.hash = ruta;
  }

  function botonEliminar(texto, ruta, volver) {
    return h('button', {
      class: 'btn btn-sm btn-outline-danger', type: 'button',
      onclick: function () {
        if (!window.confirm(texto)) return;
        P.api('DELETE', ruta).then(function () { irA(volver, { tipo: 'success', texto: 'Eliminado' }); }).catch(mostrarFallo);
      }
    }, 'Eliminar');
  }

  function mostrarFallo(e) {
    if (e.status === 401) { renderizar(); return; }
    aviso = { tipo: 'danger', texto: e.message };
    renderizar();
  }

  function insignia(texto, clase) { return h('span', { class: 'badge ' + clase + ' badge-estado' }, texto); }

  // ------------------------------------------------------------------ formularios declarativos
  /**
   * campos: [{ nombre, etiqueta, tipo: text|number|email|textarea|check|foto, requerido, max, col }]
   * Se envía como multipart/form-data (permite adjuntar imagen); la API valida y responde 422 con { errores }.
   */
  function formulario(opciones) {
    var errores = {};
    var form = h('form', { class: 'card card-body', novalidate: true });
    var zonaError = h('div');

    function pintar() {
      var filas = [];
      opciones.campos.forEach(function (c) {
        var v = opciones.valores && opciones.valores[c.nombre] !== undefined && opciones.valores[c.nombre] !== null ? opciones.valores[c.nombre] : '';
        var id = 'f-' + c.nombre;
        var err = errores[c.nombre];
        var control;
        if (c.tipo === 'check') {
          filas.push(h('div', { class: 'form-check form-switch mb-2' },
            h('input', { class: 'form-check-input', type: 'checkbox', role: 'switch', id: id, name: c.nombre, checked: v === true || v === 'on' }),
            h('label', { class: 'form-check-label', for: id }, c.etiqueta)));
          return;
        }
        if (c.tipo === 'foto') {
          filas.push(h('div', { class: 'mb-3' },
            h('label', { class: 'form-label', for: id }, 'Imagen (JPG, PNG o WEBP, máx. 2 MB)'),
            opciones.fotoUrl ? h('div', { class: 'mb-2' }, h('img', { class: 'thumb-lg', src: P.rutaInterna(opciones.fotoUrl, ''), alt: 'Imagen actual' })) : null,
            h('input', { class: 'form-control', type: 'file', id: id, name: 'foto', accept: 'image/jpeg,image/png,image/webp' }),
            opciones.fotoUrl ? h('div', { class: 'form-check mt-2' },
              h('input', { class: 'form-check-input', type: 'checkbox', id: 'f-quitar', name: 'quitar_foto' }),
              h('label', { class: 'form-check-label', for: 'f-quitar' }, 'Quitar la imagen actual')) : null));
          return;
        }
        var comunes = { class: 'form-control' + (err ? ' is-invalid' : ''), id: id, name: c.nombre, maxlength: c.max, required: c.requerido };
        if (c.tipo === 'textarea') {
          control = h('textarea', Object.assign({ rows: 3 }, comunes), String(v));
        } else {
          control = h('input', Object.assign({ type: c.tipo || 'text', value: String(v) }, comunes));
        }
        filas.push(h('div', { class: 'mb-3 ' + (c.col || '') },
          h('label', { class: 'form-label', for: id }, c.etiqueta + (c.requerido ? ' *' : '')), control,
          err ? h('div', { class: 'invalid-feedback' }, err) : null));
      });
      // los campos con "col" van en filas de Bootstrap; los demás, uno por línea
      var contenido = [];
      var grupo = [];
      filas.forEach(function (f) {
        if (/\bcol-/.test(f.className)) { grupo.push(f); return; }
        if (grupo.length) { contenido.push(h('div', { class: 'row' }, grupo)); grupo = []; }
        contenido.push(f);
      });
      if (grupo.length) contenido.push(h('div', { class: 'row' }, grupo));
      P.montar(form, [zonaError, contenido,
        h('div', { class: 'mt-3' },
          h('button', { class: 'btn btn-dark', type: 'submit' }, 'Guardar'), ' ',
          h('a', { class: 'btn btn-outline-secondary', href: '#' + opciones.volver }, 'Cancelar'))]);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var datos = new FormData(form);
      var valores = {};
      datos.forEach(function (valor, clave) { if (typeof valor === 'string') valores[clave] = valor; });
      opciones.valores = valores; // si hay errores se vuelve a mostrar lo escrito
      var boton = form.querySelector('button[type=submit]');
      boton.disabled = true;
      opciones.enviar(datos).catch(function (err) {
        if (err.status === 422 && err.errores) {
          errores = err.errores;
          pintar();
          form.insertBefore(h('div', { class: 'alert alert-danger py-2', role: 'alert' }, 'Revisa los campos marcados.'), form.firstChild);
        } else {
          boton.disabled = false;
          mostrarFallo(err);
        }
      });
    });
    pintar();
    return form;
  }

  var CAMPOS_RESTAURANTE = [
    { nombre: 'nombre', etiqueta: 'Nombre', requerido: true, max: 200, col: 'col-md-8' },
    { nombre: 'rut', etiqueta: 'RUT', requerido: true, max: 11, col: 'col-md-4' },
    { nombre: 'fono', etiqueta: 'Teléfono', requerido: true, max: 45, col: 'col-md-6' },
    { nombre: 'email', etiqueta: 'Correo', tipo: 'email', max: 100, col: 'col-md-6' },
    { nombre: 'calle', etiqueta: 'Calle', requerido: true, max: 100, col: 'col-md-6' },
    { nombre: 'numero', etiqueta: 'Número', requerido: true, max: 15, col: 'col-md-2' },
    { nombre: 'comuna', etiqueta: 'Comuna', requerido: true, max: 100, col: 'col-md-4' },
    { nombre: 'region', etiqueta: 'Región', max: 100, col: 'col-md-6' },
    { nombre: 'foto', tipo: 'foto' }
  ];
  var CAMPOS_SIMPLES = [
    { nombre: 'nombre', etiqueta: 'Nombre', requerido: true, max: 100 },
    { nombre: 'orden', etiqueta: 'Orden (número menor = primero)', tipo: 'number' },
    { nombre: 'visible', etiqueta: 'Visible en el sitio', tipo: 'check' }
  ];
  var CAMPOS_ITEM = [
    { nombre: 'nombre', etiqueta: 'Nombre', requerido: true, max: 100, col: 'col-md-8' },
    { nombre: 'precio', etiqueta: 'Precio ($)', tipo: 'number', col: 'col-md-4' },
    { nombre: 'descripcion', etiqueta: 'Descripción', tipo: 'textarea', max: 300, col: 'col-12' },
    { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', max: 300, col: 'col-12' },
    { nombre: 'tiempo', etiqueta: 'Tiempo de preparación', max: 100, col: 'col-md-6' },
    { nombre: 'puntuacion', etiqueta: 'Puntuación (0 a 5)', tipo: 'number', col: 'col-md-3' },
    { nombre: 'orden', etiqueta: 'Orden', tipo: 'number', col: 'col-md-3' },
    { nombre: 'visible', etiqueta: 'Visible en el sitio', tipo: 'check' },
    { nombre: 'destacado', etiqueta: 'Destacado (carrusel de menús destacados)', tipo: 'check' },
    { nombre: 'foto', tipo: 'foto' }
  ];

  /** Respuesta de guardado -> volver con aviso (o advertencia si la imagen no se pudo guardar). */
  function guardado(volver, textoOk) {
    return function (r) {
      irA(volver, r && r.advertencia ? { tipo: 'warning', texto: r.advertencia } : { tipo: 'success', texto: textoOk });
    };
  }
  function conChecks(o) { var v = Object.assign({}, o); ['visible', 'destacado'].forEach(function (k) { if (k in v) v[k] = !!v[k]; }); return v; }

  // ------------------------------------------------------------------ pantallas
  async function listaRestaurantes(u) {
    var d = await P.api('GET', '/admin/restaurantes');
    pagina(u, [
      h('div', { class: 'd-flex justify-content-between align-items-center mb-3' },
        h('h1', { class: 'h3 m-0' }, 'Restaurantes'), h('a', { class: 'btn btn-dark', href: '#/restaurantes/nuevo' }, 'Nuevo restaurante')),
      d.restaurantes.length === 0 ? h('p', { class: 'text-muted' }, 'Aún no hay restaurantes. Crea el primero.')
        : h('div', { class: 'table-responsive card card-body p-0' }, h('table', { class: 'table align-middle m-0' },
          h('thead', null, h('tr', null, ['', 'Nombre', 'Dirección', 'Contacto', 'Cartas', 'Comentarios', ''].map(function (t) { return h('th', null, t); }))),
          h('tbody', null, d.restaurantes.map(function (r) {
            return h('tr', null,
              h('td', null, r.fotoUrl ? h('img', { class: 'thumb', src: P.rutaInterna(r.fotoUrl, ''), alt: '' }) : null),
              h('td', null, h('a', { href: '#/restaurantes/' + r.id }, r.nombre)),
              h('td', null, r.calle + ' ' + r.numero + ', ' + r.comuna),
              h('td', null, r.fono, h('br'), h('small', { class: 'text-muted' }, r.email || '')),
              h('td', { class: 'text-end' }, r.cartas), h('td', { class: 'text-end' }, r.comentarios),
              h('td', { class: 'text-end text-nowrap' },
                h('a', { class: 'btn btn-sm btn-outline-dark', href: '#/restaurantes/' + r.id }, 'Administrar'), ' ',
                h('a', { class: 'btn btn-sm btn-outline-secondary', href: '/restaurantes/' + r.id, target: '_blank', rel: 'noopener' }, 'Ver')));
          }))))
    ]);
  }

  function formRestaurante(u, id, datos) {
    var nuevo = !id;
    pagina(u, [h('h1', { class: 'h3 mb-3' }, nuevo ? 'Nuevo restaurante' : 'Editar restaurante'),
      formulario({
        campos: CAMPOS_RESTAURANTE, valores: datos, fotoUrl: datos && datos.fotoUrl, volver: nuevo ? '/' : '/restaurantes/' + id,
        enviar: function (fd) {
          return nuevo
            ? P.api('POST', '/admin/restaurantes', fd).then(function (r) { guardado('/restaurantes/' + r.id, 'Restaurante creado')(r); })
            : P.api('PUT', '/admin/restaurantes/' + id, fd).then(guardado('/restaurantes/' + id, 'Restaurante actualizado'));
        }
      })]);
  }

  async function detalleRestaurante(u, id) {
    var d = await P.api('GET', '/admin/restaurantes/' + id);
    var r = d.restaurante;
    var volver = '/restaurantes/' + id;
    pagina(u, [
      h('nav', { 'aria-label': 'breadcrumb' }, h('ol', { class: 'breadcrumb' },
        h('li', { class: 'breadcrumb-item' }, h('a', { href: '#/' }, 'Restaurantes')), h('li', { class: 'breadcrumb-item active' }, r.nombre))),
      h('div', { class: 'card card-body mb-4' }, h('div', { class: 'd-flex gap-3 align-items-start flex-wrap' },
        r.fotoUrl ? h('img', { class: 'thumb-lg', src: P.rutaInterna(r.fotoUrl, ''), alt: '' }) : null,
        h('div', { class: 'flex-grow-1' },
          h('h1', { class: 'h4' }, r.nombre),
          h('div', { class: 'text-muted small' }, 'RUT ' + r.rut + ' · ' + r.fono + ' · ' + (r.email || '')),
          h('div', { class: 'text-muted small' }, r.calle + ' ' + r.numero + ', ' + r.comuna + ' ' + (r.region || ''))),
        h('div', { class: 'text-nowrap' },
          h('a', { class: 'btn btn-sm btn-outline-dark', href: '#/restaurantes/' + id + '/editar' }, 'Editar'), ' ',
          botonEliminar('¿Eliminar el restaurante? Dejará de verse en el sitio.', '/admin/restaurantes/' + id, '/')))),
      h('div', { class: 'd-flex justify-content-between align-items-center mb-2' },
        h('h2', { class: 'h5 m-0' }, 'Cartas'), h('a', { class: 'btn btn-sm btn-dark', href: '#/restaurantes/' + id + '/cartas/nueva' }, 'Nueva carta')),
      d.cartas.length === 0 ? h('p', { class: 'text-muted' }, 'Sin cartas todavía.') : null,
      d.cartas.map(function (c) {
        return h('div', { class: 'card card-body' },
          h('div', { class: 'd-flex justify-content-between align-items-center flex-wrap gap-2' },
            h('strong', null, c.nombre, ' ', c.visible ? null : insignia('oculta', 'bg-secondary')),
            h('div', null,
              h('a', { class: 'btn btn-sm btn-outline-dark', href: '#/cartas/' + c.id + '/categorias/nueva' }, 'Nueva categoría'), ' ',
              h('a', { class: 'btn btn-sm btn-outline-secondary', href: '#/cartas/' + c.id + '/editar' }, 'Editar'), ' ',
              botonEliminar('¿Eliminar la carta?', '/admin/cartas/' + c.id, volver))),
          c.categorias.map(function (k) {
            return h('div', { class: 'tree-level-1 mt-3' },
              h('div', { class: 'd-flex justify-content-between align-items-center flex-wrap gap-2' },
                h('span', null, k.nombre, ' ', k.visible ? null : insignia('oculta', 'bg-secondary')),
                h('div', null,
                  h('a', { class: 'btn btn-sm btn-outline-dark', href: '#/categorias/' + k.id + '/items/nuevo' }, 'Nuevo platillo'), ' ',
                  h('a', { class: 'btn btn-sm btn-outline-secondary', href: '#/categorias/' + k.id + '/editar' }, 'Editar'), ' ',
                  botonEliminar('¿Eliminar la categoría?', '/admin/categorias/' + k.id, volver))),
              k.items.map(function (it) {
                return h('div', { class: 'tree-level-2 mt-2 d-flex justify-content-between align-items-center flex-wrap gap-2' },
                  h('span', { class: 'd-flex align-items-center gap-2' },
                    it.fotoUrl ? h('img', { class: 'thumb', src: P.rutaInterna(it.fotoUrl, ''), alt: '' }) : null,
                    h('span', null, it.nombre, ' ',
                      it.precio !== null ? h('small', { class: 'text-muted' }, P.moneda(it.precio)) : null, ' ',
                      it.destacado ? insignia('destacado', 'bg-warning text-dark') : null, ' ',
                      it.visible ? null : insignia('oculto', 'bg-secondary'))),
                  h('div', null,
                    h('a', { class: 'btn btn-sm btn-outline-secondary', href: '#/items/' + it.id + '/editar' }, 'Editar'), ' ',
                    botonEliminar('¿Eliminar el platillo?', '/admin/items/' + it.id, volver)));
              }));
          }));
      }),
      h('h2', { class: 'h5 mt-4' }, 'Comentarios (' + d.comentarios.length + ')'),
      d.comentarios.length === 0 ? h('p', { class: 'text-muted' }, 'Sin comentarios.') : null,
      d.comentarios.map(function (c) {
        return h('div', { class: 'card card-body d-flex flex-row justify-content-between align-items-start gap-3' },
          h('div', null, h('strong', null, c.usuario), h('div', null, P.textoMultilinea(c.comentario))),
          botonEliminar('¿Eliminar el comentario?', '/admin/comentarios/' + c.id, volver));
      })
    ]);
  }

  function formSimple(u, titulo, valores, volver, enviar) {
    pagina(u, [h('h1', { class: 'h3 mb-3' }, titulo),
      formulario({ campos: CAMPOS_SIMPLES, valores: valores, volver: volver, enviar: enviar })]);
  }

  function formItem(u, titulo, valores, volver, enviar) {
    pagina(u, [h('h1', { class: 'h3 mb-3' }, titulo),
      formulario({ campos: CAMPOS_ITEM, valores: valores, fotoUrl: valores && valores.fotoUrl, volver: volver, enviar: enviar })]);
  }

  // ------------------------------------------------------------------ rutas
  var RUTAS = [
    [/^\/$/, function (u) { return listaRestaurantes(u); }],
    [/^\/restaurantes\/nuevo$/, function (u) { formRestaurante(u, null, { }); }],
    [/^\/restaurantes\/(\d+)$/, function (u, m) { return detalleRestaurante(u, m[1]); }],
    [/^\/restaurantes\/(\d+)\/editar$/, async function (u, m) { formRestaurante(u, m[1], (await P.api('GET', '/admin/restaurantes/' + m[1])).restaurante); }],
    [/^\/restaurantes\/(\d+)\/cartas\/nueva$/, function (u, m) {
      formSimple(u, 'Nueva carta', { visible: true }, '/restaurantes/' + m[1], function (fd) {
        return P.api('POST', '/admin/restaurantes/' + m[1] + '/cartas', fd).then(guardado('/restaurantes/' + m[1], 'Carta creada'));
      });
    }],
    [/^\/cartas\/(\d+)\/editar$/, async function (u, m) {
      var c = (await P.api('GET', '/admin/cartas/' + m[1])).carta;
      var volver = '/restaurantes/' + c.restaurante_id;
      formSimple(u, 'Editar carta', conChecks(c), volver, function (fd) { return P.api('PUT', '/admin/cartas/' + m[1], fd).then(guardado(volver, 'Carta actualizada')); });
    }],
    [/^\/cartas\/(\d+)\/categorias\/nueva$/, async function (u, m) {
      var c = (await P.api('GET', '/admin/cartas/' + m[1])).carta;
      var volver = '/restaurantes/' + c.restaurante_id;
      formSimple(u, 'Nueva categoría', { visible: true }, volver, function (fd) { return P.api('POST', '/admin/cartas/' + m[1] + '/categorias', fd).then(guardado(volver, 'Categoría creada')); });
    }],
    [/^\/categorias\/(\d+)\/editar$/, async function (u, m) {
      var c = (await P.api('GET', '/admin/categorias/' + m[1])).categoria;
      var volver = '/restaurantes/' + c.restaurante_id;
      formSimple(u, 'Editar categoría', conChecks(c), volver, function (fd) { return P.api('PUT', '/admin/categorias/' + m[1], fd).then(guardado(volver, 'Categoría actualizada')); });
    }],
    [/^\/categorias\/(\d+)\/items\/nuevo$/, async function (u, m) {
      var c = (await P.api('GET', '/admin/categorias/' + m[1])).categoria;
      var volver = '/restaurantes/' + c.restaurante_id;
      formItem(u, 'Nuevo platillo', { visible: true }, volver, function (fd) { return P.api('POST', '/admin/categorias/' + m[1] + '/items', fd).then(guardado(volver, 'Platillo creado')); });
    }],
    [/^\/items\/(\d+)\/editar$/, async function (u, m) {
      var it = (await P.api('GET', '/admin/items/' + m[1])).item;
      var volver = '/restaurantes/' + it.restaurante_id;
      formItem(u, 'Editar platillo', conChecks(it), volver, function (fd) { return P.api('PUT', '/admin/items/' + m[1], fd).then(guardado(volver, 'Platillo actualizado')); });
    }]
  ];

  // ------------------------------------------------------------------ acceso
  function pantallaLogin(mensajeError) {
    var form = h('form', { novalidate: true },
      mensajeError ? h('div', { class: 'alert alert-danger py-2', role: 'alert' }, mensajeError) : null,
      h('div', { class: 'mb-3' }, h('label', { class: 'form-label', for: 'email' }, 'Correo'),
        h('input', { class: 'form-control', type: 'email', id: 'email', name: 'email', maxlength: '255', autocomplete: 'username', required: true, autofocus: true })),
      h('div', { class: 'mb-3' }, h('label', { class: 'form-label', for: 'password' }, 'Contraseña'),
        h('input', { class: 'form-control', type: 'password', id: 'password', name: 'password', maxlength: '1024', autocomplete: 'current-password', required: true })),
      h('button', { type: 'submit', class: 'btn btn-dark w-100' }, 'Ingresar'));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var cuerpo = { email: form.querySelector('#email').value, password: form.querySelector('#password').value };
      P.api('POST', '/admin/login', cuerpo).then(function (r) {
        // la sesión se renueva al entrar: se pide el token CSRF nuevo
        P.fijarCsrf(r.csrfToken);
        window.location.hash = '#/';
        renderizar();
      }).catch(function (err) { pantallaLogin(err.message); });
    });
    P.montar(app, h('div', { class: 'container' }, h('div', { class: 'row justify-content-center' }, h('div', { class: 'col-sm-8 col-md-5 col-lg-4' },
      h('div', { class: 'card login-card shadow-sm' }, h('div', { class: 'card-body p-4' },
        h('div', { class: 'text-center mb-3' }, h('img', { src: '/img/logo.png', width: '150', alt: '' })),
        h('h1', { class: 'h5 text-center mb-3' }, 'Acceso de administración'), form))))));
  }

  function cerrarSesion() {
    P.api('POST', '/admin/logout').finally(function () { window.location.hash = '#/'; pantallaLogin(); });
  }

  // ------------------------------------------------------------------ arranque
  async function renderizar() {
    var sesion;
    try { sesion = await P.cargarSesion(); } catch (e) { P.pantallaError(app, e.status || 500, e.message); return; }
    if (!sesion.usuario || sesion.usuario.rol !== 'admin') { pantallaLogin(); return; }
    var ruta = window.location.hash.replace(/^#/, '') || '/';
    for (var i = 0; i < RUTAS.length; i += 1) {
      var m = ruta.match(RUTAS[i][0]);
      if (m) {
        try { await RUTAS[i][1](sesion.usuario, m); } catch (e) {
          if (e.status === 401) { pantallaLogin(); return; }
          pagina(sesion.usuario, h('div', { class: 'alert alert-danger mt-3' }, e.message, ' ', h('a', { href: '#/' }, 'Volver al inicio')));
        }
        return;
      }
    }
    pagina(sesion.usuario, h('p', null, 'Pantalla no encontrada. ', h('a', { href: '#/' }, 'Volver al inicio')));
  }

  window.addEventListener('hashchange', renderizar);
  renderizar();
}());
