'use strict';
/**
 * Genera env/<ambiente>.env a partir de env/<ambiente>.env.example con secretos aleatorios.
 * Uso: node tools/init-env.js [dev|qa|prod ...]   (sin argumentos: dev y qa)
 * No sobrescribe archivos existentes. Los archivos generados están en .gitignore.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIRECTORIO = path.join(__dirname, '..', 'env');
const AMBIENTES = ['dev', 'qa', 'prod'];
const pedidos = process.argv.slice(2);
const destinos = pedidos.length ? pedidos : ['dev', 'qa'];

for (const amb of destinos) {
  if (!AMBIENTES.includes(amb)) { console.error(`Ambiente desconocido: ${amb} (use ${AMBIENTES.join(', ')})`); process.exit(1); }
  const ejemplo = path.join(DIRECTORIO, `${amb}.env.example`);
  const destino = path.join(DIRECTORIO, `${amb}.env`);
  if (fs.existsSync(destino)) { console.log(`= env/${amb}.env ya existe, no se modifica`); continue; }

  const adminPassword = crypto.randomBytes(12).toString('base64url'); // 16 caracteres
  const contenido = fs.readFileSync(ejemplo, 'utf8')
    .replace('CAMBIAR_SECRETO', crypto.randomBytes(32).toString('hex'))
    .replace('CAMBIAR_PASSWORD', crypto.randomBytes(18).toString('base64url'))
    .replace('CAMBIAR_ADMIN_PASSWORD', adminPassword);
  fs.writeFileSync(destino, contenido, { mode: 0o600 });
  console.log(`+ env/${amb}.env creado con secretos aleatorios`);
  if (amb === 'prod') console.log(`  contraseña inicial del administrador (guárdela y cámbiela): ${adminPassword}`);
}
