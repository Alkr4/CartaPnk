'use strict';
/* eslint-disable security/detect-non-literal-fs-filename --
   Todas las rutas salen de ruta(clave): la clave se valida con una expresión regular estricta (carpeta/id/32 hex.ext)
   y además se comprueba que el resultado quede dentro de la raíz de imágenes. No hay entrada de usuario sin validar. */
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { claveValida, mimeDeClave } = require('./imagen');

/** Almacenamiento en disco (desarrollo, QA y despliegues de un solo servidor con un volumen de Docker). */
function crearAlmacenLocal({ directorio }) {
  const raiz = path.resolve(directorio);

  // Las claves ya están validadas por expresión regular; esta comprobación es una segunda barrera contra salir de la raíz.
  const ruta = (clave) => {
    if (!claveValida(clave)) throw new Error('Clave de imagen inválida');
    const destino = path.resolve(raiz, clave);
    if (!destino.startsWith(raiz + path.sep)) throw new Error('Ruta fuera del directorio de imágenes');
    return destino;
  };

  return {
    nombre: 'local',

    async guardar(clave, buffer) {
      const destino = ruta(clave);
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.writeFile(destino, buffer, { flag: 'wx' }); // "wx": nunca sobrescribe
    },

    async leer(clave) {
      const destino = ruta(clave);
      try {
        const { size } = await fs.stat(destino);
        return { stream: createReadStream(destino), contentType: mimeDeClave(clave), length: size };
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },

    async borrar(clave) {
      await fs.rm(ruta(clave), { force: true });
    },
  };
}

module.exports = { crearAlmacenLocal };
