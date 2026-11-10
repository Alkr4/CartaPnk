// Carta digital: pide los datos a la API (GET /api/restaurantes/:id) y dibuja la página.
// Es la misma pantalla que antes generaba el servidor (EJS); ahora la construye el navegador.
(function () {
  'use strict';
  var P = window.PNK;
  var h = P.h;
  var app = document.getElementById('app');

  function estrellas(n) {
    var li = [];
    for (var i = 0; i < n; i += 1) li.push(h('li', null, h('i', { class: 'ti-star' })));
    return h('ul', { class: 'rating-star' }, li);
  }

  function seleccionar(itemId) {
    P.api('POST', '/carrito/items', { itemId: itemId }).then(function () {
      var modal = document.getElementById('myModal');
      if (window.bootstrap && modal) window.bootstrap.Modal.getOrCreateInstance(modal).show();
    }).catch(function (e) {
      document.getElementById('modal-mensaje').textContent = e.message;
      var modal = document.getElementById('myModal');
      if (window.bootstrap && modal) window.bootstrap.Modal.getOrCreateInstance(modal).show();
    });
  }

  function botonSeleccionar(id, estilo) {
    return h('a', {
      class: 'button' + (estilo ? '' : ' float-right'), href: '#', 'data-item-id': id, style: estilo,
      onclick: function (e) { e.preventDefault(); seleccionar(id); }
    }, 'Seleccionar');
  }

  function encabezado(r) {
    var foto = P.rutaInterna(r.fotoUrl, '/img/logo_empresa_comodin.png');
    return h('section', null, h('div', { class: 'container contendor' },
      h('div', { class: 'row' },
        h('div', { class: 'col-lg-4' }, h('div', { style: 'text-align: center;' }, h('div', { class: 'd-flex' },
          h('img', { class: 'logosintituciones', src: '/img/logo.png', width: '190px', alt: '' })))),
        h('div', { class: 'col-lg-4' }, h('div', { style: 'text-align: center;' }, h('div', { class: 'd-flex' },
          h('img', { class: 'logosintituciones', src: foto, width: '170px', alt: '' })))),
        h('div', { class: 'col-lg-4' }, h('div', { class: 'carro' }, h('div', { class: 'd-flex float-end' },
          h('a', { class: 'button_carrito', href: '/carrito?restaurante=' + encodeURIComponent(r.id) },
            P.icono('carrito'), ' Productos Seleccionados'))))),
      h('div', { class: 'row' }, h('div', { class: 'col-lg-12' }, h('div', { class: 'text-center' },
        h('h4', null, r.nombre),
        h('h5', null, P.icono('ubicacion'), ' ' + r.calle + ' #' + r.numero + ', ' + r.comuna),
        h('h5', null,
          r.fono ? [P.icono('telefono'), ' ' + r.fono + ' '] : null,
          r.email ? [P.icono('correo'), ' ' + r.email] : null))))));
  }

  function destacados(lista) {
    if (lista.length === 0) return null;
    return h('section', { class: 'destacados' }, h('div', { class: 'container contendor' },
      h('div', { class: 'section-intro' }, h('h4', { class: 'intro-title' }, 'Menús Destacados')),
      h('div', { class: 'owl-carousel owl-theme featured-carousel' }, lista.map(function (d) {
        return h('div', { class: 'featured-item' },
          h('img', { class: 'card-img rounded-0', width: '350px', height: '235px', alt: '', src: P.rutaInterna(d.fotoUrl, '/img/carta_comodin.png') }),
          h('div', { class: 'item-body' },
            h('h3', null, d.nombre),
            h('p', null, d.descripcion, h('br'), d.observaciones, h('br'), d.tiempo ? [P.icono('alarma'), ' ' + d.tiempo] : null),
            h('div', { class: 'd-flex justify-content-between' }, estrellas(d.puntuacion), h('h3', { class: 'price-tag' }, P.moneda(d.precio))),
            botonSeleccionar(d.id, 'margin:0%')));
      }))));
  }

  function tarjeta(it, ancho) {
    return h('div', { class: ancho }, h('div', { class: 'd-flex align-items-center food-card' },
      h('img', { class: 'me-3 me-sm-4', alt: '', width: '120px', src: P.rutaInterna(it.fotoUrl, '/img/carta_comodin.png') }),
      h('div', { class: 'flex-grow-1' },
        h('div', { class: 'd-flex justify-content-between food-card-title' }, h('h4', null, it.nombre), h('h3', { class: 'price-tag' }, P.moneda(it.precio))),
        h('p', null, it.descripcion, h('br'), it.observaciones),
        it.tiempo ? h('p', null, P.icono('alarma'), ' ' + it.tiempo) : null,
        h('p', null, estrellas(it.puntuacion)),
        botonSeleccionar(it.id))));
  }

  function sinInformacion(titulo) {
    return h('div', { class: 'col-lg-12 ' }, h('div', { class: 'text-center' }, h('h4', null, titulo)));
  }

  function cartas(lista) {
    return h('section', null, h('div', { class: 'container contendor' }, h('div', { class: 'container' }, h('div', { class: 'row' },
      h('div', { class: 'col-lg-12' },
        h('nav', null, h('div', { class: 'nav nav-tabs nav-fill', id: 'nav-tab', role: 'tablist' }, lista.map(function (c, i) {
          return h('a', {
            class: 'nav-item nav-link' + (i === 0 ? ' active' : ''), id: 'nav-carta-' + c.id + '-tab', 'data-bs-toggle': 'tab',
            href: '#carta-' + c.id, role: 'tab', 'aria-controls': 'carta-' + c.id, 'aria-selected': i === 0 ? 'true' : 'false'
          }, c.nombre);
        }))),
        h('div', { class: 'tab-content py-3 px-3 px-sm-0', id: 'nav-tabContent' }, lista.map(function (c, i) {
          return h('div', {
            class: 'tab-pane fade ' + (i === 0 ? 'show active' : ''), id: 'carta-' + c.id, role: 'tabpanel', 'aria-labelledby': 'nav-carta-' + c.id + '-tab'
          }, c.categorias.length === 0
            ? h('div', { class: 'row' }, sinInformacion('No hay información para Mostrar'))
            : c.categorias.map(function (k) {
              return [
                h('div', { class: 'section-intro mb-20px' }, h('h4', { class: 'intro-title' }, k.nombre)),
                h('div', { class: 'row' }, k.items.length > 0
                  ? k.items.map(function (it) { return tarjeta(it, k.items.length > 1 ? 'col-lg-6 ' : 'col-lg-12'); })
                  : sinInformacion('No Información para Mostrar'))
              ];
            }));
        })))))));
  }

  function comentarios(lista) {
    return h('section', null, h('div', { class: 'container contendor' }, h('div', { class: 'container' }, h('div', { class: 'row' },
      h('div', { class: 'col-lg-12' },
        h('div', { class: 'section-intro' }, h('h4', { class: 'intro-title' }, 'Comentarios')), h('br'),
        lista.map(function (c) {
          return [h('div', { class: 'card bg-light' }, h('div', { class: 'card-body' }, h('b', null, c.usuario), h('br'), P.textoMultilinea(c.comentario))), h('br')];
        }),
        h('hr'))))));
  }

  function filaAdmin(sesion) {
    if (!sesion || !sesion.usuario || sesion.usuario.rol !== 'admin') return null;
    return h('nav', { class: 'navbar navbar-light bg-light' },
      h('span', { class: 'ms-2' }, 'Sesión de administrador: ', h('b', null, sesion.usuario.nombre), ' · ', h('a', { href: '/admin' }, 'Ir al panel')));
  }

  async function iniciar() {
    try {
      var coincide = window.location.pathname.match(/^\/restaurantes\/(\d+)\/?$/);
      var id = coincide ? coincide[1] : (await P.api('GET', '/restaurantes/primero')).id;
      var resultados = await Promise.all([P.api('GET', '/restaurantes/' + id), P.api('GET', '/sesion').catch(function () { return null; })]);
      var d = resultados[0];
      document.title = d.restaurante.nombre;
      P.montar(app, [filaAdmin(resultados[1]), encabezado(d.restaurante), destacados(d.destacados), cartas(d.cartas), comentarios(d.comentarios), P.pie(false)]);
      if (window.iniciarCarruseles) window.iniciarCarruseles(); // el carrusel se inicializa cuando ya existe en la página
    } catch (e) {
      document.title = 'Error';
      P.pantallaError(app, e.status || 500, e.message);
    }
  }

  iniciar();
}());
