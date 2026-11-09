'use strict';
/**
 * Consolida los informes de las herramientas de seguridad del pipeline y los relaciona con MITRE:
 * hallazgo -> CWE (MITRE) -> CAPEC (MITRE) -> técnica de MITRE ATT&CK.
 *
 * Fuentes soportadas (todas dentro de un directorio de reportes):
 *   *zap*.json                  OWASP ZAP (campo `cweid` de cada alerta)
 *   *.sarif                     Semgrep y otras herramientas SARIF (etiquetas "CWE-xxx" de las reglas)
 *   dependency-check-report.json  OWASP Dependency-Check (lista `cwes` de cada vulnerabilidad)
 *
 * Uso: node tools/mapear-mitre.js <directorio-de-reportes> [salida.md]
 */
const fs = require('node:fs');
const path = require('node:path');

const MAPEO = require('./mitre-mapping.json');

const cweId = (valor) => {
  const m = String(valor ?? '').match(/CWE-?\s*(\d+)/i);
  if (m) return `CWE-${m[1]}`;
  return /^\d+$/.test(String(valor ?? '')) ? `CWE-${valor}` : null;
};

function leerJson(archivo) {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { return null; }
}

function desdeZap(json, archivo) {
  const hallazgos = [];
  for (const sitio of json?.site ?? []) {
    for (const a of sitio.alerts ?? []) {
      const cwe = cweId(a.cweid);
      if (cwe) hallazgos.push({ fuente: 'OWASP ZAP', archivo, titulo: a.alert ?? a.name, severidad: String(a.riskdesc ?? '').split(' ')[0], cwe });
    }
  }
  return hallazgos;
}

function desdeSarif(json, archivo) {
  const hallazgos = [];
  for (const run of json?.runs ?? []) {
    const herramienta = run.tool?.driver?.name ?? 'SARIF';
    const reglas = new Map((run.tool?.driver?.rules ?? []).map((r) => [r.id, r]));
    for (const res of run.results ?? []) {
      const regla = reglas.get(res.ruleId);
      const etiquetas = [...(regla?.properties?.tags ?? []), ...(regla?.properties?.cwe ?? [])];
      const cwes = [...new Set(etiquetas.map(cweId).filter(Boolean))];
      for (const cwe of cwes) hallazgos.push({ fuente: herramienta, archivo, titulo: res.ruleId, severidad: res.level ?? '', cwe });
    }
  }
  return hallazgos;
}

function desdeDependencyCheck(json, archivo) {
  const hallazgos = [];
  for (const dep of json?.dependencies ?? []) {
    for (const v of dep.vulnerabilities ?? []) {
      for (const c of v.cwes ?? []) {
        const cwe = cweId(c);
        if (cwe) hallazgos.push({ fuente: 'OWASP Dependency-Check', archivo, titulo: `${v.name} (${dep.fileName})`, severidad: v.severity ?? '', cwe });
      }
    }
  }
  return hallazgos;
}

function recolectar(directorio) {
  const hallazgos = [];
  for (const nombre of fs.readdirSync(directorio)) {
    const archivo = path.join(directorio, nombre);
    if (/zap.*\.json$/i.test(nombre)) hallazgos.push(...desdeZap(leerJson(archivo), nombre));
    else if (/\.sarif$/i.test(nombre)) hallazgos.push(...desdeSarif(leerJson(archivo), nombre));
    else if (/dependency-check-report\.json$/i.test(nombre)) hallazgos.push(...desdeDependencyCheck(leerJson(archivo), nombre));
  }
  return hallazgos;
}

function informeMarkdown(hallazgos) {
  const porCwe = new Map();
  for (const h of hallazgos) {
    if (!porCwe.has(h.cwe)) porCwe.set(h.cwe, []);
    porCwe.get(h.cwe).push(h);
  }
  const filas = [...porCwe.entries()].sort((a, b) => b[1].length - a[1].length).map(([cwe, lista]) => {
    const m = Object.hasOwn(MAPEO, cwe) ? MAPEO[cwe] : null;
    const fuentes = [...new Set(lista.map((h) => h.fuente))].join(', ');
    return `| ${cwe} | ${m?.nombre ?? '(sin entrada en tools/mitre-mapping.json)'} | ${lista.length} | ${fuentes} | ${m?.capec?.join(', ') || '—'} | ${m?.attack?.join('; ') || '—'} |`;
  });
  return [
    '# Hallazgos de seguridad relacionados con MITRE (CWE → CAPEC → ATT&CK)',
    '',
    `Total de hallazgos con CWE: **${hallazgos.length}** · CWE distintos: **${porCwe.size}**`,
    '',
    '| CWE | Debilidad | Hallazgos | Herramientas | CAPEC | Técnicas ATT&CK |',
    '|---|---|---|---|---|---|',
    ...(filas.length ? filas : ['| — | Sin hallazgos con CWE en los reportes analizados | 0 | — | — | — |']),
    '',
    '> Mapeo orientativo: valide cada fila contra cwe.mitre.org, capec.mitre.org y attack.mitre.org.',
    '',
  ].join('\n');
}

module.exports = { recolectar, informeMarkdown, cweId };

if (require.main === module) {
  const [directorio, salida] = process.argv.slice(2);
  if (!directorio) { console.error('Uso: node tools/mapear-mitre.js <directorio-de-reportes> [salida.md]'); process.exit(1); }
  const md = informeMarkdown(recolectar(directorio));
  if (salida) fs.writeFileSync(salida, md);
  else process.stdout.write(md);
}
