'use strict';
const crypto = require('node:crypto');

/**
 * Validación de imágenes por su FIRMA (primeros bytes), no por el nombre ni por el Content-Type que declara el cliente
 * (ambos son falsificables). Sólo JPG, PNG y WEBP: SVG queda excluido a propósito porque puede contener scripts.
 */
function detectarImagen(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

const MIME_POR_EXT = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Claves permitidas en el almacenamiento: <carpeta>/<id numérico>/<32 hex aleatorios>.<ext>  (nada más: sin "..", sin barras extra)
const CARPETAS = ['restaurantes', 'items'];
const REGEX_CLAVE = /^(restaurantes|items)\/[1-9][0-9]{0,9}\/[0-9a-f]{32}\.(jpg|png|webp)$/;

const claveValida = (clave) => typeof clave === 'string' && REGEX_CLAVE.test(clave);

/** Genera una clave nueva e impredecible para una imagen. */
function nuevaClave(carpeta, id, ext) {
  if (!CARPETAS.includes(carpeta)) throw new Error(`Carpeta no permitida: ${carpeta}`);
  const clave = `${carpeta}/${id}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  if (!claveValida(clave)) throw new Error('Clave de imagen inválida');
  return clave;
}

const mimeDeClave = (clave) => MIME_POR_EXT[clave.slice(clave.lastIndexOf('.') + 1)] ?? 'application/octet-stream';

/** En la base de datos la foto se guarda como "media/<clave>" para distinguirla de las imágenes originales del sitio. */
const PREFIJO_MEDIA = 'media/';
const fotoDeClave = (clave) => `${PREFIJO_MEDIA}${clave}`;
const claveDeFoto = (foto) => (typeof foto === 'string' && foto.startsWith(PREFIJO_MEDIA) && claveValida(foto.slice(PREFIJO_MEDIA.length)) ? foto.slice(PREFIJO_MEDIA.length) : null);

module.exports = { detectarImagen, claveValida, nuevaClave, mimeDeClave, fotoDeClave, claveDeFoto, PREFIJO_MEDIA };
