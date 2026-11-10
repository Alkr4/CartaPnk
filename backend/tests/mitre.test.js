'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recolectar, informeMarkdown, cweId } = require('../tools/mapear-mitre');

describe('mapear-mitre (CWE -> CAPEC -> ATT&CK)', () => {
  test('cweId normaliza distintos formatos', () => {
    expect(cweId('CWE-89: Improper Neutralization')).toBe('CWE-89');
    expect(cweId('79')).toBe('CWE-79');
    expect(cweId('cwe 22')).toBe('CWE-22');
    expect(cweId('A03:2021 - Injection')).toBeNull();
    expect(cweId(undefined)).toBeNull();
  });

  test('consolida ZAP, SARIF y Dependency-Check y los relaciona con MITRE', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnk-mitre-'));
    fs.writeFileSync(path.join(dir, 'zap-baseline.json'), JSON.stringify({
      site: [{ alerts: [
        { alert: 'Content Security Policy (CSP) Header Not Set', riskdesc: 'Medium (High)', cweid: '693' },
        { alert: 'SQL Injection', riskdesc: 'High (Medium)', cweid: '89' },
      ] }],
    }));
    fs.writeFileSync(path.join(dir, 'semgrep.sarif'), JSON.stringify({
      runs: [{
        tool: { driver: { name: 'Semgrep', rules: [{ id: 'express-xss', properties: { tags: ['CWE-79: XSS', 'OWASP-A03:2021 - Injection'] } }] } },
        results: [{ ruleId: 'express-xss', level: 'error' }],
      }],
    }));
    fs.writeFileSync(path.join(dir, 'dependency-check-report.json'), JSON.stringify({
      dependencies: [{ fileName: 'lib-vieja.js', vulnerabilities: [{ name: 'CVE-2099-0001', severity: 'HIGH', cwes: ['CWE-1395', 'CWE-79'] }] }],
    }));

    const hallazgos = recolectar(dir);
    expect(hallazgos).toHaveLength(5);
    const md = informeMarkdown(hallazgos);
    expect(md).toContain('| CWE-79 |');
    expect(md).toContain('T1190 Exploit Public-Facing Application');
    expect(md).toContain('CAPEC-66');
    expect(md).toContain('OWASP ZAP');
    expect(md).toContain('Semgrep');
    expect(md).toContain('OWASP Dependency-Check');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('un CWE sin entrada en el mapeo se informa, no rompe', () => {
    const md = informeMarkdown([{ fuente: 'x', archivo: 'a', titulo: 't', severidad: '', cwe: 'CWE-99999' }]);
    expect(md).toContain('sin entrada en tools/mitre-mapping.json');
  });
});
