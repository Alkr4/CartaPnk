'use strict';
/**
 * Herramienta de una sola vez: convierte los INSERT del dump MySQL original (pnk_security.sql)
 * al seed de catálogo de PostgreSQL (db/seeds/catalogo.sql).
 *
 * Uso: node tools/convertir-dump-mysql.js <ruta/pnk_security.sql> > db/seeds/catalogo.sql
 *
 * Los usuarios NO se convierten: sus contraseñas estaban en texto plano. Los usuarios de demostración
 * se crean con hash bcrypt desde db/seed.js; en producción se crea un administrador con ADMIN_EMAIL/ADMIN_PASSWORD.
 */
const fs = require('node:fs');

const TABLAS = [
  // [tabla MySQL, tabla PostgreSQL, columnas PostgreSQL en el orden del dump]
  ['direcciones', 'direcciones', ['id', 'calle', 'numero', 'comuna', 'region', 'creado', 'actualizado', 'eliminado']],
  ['restautantes', 'restaurantes', ['id', 'rut', 'nombre', 'fono', 'mapa', 'foto', 'email', 'creado', 'actualizado', 'eliminado', 'direccion_id']],
  ['cartas', 'cartas', ['id', 'nombre', 'orden', 'visible', 'foto', 'creada', 'actualizada', 'eliminada', 'restaurante_id']],
  ['categorias', 'categorias', ['id', 'nombre', 'visible', 'foto', 'orden', 'creado', 'actualizado', 'eliminado', 'carta_id']],
  ['items', 'items', ['id', 'nombre', 'descripcion', 'tiempo', 'observaciones', 'precio', 'visible', 'destacado', 'puntuacion', 'foto', 'orden', 'creado', 'actualizado', 'eliminado', 'categoria_id']],
];
const BOOLEANAS = new Set(['visible', 'destacado']);

/** Tokeniza la lista "(…),(…),…" de un INSERT de MySQL. */
function parsearTuplas(texto) {
  const filas = [];
  let i = 0;
  const n = texto.length;
  while (i < n) {
    if (texto[i] !== '(') { i++; continue; }
    i++;
    const fila = [];
    while (i < n) {
      const c = texto[i];
      if (c === "'") {                       // cadena
        i++;
        let valor = '';
        while (i < n) {
          const d = texto[i];
          if (d === '\\') { const e = texto[i + 1]; valor += ({ n: '\n', r: '\r', t: '\t', 0: '\0' }[e] ?? e); i += 2; }
          else if (d === "'" && texto[i + 1] === "'") { valor += "'"; i += 2; }
          else if (d === "'") { i++; break; }
          else { valor += d; i++; }
        }
        fila.push({ tipo: 'str', valor });
      } else if (c === 'b' && texto[i + 1] === "'") {   // b'1'
        fila.push({ tipo: 'bit', valor: texto[i + 2] === '1' });
        i += 4;
      } else if (c === ',') { i++; }
      else if (c === ')') { i++; break; }
      else {                                // NULL o número
        let tok = '';
        while (i < n && ![',', ')'].includes(texto[i])) tok += texto[i++];
        tok = tok.trim();
        fila.push(tok.toUpperCase() === 'NULL' ? { tipo: 'null' } : { tipo: 'num', valor: tok });
      }
    }
    filas.push(fila);
  }
  return filas;
}

function aSql(columna, v) {
  if (v.tipo === 'null') return 'NULL';
  if (BOOLEANAS.has(columna)) return (v.tipo === 'bit' ? v.valor : v.valor === '1') ? 'true' : 'false';
  if (v.tipo === 'bit') return v.valor ? 'true' : 'false';
  if (v.tipo === 'num') return v.valor;
  if (/^0000-00-00/.test(v.valor)) return 'NULL';                   // fecha "cero" de MySQL
  return `'${v.valor.replace(/'/g, "''")}'`;
}

let dump = fs.readFileSync(process.argv[2], 'utf8');
if (dump.charCodeAt(0) === 0xfeff) dump = dump.slice(1); // BOM
let sql = '-- Catálogo de PNK Security (generado con tools/convertir-dump-mysql.js desde el dump MySQL original)\n'
        + '-- Se insertan los ids originales para conservar las relaciones y las rutas de imágenes (imagenes/cod{id}/...).\n\n';
for (const [tMy, tPg, cols] of TABLAS) {
  const m = dump.match(new RegExp('INSERT INTO `' + tMy + '` VALUES (.*);\\r?\\n'));
  if (!m) throw new Error('No se encontró el INSERT de ' + tMy);
  const filas = parsearTuplas(m[1]);
  for (const f of filas) if (f.length !== cols.length) throw new Error(`${tMy}: se esperaban ${cols.length} columnas y hay ${f.length}`);
  sql += `INSERT INTO ${tPg} (${cols.join(', ')}) OVERRIDING SYSTEM VALUE VALUES\n`;
  sql += filas.map((f) => '  (' + f.map((v, k) => aSql(cols[k], v)).join(', ') + ')').join(',\n') + ';\n';
  sql += `SELECT setval(pg_get_serial_sequence('${tPg}', 'id'), (SELECT max(id) FROM ${tPg}));\n\n`;
}
process.stdout.write(sql);
