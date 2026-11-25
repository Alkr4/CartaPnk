'use strict';
const crypto = require('node:crypto');
const config = require('../config');

/**
 * Registro de eventos de seguridad (ASVS 16.3.1): una línea JSON por evento en la salida estándar
 * (Docker la rota; en AWS puede enviarse a CloudWatch). Cada línea permite distinguir QUÉ pasó, CUÁNDO y con qué RESULTADO
 * sin revelar secretos ni datos personales:
 *   - el correo se reemplaza por un seudónimo (HMAC con el secreto de la aplicación: estable para correlacionar, no reversible);
 *   - la IP se trunca (IPv4: último octeto en 0; IPv6: sólo los 3 primeros grupos);
 *   - NUNCA se registran contraseñas, tokens ni valores de formularios.
 */
function seudonimo(valor) {
  return crypto.createHmac('sha256', config.sesion.secreto).update(String(valor).trim().toLowerCase()).digest('hex').slice(0, 12);
}

function ipAnonima(ip) {
  if (typeof ip !== 'string' || ip === '') return undefined;
  const v4 = ip.replace(/^::ffff:/, '');
  const octetos = v4.split('.');
  if (octetos.length === 4 && octetos.every((o) => o.length >= 1 && o.length <= 3 && /^\d+$/.test(o))) return `${octetos.slice(0, 3).join('.')}.0`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::`;
  return undefined;
}

/**
 * @param {string} evento     p. ej. 'login', 'logout', 'acceso_denegado', 'cuenta_creada'
 * @param {string} resultado  'exito' | 'fallo' | 'bloqueado' | 'denegado'
 * @param {object} [datos]    { req, usuario (correo o id), detalle }
 */
function registrar(evento, resultado, { req, usuario, detalle } = {}) {
  const linea = {
    nivel: 'seguridad',
    ts: new Date().toISOString(),
    evento,
    resultado,
    usuario: usuario === undefined || usuario === null || usuario === '' ? undefined : seudonimo(usuario),
    ip: ipAnonima(req?.ip),
    ruta: req?.originalUrl ? req.originalUrl.split('?')[0] : undefined,
    detalle,
  };
  console.log(JSON.stringify(linea));
}

module.exports = { registrar, seudonimo, ipAnonima };
