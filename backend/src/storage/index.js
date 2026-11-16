'use strict';
const config = require('../config');
const { crearAlmacenLocal } = require('./local');
const { crearAlmacenS3 } = require('./s3');

/**
 * Almacén de imágenes según STORAGE_DRIVER:
 *   local -> disco (UPLOADS_DIR; en Docker un volumen). Válido para UN solo servidor.
 *   s3    -> bucket de Amazon S3. Obligatorio cuando hay varias instancias (Auto Scaling), porque el disco de cada una es distinto.
 */
function crearAlmacen() {
  const { driver, directorio, bucket, region } = config.almacenamiento;
  if (driver === 's3') return crearAlmacenS3({ bucket, region });
  return crearAlmacenLocal({ directorio });
}

module.exports = { almacen: crearAlmacen(), crearAlmacen };
