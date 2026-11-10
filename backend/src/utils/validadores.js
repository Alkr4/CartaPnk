'use strict';

/** Entero positivo (>= 1) o null si el valor no lo es. Rechaza "1abc", "1.5", "0x10", "-3", arreglos, etc. */
function enteroPositivo(valor) {
  if (typeof valor === 'number') return Number.isSafeInteger(valor) && valor >= 1 ? valor : null;
  if (typeof valor !== 'string' || !/^[1-9]\d{0,9}$/.test(valor)) return null;
  const n = Number(valor);
  return n <= 2_147_483_647 ? n : null; // límite de integer en PostgreSQL
}

/** Texto recortado con largo máximo, o null si no es una cadena. */
function texto(valor, maximo) {
  if (typeof valor !== 'string') return null;
  const t = valor.trim();
  return t.length <= maximo ? t : null;
}

module.exports = { enteroPositivo, texto };
