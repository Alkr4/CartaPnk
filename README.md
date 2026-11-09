# PNK Security — versión Node.js + Express + PostgreSQL

Menú digital para restaurantes (laboratorio de Programación Segura). Es la reescritura de la aplicación PHP/MySQL
(`VulnerablePage`) sobre **Node.js, Express y PostgreSQL**, con **arquitectura MVC**, **Docker** y **tres ambientes**
(desarrollo, QA y producción). **La apariencia es la misma**: se reutilizan el CSS, las imágenes y el HTML del sitio
original (la captura de la carta renderizada por la versión PHP y por esta versión es idéntica píxel a píxel).

| Capa | Tecnología |
|---|---|
| Servidor | Node.js 24 LTS · Express 5 · EJS (vistas) |
| Base de datos | PostgreSQL 17 (`pg`, consultas parametrizadas) |
| Sesión | `express-session` guardada en PostgreSQL (`connect-pg-simple`) |
| Seguridad | `helmet` (CSP, HSTS…) · CSRF propio · `bcryptjs` · `express-rate-limit` |
| Calidad | Jest + Supertest (59 pruebas) · ESLint + `eslint-plugin-security` |
| Contenedores | Docker multi-etapa · Docker Compose (dev / QA / prod) |

## Arquitectura MVC

```
Petición ──► routes/ ──► middlewares/ ──► controllers/ ──► models/ ──► PostgreSQL
                                              │
                                              └──► views/ (EJS)  ──► HTML
```

| Carpeta | Responsabilidad |
|---|---|
| `src/models/` | Acceso a datos. Sólo aquí hay SQL, siempre con parámetros (`$1, $2…`). |
| `src/controllers/` | Lógica de cada caso de uso: validan la entrada, llaman a los modelos y eligen la vista. |
| `src/views/` | Plantillas EJS (`pages/` y `partials/`). Toda salida se escapa por defecto (`<%= %>`). |
| `src/routes/` | Mapa URL → controlador. |
| `src/middlewares/` | Seguridad transversal: cabeceras, sesión, CSRF, límites, errores. |
| `src/config/` | Configuración por ambiente leída de variables de entorno (sin secretos en el código). |
| `db/` | Migraciones SQL, datos iniciales y sus ejecutores (`migrate.js`, `seed.js`). |
| `public/` | CSS, imágenes y JS del navegador (idénticos al sitio original). |
| `tests/` | Pruebas automáticas. |
| `docker/`, `Dockerfile`, `docker-compose*.yml`, `env/` | Contenedores y ambientes. |

Rutas: `GET /` (redirige al primer restaurante) · `GET /restaurantes/:id` · `POST /restaurantes/:id/comentarios` ·
`GET /carrito` · `POST /carrito/items` · `DELETE /carrito/items/:posicion` · `DELETE /carrito` ·
`POST /auth/login` · `POST /auth/logout` · `GET /salud`.

## Los tres ambientes

| | Desarrollo | QA | Producción |
|---|---|---|---|
| `APP_ENV` | `development` | `qa` | `production` |
| Imagen (target) | `desarrollo` (nodemon, código montado) | `produccion` + `pruebas` | `produccion` |
| Datos | catálogo + usuarios demo | catálogo + usuarios demo | catálogo; **sin** usuarios demo, administrador por variables |
| Secretos | valores por defecto permitidos | obligatorios | obligatorios (≥ 32 caracteres) |
| Cookie `Secure` / HSTS | no | no (HTTP local) | sí (HTTPS vía Cloudflare) |
| Puertos | app `3000`, BD `127.0.0.1:5432` | app `3001` | app sólo en `127.0.0.1` (o `80`); **BD sin puertos** |
| Endurecimiento | — | — | FS de solo lectura, `cap_drop: ALL`, `no-new-privileges`, límites de memoria/PIDs, logs rotados |
| Proyecto Compose | `pnk-dev` | `pnk-qa` | `pnk-prod` (red y volumen propios) |

### Puesta en marcha

Requisitos: Docker con Compose v2 y Node 22+ (sólo para el script que genera los archivos `env`).

```bash
npm install
node tools/init-env.js dev qa      # crea env/dev.env y env/qa.env con secretos aleatorios (prod: node tools/init-env.js prod)

npm run docker:dev                 # DESARROLLO  → http://localhost:3000   (recarga al guardar)
npm run docker:qa                  # QA          → lint + pruebas + auditoría; termina con el código de las pruebas
npm run docker:qa:app              # QA (app)    → http://localhost:3001   (para pruebas manuales / ZAP)
npm run docker:prod                # PRODUCCIÓN  → ver docs/PUBLICACION.md
```

Usuarios de demostración (sólo dev y QA): `admin@gmail.com / admin01` y `alondra@gmail.com / alondra01`.
En producción el primer administrador se crea con `ADMIN_EMAIL` / `ADMIN_PASSWORD` (≥ 12 caracteres) en `env/prod.env`.

### Sin Docker (opcional)

Con un PostgreSQL local y las variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`:

```bash
npm run migrate && SEED_CATALOGO=true SEED_USUARIOS_DEMO=true npm run seed
npm run dev        # http://localhost:3000
npm test           # pruebas (requiere la base)
npm run lint
```

## Qué corrige respecto a la versión PHP

El informe de pentesting original (VUL-01 a VUL-22) deja de aplicar por diseño:

| Hallazgo | En esta versión |
|---|---|
| SQL Injection (VUL-02/03/04/05) | Solo consultas parametrizadas en `src/models/`; ids validados con `enteroPositivo()` |
| XSS reflejado y almacenado (VUL-06/07/08) | EJS escapa toda salida; CSP `script-src 'self'` y sin scripts en línea |
| Control de acceso (VUL-09, 20) | `requiereSesion` en el servidor; autor del comentario = usuario de la sesión; filtros `eliminado IS NULL` |
| Cookie/sesión (VUL-10, 15) | `HttpOnly`, `SameSite=Lax`, `Secure` en producción; `session.regenerate()` al iniciar sesión; logout destruye la sesión |
| Cabeceras y errores (VUL-11/12/13) | `helmet`, sin `X-Powered-By`; manejador global que no filtra detalles internos |
| CSRF (VUL-14) | Token por sesión en formularios y AJAX (`X-CSRF-Token`) |
| Fuerza bruta (VUL-16) | 5 intentos fallidos por IP + correo en 15 min; respuesta genérica |
| Contraseñas en texto plano (VUL-17) | **bcrypt (12 rondas)**; la columna es `password_hash`; comparación en tiempo constante |
| Credenciales de BD (VUL-19) | Sólo por variables de entorno; usuario/clave distintos por ambiente |
| Archivos expuestos (VUL-01) | Sólo `public/` es servido; el script SQL y el código no son accesibles por HTTP |
| Dependencias (VUL-18) | Dependencias actuales + `npm audit` + `eslint-plugin-security` en cada ejecución de QA |
| Acceso a datos (VUL-21) | Capa única de modelos con consultas parametrizadas |
| Rutas de imágenes (VUL-22) | El id de la ruta es siempre un entero validado |

## Base de datos

`db/migrations/*.sql` define el esquema (claves foráneas, restricciones, índices, `boolean`/`timestamptz` en lugar de
`bit`/`datetime`). `db/seeds/catalogo.sql` se generó desde el dump MySQL original con `tools/convertir-dump-mysql.js`
(conserva los ids para que las rutas `imagenes/cod{id}/…` sigan funcionando). Las migraciones se aplican solas al arrancar
el contenedor (`docker/entrypoint.sh`).

## Documentación adicional

- [`docs/PUBLICACION.md`](docs/PUBLICACION.md) — publicar en **Git, AWS y Cloudflare** paso a paso.
- [`docs/DEMO-AMBIENTES.md`](docs/DEMO-AMBIENTES.md) — cómo mostrar los tres ambientes funcionando a la vez (con túneles temporales de Cloudflare) y tabla de diferencias.
- [`docs/JENKINS.md`](docs/JENKINS.md) — plan de CI/CD con Jenkins y plugins de seguridad (OWASP / MITRE) para la 4.ª entrega; incluye un [`Jenkinsfile`](Jenkinsfile) borrador.
