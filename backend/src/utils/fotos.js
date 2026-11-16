'use strict';

/**
 * URL pública de una foto guardada en la base de datos:
 *   "media/restaurantes/3/ab12….png" -> subida desde el panel (almacén: disco o S3), servida por la API en /media/…
 *   "logo.png"                       -> foto original del catálogo, un archivo estático del frontend en /imagenes/cod<id>/…
 */
function urlFoto(restauranteId, foto) {
  if (!foto) return null;
  return String(foto).startsWith('media/') ? `/${foto}` : `/imagenes/cod${restauranteId}/${foto}`;
}

module.exports = { urlFoto };
