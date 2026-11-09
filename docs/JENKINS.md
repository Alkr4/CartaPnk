# Plan de CI/CD con Jenkins y seguridad (4.ª entrega)

Objetivo: que cada `git push` pase automáticamente por **calidad → seguridad → despliegue** y que los hallazgos de seguridad
**rompan el pipeline** antes de llegar a producción. El archivo [`Jenkinsfile`](../Jenkinsfile) es el borrador listo para adaptar.

> Estado: el `Jenkinsfile` **no se ha ejecutado** contra un Jenkins real (aquí no hay uno instalado). Las partes que dependen de la
> versión de cada plugin están marcadas con `(*)`: valídelas con *Pipeline Syntax → Snippet Generator* de su Jenkins.

## 1. Arquitectura propuesta

```
GitHub ──webhook──► Jenkins (EC2 #2, Docker) ──► pipeline ──► QA (contenedores efímeros) ──► aprobación ──► EC2 producción ──► Cloudflare
```

- **Jenkins** en su propio EC2 (recomendado ≥ 2 vCPU / 4 GB, p. ej. `t3.medium`) con Docker; así el servidor de producción no ejecuta herramientas de escaneo.
  Instalación mínima: `docker run -d -p 8080:8080 -v jenkins_home:/var/jenkins_home -v /var/run/docker.sock:/var/run/docker.sock jenkins/jenkins:lts-jdk21`
  (el agente necesita la CLI de Docker: use una imagen derivada que la incluya). Proteja el puerto 8080 en el Security Group (sólo su IP) o publíquelo con Cloudflare Tunnel + Access.
- **Pipeline multibranch**: `develop` ejecuta hasta QA; `main` ejecuta además aprobación manual y despliegue a producción.
- **Configuración como código** (plugin *Configuration as Code*): deje el Jenkins reproducible en un `jenkins.yaml` dentro del repositorio.
- **Endurecer Jenkins** (también es un objetivo de ataque): registro de usuarios desactivado, autorización por matriz/roles, credenciales sólo en el almacén de Jenkins, agentes sin acceso a producción.

## 2. Etapas del pipeline y qué control aporta

| # | Etapa | Herramienta | Qué detecta | Criterio de fallo |
|---|---|---|---|---|
| 1 | Secretos | **Gitleaks** | claves/contraseñas en el repositorio | cualquier hallazgo |
| 2 | SAST | **Semgrep** (`p/owasp-top-ten`, `p/nodejs`) + ESLint con `eslint-plugin-security` | inyecciones, XSS, uso inseguro de APIs | cualquier hallazgo `error` |
| 3 | SCA | **`npm audit`** y **OWASP Dependency-Check** (plugin) | dependencias con CVE conocidos | CVSS ≥ 9 falla; ≥ 7 deja el build inestable |
| 4 | Calidad | Jest + Supertest en Docker (ambiente **QA**) | regresiones funcionales y de seguridad (CSRF, XSS, SQLi, sesión) | cualquier prueba roja |
| 5 | Imagen | **Trivy** sobre la imagen `produccion` | CVE en el SO base y en las librerías | HIGH/CRITICAL con parche disponible |
| 6 | DAST | **OWASP ZAP** baseline contra QA | cabeceras, cookies, XSS/SQLi reflejados | reglas `FAIL` de [`jenkins/zap-reglas.tsv`](../jenkins/zap-reglas.tsv) |
| 7 | MITRE | [`tools/mapear-mitre.js`](../tools/mapear-mitre.js) | consolida los hallazgos por CWE → CAPEC → ATT&CK | informativo (artefacto `mitre.md`) |
| 8 | Aprobación | `input` de Jenkins | — | un humano autoriza producción |
| 9 | Despliegue | SSH al EC2 de producción + `docker compose` | — | prueba de humo `/salud` por Cloudflare |

El orden va de lo más barato a lo más caro: lo que se puede detectar leyendo código se detecta antes de construir imágenes o levantar contenedores.

## 3. Plugins de Jenkins

| Plugin | Para qué |
|---|---|
| **OWASP Dependency-Check** (`dependency-check-jenkins-plugin`) | pasos `dependencyCheck` (escanea) y `dependencyCheckPublisher` (publica y aplica umbrales) |
| **Warnings Next Generation** | muestra y compara en Jenkins los hallazgos de ESLint y de los informes **SARIF** (Semgrep, Gitleaks, Trivy) |
| **HTML Publisher** | publica los informes HTML de ZAP y Dependency-Check |
| **Docker Pipeline** | ejecutar etapas dentro de contenedores |
| **Pipeline** (suite), **Git**, **GitHub / GitHub Branch Source** | pipeline como código, webhooks y ramas |
| **Credentials Binding**, **SSH Agent** | credenciales fuera del código, despliegue por SSH |
| **JUnit** (+ `jest-junit`) | tendencia de pruebas |
| **Configuration as Code**, **Role-based Authorization Strategy** | Jenkins reproducible y con permisos |
| *(opcional)* **SonarQube Scanner** | análisis de calidad/seguridad con puerta de calidad |

OWASP ZAP, Trivy, Gitleaks y Semgrep se ejecutan como **contenedores** (no como plugins): son las formas oficialmente soportadas, no dependen de la versión de Jenkins y se actualizan solas con la imagen.

## 4. Dónde entra MITRE

No existe un "plugin de MITRE" para Jenkins. MITRE aporta **catálogos** que las herramientas ya usan, y el pipeline los aprovecha en tres niveles:

1. **CVE** (MITRE): Dependency-Check y Trivy reportan vulnerabilidades por identificador CVE.
2. **CWE** (MITRE): tipo de debilidad. Dependency-Check lista los `cwes` de cada vulnerabilidad, ZAP incluye `cweid` en cada alerta y las reglas de Semgrep llevan etiquetas `CWE-xxx`.
3. **CAPEC y ATT&CK** (MITRE): patrón de ataque y técnica del adversario. `tools/mapear-mitre.js` consolida los reportes y, con la tabla [`tools/mitre-mapping.json`](../tools/mitre-mapping.json), genera `reportes/mitre.md`:
   *hallazgo → CWE → CAPEC → técnica ATT&CK* (por ejemplo CWE-89 → CAPEC-66 → T1190; CWE-307 → CAPEC-49 → T1110).
   La tabla es una propuesta de trabajo: valide cada fila en cwe.mitre.org / capec.mitre.org / attack.mitre.org antes de citarla.

Extensión opcional (si el profesor quiere algo más "MITRE"): ejecutar **MITRE Caldera** (emulación de adversarios, imagen Docker) contra el ambiente **QA**, nunca contra producción, con un perfil que reproduzca las técnicas del mapeo (T1190, T1110, T1539), y revisar la cobertura en **ATT&CK Navigator**.

## 5. Plan de trabajo sugerido

| Semana | Entregable |
|---|---|
| 1 | Jenkins en EC2 + plugins + credenciales; pipeline `Checkout → lint → pruebas QA` en verde |
| 2 | Etapas de seguridad estática: Gitleaks, Semgrep, `npm audit`, Dependency-Check |
| 3 | Imagen + Trivy, despliegue a QA y ZAP baseline; informe MITRE |
| 4 | Aprobación y despliegue a producción por SSH, webhooks, informe de la entrega (capturas del pipeline, ejemplo de build roto por una vulnerabilidad y corregido) |

Para la demostración conviene **provocar un fallo a propósito** (por ejemplo, volver a introducir una concatenación SQL o quitar `httpOnly`) y mostrar cómo Semgrep/ESLint/ZAP/las pruebas detienen el pipeline.

## 6. Riesgos y notas

- **AWS Academy** reinicia las instancias y cambia la IP: use Elastic IP o Cloudflare Tunnel también para Jenkins, y guarde `jenkins_home` en un volumen.
- El escaneo de Dependency-Check descarga la base de vulnerabilidades (varios minutos la primera vez): cachee su directorio de datos entre ejecuciones y use una clave de la API de NVD para evitar límites de tasa.
- ZAP *baseline* es **pasivo**; un escaneo activo (`zap-full-scan.py`) sólo debe apuntar a QA y puede tardar bastante: déjelo para una ejecución programada nocturna.
- El almacenamiento de intentos de login (`express-rate-limit`) es en memoria: con varias réplicas hay que moverlo a Redis.

## 7. Referencias

- Plugin OWASP Dependency-Check para pipelines: <https://jenkins.io/doc/pipeline/steps/dependency-check-jenkins-plugin/>
- ZAP en CI/CD (baseline scan): <https://zaproxy.org/blog/2020-04-09-automate-security-testing-with-zap-and-github-actions>
- Cloudflare Tunnel gestionado de forma remota: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/remote-management/>
