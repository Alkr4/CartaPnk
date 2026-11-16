# CartaPnk — frontend + backend (Node.js · Express · PostgreSQL)

Menú digital para restaurantes (laboratorio de Programación Segura). Es la reescritura de la aplicación PHP/MySQL
(`VulnerablePage`) con **frontend y backend separados**: un **sitio web estático** (HTML, CSS y JavaScript sin frameworks,
servido por **Nginx**) que consume una **API REST en Node.js + Express + PostgreSQL** con **arquitectura MVC**, **Docker** y
**tres ambientes** (desarrollo, QA y producción). **La apariencia es la misma** que la del sitio original: se reutilizan el CSS
y las imágenes.

```
 Navegador ──► Nginx (frontend, :8080) ──┬── /   /restaurantes/:id   /carrito   /admin         → páginas estáticas
                                         ├── /css /js /img /imagenes /vendors                   → archivos estáticos
                                         └── /api/*   /media/*   /salud ──► Express (backend, :3000) ──► PostgreSQL
                                                                                      └──────────────► Amazon S3 (imágenes)
```

El navegador sólo habla con Nginx (**mismo origen**): no hace falta CORS y la cookie de sesión sigue siendo `HttpOnly` + `SameSite=Lax`.
La API **no publica puertos**: sólo Nginx puede alcanzarla, por la red interna de Docker.

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + **JavaScript puro** (sin React ni frameworks) · Bootstrap 5, jQuery y Owl Carousel (los del sitio original) · **Nginx** (imagen `nginx-unprivileged`) |
| Backend | Node.js 24 LTS · Express 5 · API JSON (`/api`) |
| Base de datos | PostgreSQL 17 (`pg`, consultas parametrizadas) |
| Sesión | `express-session` guardada en PostgreSQL (`connect-pg-simple`) |
| Seguridad | `helmet` · CSP en Nginx y en la API · CSRF propio · `bcryptjs` · `express-rate-limit` · roles |
| Calidad | Backend: Jest + Supertest (136 pruebas) · ESLint + `eslint-plugin-security` · Frontend: `node:test` + jsdom (16 pruebas) |
| Contenedores | Docker multi-etapa · Docker Compose (dev / QA / prod) |

## Estructura del repositorio

```
backend/    API (Express, MVC): src/ db/ tests/ Dockerfile
frontend/   Sitio web: public/ (HTML, CSS, JS, imágenes) · nginx/ (configuración) · tests/ · Dockerfile
infra/      CloudFormation (VPC, RDS, ALB, Auto Scaling, S3)
scripts/    desplegar.sh (AWS)         docker-compose*.yml · env/   los tres ambientes
docs/       guías (despliegue, panel de administración, recuperación, Git, Jenkins…)
```

### Backend — arquitectura MVC

```
Petición /api ─► routes/ ─► middlewares/ ─► controllers/ ─► models/ ─► PostgreSQL
                                                │
                                                └─► respuesta JSON  (la "vista" la dibuja el frontend)
```

| Carpeta (`backend/`) | Responsabilidad |
|---|---|
| `src/models/` | Acceso a datos. Sólo aquí hay SQL, siempre con parámetros (`$1, $2…`). |
| `src/controllers/` | Lógica de cada caso de uso: validan la entrada, llaman a los modelos y responden JSON. |
| `src/routes/` | Mapa URL → controlador (`/api/...`). |
| `src/middlewares/` | Seguridad transversal: cabeceras, sesión, CSRF, límites, autorización por rol, errores. |
| `src/storage/` | Imágenes subidas: disco local o Amazon S3. |
| `src/config/` | Configuración por ambiente leída de variables de entorno (sin secretos en el código). |
| `db/` | Migraciones SQL, datos iniciales y sus ejecutores (`migrate.js`, `seed.js`). |
| `tests/` | Pruebas automáticas de la API. |

### Frontend — sitio estático

| Archivo (`frontend/public/`) | Pantalla |
|---|---|
| `carta.html` + `js/carta.js` | Carta digital (`/` y `/restaurantes/:id`) |
| `carrito.html` + `js/carrito.js` | Productos seleccionados (`/carrito`) |
| `admin.html` + `js/admin.js` | Panel de administración (`/admin`, pantallas con `#/…`) |
| `js/comun.js` | Cliente de la API (CSRF), DOM seguro (`h()`), formato de moneda, iconos |

Todo dato que llega de la API se inserta como **nodo de texto** (nunca como HTML): un nombre o comentario con `<script>` se ve tal cual y no se ejecuta.

### API REST

| Público | |
|---|---|
| `GET /api/sesion` | Estado de la sesión y token CSRF |
| `GET /api/restaurantes/primero` · `GET /api/restaurantes/:id` | Carta completa (restaurante, destacados, cartas, comentarios) |
| `GET /api/carrito` · `POST /api/carrito/items` · `DELETE /api/carrito/items/:posicion` · `DELETE /api/carrito` | Carrito (sesión de servidor) |
| `GET /media/…` · `GET /salud` | Imágenes subidas · salud (balanceador/Docker) |

| Administración (rol `admin`) | |
|---|---|
| `POST /api/admin/login` · `POST /api/admin/logout` | Acceso |
| `/api/admin/restaurantes`, `/cartas`, `/categorias`, `/items`, `/comentarios` | CRUD (GET/POST/PUT/DELETE); las imágenes viajan por `multipart/form-data` |

## Los tres ambientes

| | Desarrollo | QA | Producción |
|---|---|---|---|
| `APP_ENV` | `development` | `qa` | `production` |
| Imágenes | back `desarrollo` (nodemon) + front con archivos montados | back `produccion` + `pruebas` | back `produccion` + front |
| Datos | catálogo + usuarios demo | catálogo + usuarios demo | catálogo; **sin** usuarios demo, administrador por variables |
| Secretos | valores por defecto permitidos | obligatorios | obligatorios (≥ 32 caracteres) |
| Cookie `Secure` / HSTS | no | no (HTTP local) | sí (HTTPS vía Cloudflare) |
| Puertos | sitio `3000`, API `127.0.0.1:3100`, BD `127.0.0.1:5432` | sitio `3001` | sitio sólo en `127.0.0.1` (o `80`); **API y BD sin puertos** |
| Endurecimiento | — | — | FS de solo lectura, `cap_drop: ALL`, `no-new-privileges`, límites de memoria/PIDs, logs rotados |
| Proyecto Compose | `pnk-dev` | `pnk-qa` | `pnk-prod` (red y volumen propios) |

### Puesta en marcha

Requisitos: Docker con Compose v2 y Node 22+ (sólo para el script que genera los archivos `env`).

```bash
node tools/init-env.js dev qa      # crea env/dev.env y env/qa.env con secretos aleatorios (prod: node tools/init-env.js prod)

npm run docker:dev                 # DESARROLLO  → http://localhost:3000   (la API se recarga al guardar; para el front basta recargar el navegador)
npm run docker:qa                  # QA          → lint + pruebas del backend + auditoría; termina con el código de las pruebas
npm run docker:qa:app              # QA (sitio)  → http://localhost:3001   (para pruebas manuales / ZAP)
npm run docker:prod                # PRODUCCIÓN  → ver docs/PUBLICACION.md
```

Usuario de demostración (sólo dev y QA): `admin@gmail.com / admin01` → panel en `/admin` (el sitio público no tiene login). Existe también `alondra@gmail.com` con rol cliente (no puede entrar al panel).
En producción el primer administrador se crea con `ADMIN_EMAIL` / `ADMIN_PASSWORD` (≥ 12 caracteres) en `env/prod.env`.

### Sin Docker (opcional)

Con un PostgreSQL local y las variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`:

```bash
cd backend && npm install
npm run migrate && SEED_CATALOGO=true SEED_USUARIOS_DEMO=true npm run seed
npm test && npm run lint          # pruebas de la API (requieren la base)
npm run dev                       # API en http://localhost:3000  (sin frontend: pruebe con curl)

cd ../frontend && npm install && npm test     # pruebas del frontend (jsdom, no necesitan base de datos)
```

El sitio completo (frontend + API) se levanta con Docker Compose, porque Nginx hace de punto de entrada único.

## Qué corrige respecto a la versión PHP

El informe de pentesting original (VUL-01 a VUL-22) deja de aplicar por diseño:

| Hallazgo | En esta versión |
|---|---|
| SQL Injection (VUL-02/03/04/05) | Solo consultas parametrizadas en `src/models/`; ids validados con `enteroPositivo()` |
| XSS reflejado y almacenado (VUL-06/07/08) | El frontend inserta los datos como texto (nunca `innerHTML`); CSP `script-src 'self'` y sin scripts en línea |
| Control de acceso (VUL-09, 20) | `requiereAdmin` (rol) en el servidor en cada petición; filtros `eliminado IS NULL` |
| Cookie/sesión (VUL-10, 15) | `HttpOnly`, `SameSite=Lax`, `Secure` en producción; `session.regenerate()` al iniciar sesión; logout destruye la sesión |
| Cabeceras y errores (VUL-11/12/13) | `helmet`, sin `X-Powered-By`; manejador global que no filtra detalles internos |
| CSRF (VUL-14) | Token por sesión en formularios y AJAX (`X-CSRF-Token`) |
| Fuerza bruta (VUL-16) | 5 intentos fallidos por IP + correo en 15 min; respuesta genérica |
| Contraseñas en texto plano (VUL-17) | **bcrypt (12 rondas)**; la columna es `password_hash`; comparación en tiempo constante |
| Credenciales de BD (VUL-19) | Sólo por variables de entorno; usuario/clave distintos por ambiente |
| Archivos expuestos (VUL-01) | Nginx sólo sirve `frontend/public/`; el código y el SQL viven en otro contenedor sin puertos |
| Dependencias (VUL-18) | Dependencias actuales + `npm audit` + `eslint-plugin-security` en cada ejecución de QA |
| Acceso a datos (VUL-21) | Capa única de modelos con consultas parametrizadas |
| Rutas de imágenes (VUL-22) | El id de la ruta es siempre un entero validado |

## Base de datos

`backend/db/migrations/*.sql` define el esquema (claves foráneas, restricciones, índices, `boolean`/`timestamptz` en lugar de
`bit`/`datetime`). `backend/db/seeds/catalogo.sql` se generó desde el dump MySQL original con `backend/tools/convertir-dump-mysql.js`
(conserva los ids para que las rutas `imagenes/cod{id}/…` sigan funcionando). Las migraciones se aplican solas al arrancar
el contenedor (`backend/docker/entrypoint.sh`).

## Despliegue escalable en AWS

Además de Docker Compose (un solo servidor), el proyecto se despliega en AWS con **Amazon RDS PostgreSQL**, un **Application Load Balancer** y un **Auto Scaling Group**:

```bash
./scripts/desplegar.sh verificar   # comprueba herramientas y permisos de la cuenta (no crea nada)
./scripts/desplegar.sh up          # imagen → ECR, infraestructura → CloudFormation, espera la salud y entrega la URL
./scripts/desplegar.sh down        # destruye todo
```

Cada instancia ejecuta dos contenedores (Nginx + API). La app es *stateless* (sesiones, carrito y límite de login en PostgreSQL; imágenes en S3), se conecta a RDS con TLS verificado y las instancias se reemplazan solas si fallan. Procedimiento completo en [`docs/DESPLIEGUE-AWS.md`](docs/DESPLIEGUE-AWS.md).

## Documentación adicional

- [`docs/PUBLICACION.md`](docs/PUBLICACION.md) — publicar en **Git, AWS y Cloudflare** paso a paso.
- [`docs/DOMINIO-CLOUDFLARE.md`](docs/DOMINIO-CLOUDFLARE.md) — comprar un dominio, agregarlo a Cloudflare y activar **HTTPS de extremo a extremo** con ACM.
- [`docs/PANEL-ADMIN.md`](docs/PANEL-ADMIN.md) — panel `/admin` (CRUD de restaurantes, cartas, platillos y comentarios), roles y subida de imágenes (disco o S3).
- [`docs/REINSTALAR-DESDE-CERO.md`](docs/REINSTALAR-DESDE-CERO.md) — **recuperación**: qué pasa si se borra una instancia o toda la pila y cómo levantar todo de nuevo paso a paso.
- [`docs/DESPLIEGUE-AWS.md`](docs/DESPLIEGUE-AWS.md) — **RDS + Load Balancer + Auto Scaling** en AWS con un solo script (`scripts/desplegar.sh`) y CloudFormation (`infra/`).
- [`docs/FLUJO-GIT.md`](docs/FLUJO-GIT.md) — flujo `feature` → `develop` → `main`, relación con los ambientes de Docker, carpetas por ambiente y protección de `main`.
- [`docs/DEMO-AMBIENTES.md`](docs/DEMO-AMBIENTES.md) — cómo mostrar los tres ambientes funcionando a la vez (con túneles temporales de Cloudflare) y tabla de diferencias.
- [`docs/JENKINS.md`](docs/JENKINS.md) — plan de CI/CD con Jenkins y plugins de seguridad (OWASP / MITRE) para la 4.ª entrega; incluye un [`Jenkinsfile`](Jenkinsfile) borrador.
