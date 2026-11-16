$(function() {
  "use strict";

  var nav_offset_top = $('header').height() + 50;

  /*-------------------------------------------------------------------------------
    Navbar fija
  -------------------------------------------------------------------------------*/
  function navbarFixed() {
    if ($('.header_area').length) {
      $(window).scroll(function() {
        var scroll = $(window).scrollTop();
        if (scroll >= nav_offset_top) {
          $(".header_area").addClass("navbar_fixed");
        } else {
          $(".header_area").removeClass("navbar_fixed");
        }
      });
    }
  }
  navbarFixed();

  /*-------------------------------------------------------------------------------
    Carruseles (Owl Carousel). La carta la dibuja carta.js DESPUÉS de cargar los datos de la API,
    por eso carta.js llama a window.iniciarCarruseles() cuando el HTML del carrusel ya existe.
  -------------------------------------------------------------------------------*/
  window.iniciarCarruseles = function () {
    if ($('.featured-carousel').length) {
      $('.featured-carousel').owlCarousel({
        loop: false,
        margin: 30,
        items: 1,
        nav: true,
        dots: false,
        responsiveClass: true,
        slideSpeed: 300,
        paginationSpeed: 500,
        navText: ["<div class='left-arrow'><i class='ti-angle-left'></i></div>", "<div class='right-arrow'><i class='ti-angle-right'></i></div>"],
        responsive: {
          768: { items: 2 },
          1100: { items: 3 }
        }
      });
    }
    if ($('.hero-carousel').length) {
      $('.hero-carousel').owlCarousel({
        loop: false,
        margin: 30,
        items: 1,
        nav: false,
        dots: true,
        responsiveClass: true,
        slideSpeed: 300,
        paginationSpeed: 500
      });
    }
  };
});
