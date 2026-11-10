'use strict';

/**
 * Validación de los formularios del panel con esquemas declarativos (lista blanca de campos):
 * sólo se aceptan los campos del esquema, con tipo, largo y rango comprobados. Nada del cuerpo de la petición
 * se usa "tal cual" (sin asignación masiva).
 */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validarCampo(def, bruto) {
  const etiqueta = def.etiqueta;
  const vacio = bruto === undefined || bruto === null || (typeof bruto === 'string' && bruto.trim() === '');

  if (def.tipo === 'bool') return { valor: ['on', '1', 'true'].includes(String(bruto ?? '').toLowerCase()) };

  if (vacio) {
    if (def.requerido) return { error: `${etiqueta}: campo obligatorio` };
    return { valor: def.porDefecto ?? null };
  }
  if (typeof bruto !== 'string') return { error: `${etiqueta} no es válido` };
  const t = bruto.trim();

  if (def.tipo === 'entero') {
    if (!/^-?\d{1,10}$/.test(t)) return { error: `${etiqueta} debe ser un número entero` };
    const n = Number(t);
    if (def.min !== undefined && n < def.min) return { error: `${etiqueta} debe ser al menos ${def.min}` };
    if (def.max !== undefined && n > def.max) return { error: `${etiqueta} no puede superar ${def.max}` };
    return { valor: n };
  }

  // texto / email
  if (def.max !== undefined && t.length > def.max) return { error: `${etiqueta} no puede superar ${def.max} caracteres` };
  if (def.tipo === 'email' && !RE_EMAIL.test(t)) return { error: `${etiqueta} no es un correo válido` };
  if (def.patron && !def.patron.test(t)) return { error: def.mensajePatron ?? `${etiqueta} no tiene un formato válido` };
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
    rut: { tipo: 'texto', etiqueta: 'El RUT', requerido: true, max: 11, patron: /^[0-9kK.-]{3,11}$/, mensajePatron: 'El RUT sólo admite números, puntos, guion y K' },
    fono: { tipo: 'texto', etiqueta: 'El teléfono', requerido: true, max: 45, patron: /^[0-9+()\-\s]{3,45}$/, mensajePatron: 'El teléfono sólo admite números, espacios, +, ( ) y guion' },
    email: { tipo: 'email', etiqueta: 'El correo', max: 100 },
    calle: { tipo: 'texto', etiqueta: 'La calle', requerido: true, max: 100 },
    numero: { tipo: 'texto', etiqueta: 'El número', requerido: true, max: 15 },
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
    precio: { tipo: 'entero', etiqueta: 'El precio', min: 0, max: 100_000_000 },
    puntuacion: { tipo: 'entero', etiqueta: 'La puntuación', min: 0, max: 5, porDefecto: 0 },
    orden: { tipo: 'entero', etiqueta: 'El orden', min: 0, max: 9999 },
    visible: { tipo: 'bool' },
    destacado: { tipo: 'bool' },
  },
};

module.exports = { validar, ESQUEMAS };
