// Carrito: lista los productos de la sesión (GET /api/carrito) y permite quitarlos o vaciar el pedido.
(function () {
  'use strict';
  var P = window.PNK;
  var h = P.h;
  var app = document.getElementById('app');
  var restauranteId = new URLSearchParams(window.location.search).get('restaurante');

  function recargar() { iniciar(); }

  function quitar(posicion) {
    P.api('DELETE', '/carrito/items/' + encodeURIComponent(posicion)).then(recargar).catch(mostrarError);
  }
  function vaciar() {
    P.api('DELETE', '/carrito').then(recargar).catch(mostrarError);
  }
  function mostrarError(e) { P.pantallaError(app, e.status || 500, e.message); }

  function dibujar(r, items) {
    var foto = P.rutaInterna(r.fotoUrl, '/img/logo_empresa_comodin.png');
    P.montar(app, [
      h('section', null, h('div', { class: 'container contendor' }, h('div', { class: 'row' },
        h('div', { class: 'col-lg-4' }, h('div', { style: 'text-align: center;' },
          h('div', { class: 'd-flex' }, h('img', { class: 'logosintituciones', src: '/img/logo.png', width: '170px', alt: '' })), h('br'), h('br'))),
        h('div', { class: 'col-lg-4' }, h('div', { style: 'text-align: center;' },
          h('img', { class: 'logosintituciones', src: foto, width: '170px', alt: '' }))),
        h('div', { class: 'col-lg-4' }, h('div', { class: 'carro' }, h('div', { class: 'd-flex float-end' },
          h('a', { class: 'volver', href: '/restaurantes/' + encodeURIComponent(r.id) }, 'Volver a la Carta'), '  ',
          h('a', { class: 'limpiar', href: '#', onclick: function (e) { e.preventDefault(); vaciar(); } }, 'Eliminar Todo'))))))),
      h('section', null, h('div', { class: 'container contendor' }, h('div', { class: 'row' }, h('div', { class: 'col-lg-12' },
        h('h4', { class: 'intro-title', style: 'text-align: center' }, 'Productos Agregados para Solicitar'))))),
      h('section', null, h('div', { class: 'container contendor' }, h('div', { class: 'row' }, h('div', { class: 'col-lg-12' },
        h('table', { class: 'table table-hover table-lg' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Código'), h('th', { scope: 'col' }, 'Producto'), h('th', { scope: 'col' }, 'Precios'), h('th', { scope: 'col' }, 'Acción'))),
          h('tbody', null, items.map(function (p) {
            return h('tr', null,
              h('th', { scope: 'row' }, p.id), h('td', null, p.nombre), h('td', null, P.moneda(p.precio)),
              h('td', null, h('a', { class: 'elim', 'data-posicion': p.posicion, href: '#', onclick: function (e) { e.preventDefault(); quitar(p.posicion); } }, P.icono('basurero'))));
          }))),
        h('div', null, h('hr'), h('br'), h('h3', { class: 'price-tag text-center' }, '¡¡¡Si estas listo con tu pedido, llama al garzón para solicitarlo!!!')))))),
      P.pie(true)
    ]);
  }

  async function iniciar() {
    try {
      var d = await P.api('GET', '/carrito' + (restauranteId ? '?restaurante=' + encodeURIComponent(restauranteId) : ''));
      document.title = d.restaurante.nombre;
      dibujar(d.restaurante, d.items);
    } catch (e) {
      if (e.status === 404) { window.location.replace('/'); return; } // sin restaurante en el contexto: vuelve al inicio
      mostrarError(e);
    }
  }

  iniciar();
}());
