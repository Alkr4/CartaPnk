// Confirmación antes de las acciones destructivas del panel: <form data-confirmar="¿Seguro?">
document.addEventListener('submit', function (e) {
  var mensaje = e.target.getAttribute && e.target.getAttribute('data-confirmar');
  if (mensaje && !window.confirm(mensaje)) e.preventDefault();
});
