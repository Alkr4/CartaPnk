'use strict';
/**
 * Configuración centralizada. Todo valor sensible llega por variables de entorno (nunca está en el código).
 *
 * Ambientes (APP_ENV):
 *   development — desarrollo local: valores por defecto permitidos, errores detallados en consola.
 *   qa          — pruebas de calidad: se comporta como producción (sin valores por defecto para secretos).
 *   production  — producción: secretos obligatorios, cookies Secure, HSTS.
 */
const AMBIENTES = ['development', 'test', 'qa', 'production'];

const ambiente = process.env.APP_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
if (!AMBIENTES.includes(ambiente)) {
  throw new Error(`APP_ENV inválido: "${ambiente}". Valores permitidos: ${AMBIENTES.join(', ')}`);
}
const esLocal = ambiente === 'development' || ambiente === 'test';

function obligatoria(nombre, valorLocal) {
  // `nombre` es siempre una constante de este archivo (no entrada de usuario)
  // eslint-disable-next-line security/detect-object-injection
  const v = process.env[nombre];
  if (v !== undefined && v !== '') return v;
  if (esLocal && valorLocal !== undefined) return valorLocal;
  throw new Error(`Variable de entorno obligatoria no definida: ${nombre} (APP_ENV=${ambiente})`);
}
const entero = (nombre, porDefecto) => {
  // eslint-disable-next-line security/detect-object-injection
  const v = Number.parseInt(process.env[nombre] ?? '', 10);
  return Number.isInteger(v) ? v : porDefecto;
};
const booleano = (nombre, porDefecto) => {
  // eslint-disable-next-line security/detect-object-injection
  const v = process.env[nombre];
  if (v === undefined || v === '') return porDefecto;
  return ['1', 'true', 'si', 'yes'].includes(v.toLowerCase());
};

const SECRETO_LOCAL = 'solo-para-desarrollo-cambiar-en-qa-y-produccion';
const secretoSesion = obligatoria('SESSION_SECRET', SECRETO_LOCAL);
if (!esLocal && (secretoSesion.length < 32 || secretoSesion === SECRETO_LOCAL)) {
  throw new Error('SESSION_SECRET debe tener al menos 32 caracteres en qa y producción');
}

const config = {
  ambiente,
  esProduccion: ambiente === 'production',
  esTest: ambiente === 'test',
  puerto: entero('PORT', 3000),
  // Nº de proxys confiables delante de la app (Cloudflare / Cloudflare Tunnel = 1). Necesario para req.ip y req.secure.
  trustProxy: process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) || false : (ambiente === 'production' ? 1 : false),
  db: {
    host: obligatoria('DB_HOST', 'localhost'),
    port: entero('DB_PORT', 5432),
    database: obligatoria('DB_NAME', 'pnk_security'),
    user: obligatoria('DB_USER', 'pnk'),
    password: obligatoria('DB_PASSWORD', 'pnk'),
    max: entero('DB_POOL_MAX', 10),
  },
  sesion: {
    secreto: secretoSesion,
    nombreCookie: 'pnk.sid',
    // Secure sólo cuando el sitio se sirve por HTTPS (producción detrás de Cloudflare). En QA local por HTTP debe ser false.
    cookieSecure: booleano('COOKIE_SECURE', ambiente === 'production'),
    duracionMs: entero('SESSION_HORAS', 8) * 60 * 60 * 1000,
  },
  seguridad: {
    hsts: booleano('ENABLE_HSTS', ambiente === 'production'),
    loginMaxIntentos: entero('LOGIN_MAX_INTENTOS', 5),
    loginVentanaMs: entero('LOGIN_VENTANA_MIN', 15) * 60 * 1000,
    limiteGlobalPorMinuto: entero('RATE_LIMIT_POR_MINUTO', 300),
    bcryptRondas: entero('BCRYPT_RONDAS', ambiente === 'test' ? 4 : 12),
  },
  logs: process.env.LOG_FORMAT || (ambiente === 'development' ? 'dev' : 'combined'),
};

module.exports = config;
