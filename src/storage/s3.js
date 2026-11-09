'use strict';
const { claveValida, mimeDeClave } = require('./imagen');

/**
 * Almacenamiento en Amazon S3 (bucket PRIVADO). Las credenciales las entrega el rol de la instancia EC2
 * (cadena de credenciales del SDK): no hay claves de AWS en el código ni en variables de entorno.
 * Las imágenes se sirven a través de la app (/media/…), por lo que el bucket no necesita ser público.
 *
 * `cliente` se puede inyectar (pruebas); si no, se crea un S3Client del SDK v3 de forma perezosa.
 */
function crearAlmacenS3({ bucket, region, cliente }) {
  if (!bucket) throw new Error('S3_BUCKET es obligatorio con STORAGE_DRIVER=s3');
  let sdk;
  let s3 = cliente;
  const cargar = () => {
    if (!sdk) sdk = require('@aws-sdk/client-s3');
    if (!s3) s3 = new sdk.S3Client({ region });
    return { sdk, s3 };
  };

  return {
    nombre: 's3',

    async guardar(clave, buffer) {
      if (!claveValida(clave)) throw new Error('Clave de imagen inválida');
      const { sdk: S, s3: c } = cargar();
      await c.send(new S.PutObjectCommand({
        Bucket: bucket,
        Key: clave,
        Body: buffer,
        ContentType: mimeDeClave(clave),
        CacheControl: 'public, max-age=31536000, immutable', // el nombre es aleatorio: el contenido nunca cambia
        ServerSideEncryption: 'AES256',
      }));
    },

    async leer(clave) {
      if (!claveValida(clave)) throw new Error('Clave de imagen inválida');
      const { sdk: S, s3: c } = cargar();
      try {
        const r = await c.send(new S.GetObjectCommand({ Bucket: bucket, Key: clave }));
        return { stream: r.Body, contentType: mimeDeClave(clave), length: r.ContentLength };
      } catch (err) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async borrar(clave) {
      if (!claveValida(clave)) throw new Error('Clave de imagen inválida');
      const { sdk: S, s3: c } = cargar();
      await c.send(new S.DeleteObjectCommand({ Bucket: bucket, Key: clave }));
    },
  };
}

module.exports = { crearAlmacenS3 };
