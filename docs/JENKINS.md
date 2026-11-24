# Jenkins: CI/CD con controles de seguridad (4.ª entrega)

Cada `git push` a la rama vigilada (`develop`) pasa por **controles de seguridad → pruebas → imágenes → publicación en AWS**.
Si **un** control falla, el pipeline se detiene y **esa versión no se publica**; si todos pasan, `scripts/desplegar.sh publicar`
la despliega en la pila `cartapnk` y verifica que el balanceador la esté sirviendo (si no, vuelve sola a la versión anterior).

```
GitHub (develop) ──(Jenkins revisa cada 2 min)──► Jenkins (EC2 t3.medium, Docker)
   Versión ─► Gitleaks ─► Semgrep ─► npm audit ─► Lint+pruebas (QA) ─► Imágenes ─► Trivy ─► ZAP (QA) ─► Publicar en AWS
                     cualquier etapa en rojo = versión BLOQUEADA                                        │
                                                                         ECR ─► CloudFormation (rolling) ─► ALB ─► Cloudflare
```

## 1. Controles y umbrales

| # | Etapa | Herramienta (contenedor, versión fija) | Qué detecta | Umbral que BLOQUEA |
|---|---|---|---|---|
| 1 | Secretos | Gitleaks 8.21 sobre **todo el historial** | claves, tokens, contraseñas | cualquier hallazgo |
| 2 | SAST | Semgrep (`p/owasp-top-ten`, `p/nodejs`, `p/javascript`) | inyecciones, XSS, Dockerfile inseguro… | severidad ERROR |
| 3 | SCA | `npm audit` backend y frontend (producción) | dependencias con CVE | HIGH o CRITICAL |
| 4 | Calidad y seguridad funcional | ESLint (`eslint-plugin-security`, anti-XSS), Vitest (24), Jest + Supertest contra PostgreSQL (165, incluye `tests/asvs.test.js`) | regresiones, controles ASVS (autorización, CSRF, sesión, validación…) | 1 prueba roja o 1 aviso de lint |
| 5 | Imágenes | Trivy 0.58 sobre las imágenes `back` y `front` | CVE del sistema base y librerías | HIGH/CRITICAL **con parche** |
| 6 | DAST | OWASP ZAP baseline contra QA en contenedores | cabeceras, cookies, CSP, filtración de versión | reglas `FAIL` de `jenkins/zap-reglas.tsv` |
| 7 | Publicar | `desplegar.sh publicar pruebas <commit>` | servicio que no levanta o no sirve la versión | código ≠ 0 (y reversión automática) |

Cada etapa es un comando de [`jenkins/controles.sh`](../jenkins/controles.sh): se puede reproducir fuera de Jenkins con Docker,
por ejemplo `./jenkins/controles.sh sast`. Los informes (SARIF/JSON/HTML) se archivan en cada ejecución (*Artefactos → reportes/*).

Hallazgos reales que estos controles ya encontraron y se corrigieron: Semgrep detectó que las etapas `desarrollo` y `pruebas`
del Dockerfile del backend corrían como root; Trivy bloqueó el npm incluido en la imagen de Node (CVE en `undici` y
`brace-expansion`; se eliminó npm de la imagen de producción) y la imagen de Nginx 1.27 / 1.30.6 (se usa la rama mainline).

## 2. Instalar Jenkins (reproducible)

Desde AWS CloudShell, en la carpeta del repositorio y con la carpeta `.despliegue/` del despliegue (o su respaldo descomprimido):

```bash
./scripts/jenkins.sh up <su-ip-pública>     # la ve en https://checkip.amazonaws.com ; sólo esa IP abre el puerto 8080
./scripts/jenkins.sh clave                  # contraseña del usuario admin
./scripts/jenkins.sh url                    # http://<ip>:8080/
```

Qué crea ([`infra/jenkins.yaml`](../infra/jenkins.yaml)): una EC2 `t3.medium` (40 GB cifrados, IMDSv2) con Docker; Jenkins corre en
un contenedor construido desde [`jenkins/Dockerfile`](../jenkins/Dockerfile) con los plugins de [`jenkins/plugins.txt`](../jenkins/plugins.txt)
y **toda la configuración como código** en [`jenkins/casc.yaml`](../jenkins/casc.yaml): usuario `admin` (sin registro, sin acceso
anónimo, CSRF activo), la credencial `pnk-despliegue` y el trabajo `cartapnk`. No hay asistente de instalación ni clics manuales.

Secretos: la contraseña de admin y `.despliegue/` empaquetado se guardan **cifrados en SSM Parameter Store** (`/cartapnk/jenkins/*`);
la instancia los lee al arrancar y los monta sólo para el contenedor. No aparecen en el repositorio, en el user-data ni en los logs.
Para AWS no hay llaves: Jenkins usa el rol de la instancia (`LabInstanceProfile`).

Destruir: `./scripts/jenkins.sh down` (no toca la pila de la aplicación).

## 3. Demostración pedida: una versión bloqueada y la corregida publicada

1. Commit A en `develop` que **incumple un control** (p. ej. quitar la comprobación de propietario en un controlador del panel).
   Jenkins lo detecta en la etapa **Lint y pruebas**: `tests/asvs.test.js` (ficha V8) falla → ejecución en rojo, **no se publica**.
2. Commit B que lo corrige. Todas las etapas en verde → **Publicar en AWS** → `https://cartapnk.xyz/api/version` muestra el commit B.

Evidencia para el informe: la vista de etapas de ambas ejecuciones (nombre `#N · <commit>`), el log de la etapa que falló, los
artefactos `reportes/` y la respuesta de `/api/version`.

## 4. Endurecimiento de Jenkins

- Interfaz sólo desde la IP autorizada (Security Group), sin registro de usuarios ni lectura anónima, protección CSRF.
- Sin ejecutores en el nodo principal para otra cosa que este pipeline (1 ejecutor, modo exclusivo).
- Credenciales sólo en el almacén de Jenkins (tipo archivo, enmascaradas en los logs); `.despliegue` se borra del workspace al terminar.
- Herramientas de escaneo con versión fija (contenedores efímeros); el socket de Docker sólo lo usa el pipeline.
