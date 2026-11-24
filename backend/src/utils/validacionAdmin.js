'use strict';

/**
 * Validación de los formularios del panel con esquemas declarativos (lista blanca de campos):
 * sólo se aceptan los campos del esquema, con tipo, largo y rango comprobados. Nada del cuerpo de la petición
 * se usa "tal cual" (sin asignación masiva).
 */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** RUT chileno: cuerpo de hasta 8 dígitos (con o sin puntos), guion y dígito verificador correcto (módulo 11). */
function rutValido(rut) {
  const m = /^(\d{1,8})-([\dK])$/.exec(String(rut).replace(/\./g, '').toUpperCase());
  if (!m) return false;
  let suma = 0;
  let factor = 2;
  for (const d of m[1].split('').reverse()) {
    suma += Number(d) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return m[2] === esperado;
}

function validarCampo(def, bruto) {
  const etiqueta = def.etiqueta;
  const vacio = bruto === undefined || bruto === null || (typeof bruto === 'string' && bruto.trim() === '');

  if (def.tipo === 'bool') return { valor: ['on', '1', 'true'].includes(String(bruto ?? '').toLowerCase()) };

  if (vacio) {
    if (def.requerido) return { error: `${etiqueta}: campo obligatorio` };
    return { valor: def.porDefecto ?? null };
  }
  if (typeof bruto !== 'string') return { error: `${etiqueta} no es válido` };
  // normalizar (p. ej. RUT sin puntos y con K mayúscula) ANTES de medir y comprobar: se guarda la forma normalizada
  const t = def.normalizar ? def.normalizar(bruto.trim()) : bruto.trim();

  if (def.tipo === 'entero') {
    if (!/^-?\d{1,10}$/.test(t)) return { error: `${etiqueta} debe ser un número entero` };
    const n = Number(t);
    if (def.min !== undefined && n < def.min) return { error: `${etiqueta} debe ser al menos ${def.min}` };
    if (def.max !== undefined && n > def.max) return { error: `${etiqueta} no puede superar ${def.max}` };
    return { valor: n };
  }

  // texto / email
  if (def.max !== undefined && t.length > def.max) return { error: `${etiqueta} no puede superar ${def.max} caracteres` };
  if (def.minimo !== undefined && t.length < def.minimo) return { error: `${etiqueta} debe tener al menos ${def.minimo} caracteres` };
  if (def.tipo === 'email' && !RE_EMAIL.test(t)) return { error: `${etiqueta} no es un correo válido` };
  if (def.patron && !def.patron.test(t)) return { error: def.mensajePatron ?? `${etiqueta} no tiene un formato válido` };
  if (def.verificar && !def.verificar(t)) return { error: def.mensajeVerificar ?? `${etiqueta} no es válido` };
  return { valor: t };
}

/** Devuelve { valores, errores } (errores es un objeto campo -> mensaje; vacío si todo es válido). */
function validar(esquema, entrada) {
  const valores = {};
  const errores = {};
  for (const [campo, def] of Object.entries(esquema)) {
    // `campo` proviene del esquema (constante), nunca del usuario: los nombres de campo no son entrada controlable
    /* eslint-disable security/detect-object-injection */
    const r = validarCampo(def, entrada?.[campo]);
    if (r.error) errores[campo] = r.error;
    else valores[campo] = r.valor;
    /* eslint-enable security/detect-object-injection */
  }
  return { valores, errores, valido: Object.keys(errores).length === 0 };
}

const ESQUEMAS = {
  restaurante: {
    nombre: { tipo: 'texto', etiqueta: 'El nombre', requerido: true, max: 200 },
    rut: {
      tipo: 'texto', etiqueta: 'El RUT', requerido: true, max: 10, normalizar: (v) => v.replace(/\./g, '').toUpperCase(),
      patron: /^\d{1,8}-[\dK]$/, mensajePatron: 'El RUT sólo admite números, puntos, guion y K (formato 12.345.678-5)',
      verificar: rutValido, mensajeVerificar: 'El RUT no es válido: el dígito verificador no corresponde',
    },
    fono: { tipo: 'texto', etiqueta: 'El teléfono', requerido: true, max: 45, patron: /^[0-9+()\-\s]{3,45}$/, mensajePatron: 'El teléfono sólo admite números, espacios, +, ( ) y guion' },
    email: { tipo: 'email', etiqueta: 'El correo', max: 100 },
    calle: { tipo: 'texto', etiqueta: 'La calle', requerido: true, max: 100 },
    numero: {
      tipo: 'texto', etiqueta: 'El número', requerido: true, max: 15,
      patron: /^[0-9A-Za-z/#\s-]{1,15}$/, mensajePatron: 'El número sólo admite números, letras, espacios, "/", "#" y guion (p. ej. 123, 45-B o S/N)',
    },
    comuna: { tipo: 'texto', etiqueta: 'La comuna', requerido: true, max: 100 },
    region: { tipo: 'texto', etiqueta: 'La región', max: 100 },
  },
  carta: {
    nombre: { tipo: 'texto', etiqueta: 'El nombre', requerido: true, max: 45 },
    orden: { tipo: 'entero', etiqueta: 'El orden', min: 0, max: 9999 },
    visible: { tipo: 'bool' },
  },
  categoria: {
    nombre: { tipo: 'texto', etiqueta: 'El nombre', requerido: true, max: 100 },
    orden: { tipo: 'entero', etiqueta: 'El orden', min: 0, max: 9999 },
    visible: { tipo: 'bool' },
  },
  item: {
    nombre: { tipo: 'texto', etiqueta: 'El nombre', requerido: true, max: 100 },
    descripcion: { tipo: 'texto', etiqueta: 'La descripción', max: 300 },
    observaciones: { tipo: 'texto', etiqueta: 'Las observaciones', max: 300 },
    tiempo: { tipo: 'texto', etiqueta: 'El tiempo de preparación', max: 100 },
    precio: { tipo: 'entero', etiqueta: 'El precio', min: 1, max: 1_000_000 }, // pesos chilenos; vacío = sin precio
    puntuacion: { tipo: 'entero', etiqueta: 'La puntuación', min: 0, max: 5, porDefecto: 0 },
    orden: { tipo: 'entero', etiqueta: 'El orden', min: 0, max: 9999 },
    visible: { tipo: 'bool' },
    destacado: { tipo: 'bool' },
  },
};

module.exports = { validar, ESQUEMAS, rutValido };
