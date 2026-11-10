'use strict';
const { enteroPositivo, texto } = require('../src/utils/validadores');
const { monedaChilena, idHtml } = require('../src/utils/formato');

describe('validadores', () => {
  test('enteroPositivo acepta enteros válidos', () => {
    expect(enteroPositivo('1')).toBe(1);
    expect(enteroPositivo('2147483647')).toBe(2147483647);
    expect(enteroPositivo(5)).toBe(5);
  });
  test.each(['0', '-1', '1.5', '1abc', '1 OR 1=1', '0x10', '', ' 1', '2147483648', null, undefined, ['1'], { a: 1 }])(
    'enteroPositivo rechaza %p', (v) => expect(enteroPositivo(v)).toBeNull());
  test('texto recorta y valida el largo', () => {
    expect(texto('  hola ', 10)).toBe('hola');
    expect(texto('x'.repeat(11), 10)).toBeNull();
    expect(texto(123, 10)).toBeNull();
  });
});

describe('formato', () => {
  test('monedaChilena replica el formato del sitio original', () => {
    expect(monedaChilena(12500)).toBe('$ 12.500');
    expect(monedaChilena(2000)).toBe('$ 2.000');
    expect(monedaChilena(999)).toBe('$ 999');
    expect(monedaChilena(1234567)).toBe('$ 1.234.567');
    expect(monedaChilena(null)).toBe('$ 0');
  });
  test('idHtml quita espacios y eñes', () => {
    expect(idHtml('Vino Tinto')).toBe('VinoTinto');
    expect(idHtml('Año')).toBe('Ao');
  });
});
