'use strict';

/** Formato de moneda chilena igual al del sitio original: 12500 -> "$ 12.500". */
function monedaChilena(numero) {
  const n = Number.isFinite(Number(numero)) ? Math.trunc(Number(numero)) : 0;
  const digitos = String(Math.abs(n));
  let agrupado = '';
  for (let i = 0; i < digitos.length; i += 1) {
    if (i > 0 && (digitos.length - i) % 3 === 0) agrupado += '.';
    agrupado += digitos.charAt(i);
  }
  return `$ ${n < 0 ? '-' : ''}${agrupado}`;
}

/** Id HTML válido a partir de un nombre ("Vino Tinto" -> "VinoTinto"; igual que quitarespacios() del original). */
function idHtml(nombre) {
  return String(nombre ?? '').replace(/ /g, '').replace(/[ñÑ]/g, '');
}

module.exports = { monedaChilena, idHtml };
