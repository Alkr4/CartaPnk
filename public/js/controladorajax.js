// Interacción del carrito (jQuery + AJAX). Las peticiones que cambian estado envían el token CSRF
// en la cabecera X-CSRF-Token (tomado de <meta name="csrf-token">).

$(document).ready(function () {
  $.ajaxSetup({
    headers: { 'X-CSRF-Token': $('meta[name="csrf-token"]').attr('content') }
  });

  $('.button').on('click', function (e) {
    e.preventDefault();
    agregarItem($(this).data('item-id'));
  });

  $('.elim').on('click', function (e) {
    e.preventDefault();
    quitarItem($(this).data('posicion'));
  });

  $('.limpiar').on('click', function (e) {
    e.preventDefault();
    vaciarCarrito();
  });
});

function agregarItem(id) {
  $.ajax({
    type: 'POST',
    url: '/carrito/items',
    contentType: 'application/json',
    data: JSON.stringify({ itemId: id }),
    success: function () {
      bootstrap.Modal.getOrCreateInstance(document.getElementById('myModal')).show();
    }
  });
}

function quitarItem(posicion) {
  $.ajax({
    type: 'DELETE',
    url: '/carrito/items/' + encodeURIComponent(posicion),
    success: function () { location.reload(); }
  });
}

function vaciarCarrito() {
  $.ajax({
    type: 'DELETE',
    url: '/carrito',
    success: function () { location.reload(); }
  });
}
