# Panel de administración (`/admin`)

El sitio público **no muestra ningún login**: los clientes sólo ven la carta. El administrador entra escribiendo la URL
`/admin` (muestra el formulario de acceso si no hay sesión). Desde ahí puede crear y mantener todo el contenido.

## Qué se puede hacer

| Sección | Acciones |
|---|---|
| Restaurantes | crear, editar (con dirección e imagen), eliminar |
| Cartas | crear, editar, ocultar, eliminar (dentro de un restaurante) |
| Categorías | crear, editar, ocultar, eliminar (dentro de una carta) |
| Platillos | crear, editar (precio, descripción, puntuación, destacado, imagen), ocultar, eliminar |
| Comentarios | moderar: eliminar los inapropiados (los clientes ya no pueden publicar; ver nota) |

"Eliminar" es **borrado lógico**: el dato deja de verse en el sitio pero queda en la base. "Ocultar" lo saca del sitio y lo
mantiene en el panel (marcado como *oculto*).

> **Nota sobre comentarios:** como el cliente no inicia sesión, el sitio público mostró los comentarios existentes en modo lectura y
> el formulario para publicar se retiró. Si el profesor pide que los clientes comenten, habría que añadir comentarios anónimos con
> moderación previa (decisión pendiente).

## Primer administrador

- Desarrollo y QA: `admin@gmail.com / admin01` (usuario de demostración).
- Producción y AWS: se crea con `ADMIN_EMAIL` y `ADMIN_PASSWORD` (≥ 12 caracteres); `desplegar.sh` los genera y los deja en `.despliegue/`.
  Si el correo ya existe, se le asigna el rol de administrador.

## Seguridad implementada (para el informe)

| Control | Dónde |
|---|---|
| Autorización por **rol** comprobada en el servidor en cada petición (`requiereAdmin`) | `backend/src/middlewares/auth.js` |
| Login de administrador con mensaje **genérico**, igualación de tiempos, límite de intentos global y sesión nueva al entrar (anti *session fixation*) | `backend/src/controllers/auth.controller.js` |
| Sesión de administrador de 2 h (`ADMIN_SESION_HORAS`); páginas con `Cache-Control: no-store` y `X-Robots-Tag: noindex` | `backend/src/routes/admin.js` |
| **CSRF** en todos los formularios, también los *multipart* | `backend/src/middlewares/csrf.js` |
| Validación por **lista blanca** de campos (tipo, largo y rango); sin asignación masiva | `backend/src/utils/validacionAdmin.js` |
| Consultas SQL parametrizadas, ids de la URL validados (404 si no son enteros positivos), transacciones en altas/ediciones compuestas | `backend/src/models/*` |
| Salida como **texto** en el frontend (nunca `innerHTML` con datos): sin XSS almacenado; CSP `script-src 'self'` | `frontend/public/js/comun.js`, `frontend/nginx/seguridad.inc` |
| Imágenes: tipo real por **firma** (JPG/PNG/WEBP; SVG rechazado), máx. 2 MB, nombre aleatorio, no se ejecutan ni se escriben antes de validar | `backend/src/middlewares/subida.js`, `backend/src/storage/imagen.js` |
| Entrega de imágenes con `nosniff` y `Content-Security-Policy: sandbox`; sólo claves con el formato exacto (sin *path traversal*) | `backend/src/routes/media.js` |
| Almacenamiento S3 **privado**, cifrado, sólo HTTPS, credenciales por rol de instancia | `infra/pnk-stack.yaml` |

Pruebas automáticas: `backend/tests/admin-*.test.js`, `backend/tests/almacenamiento.test.js`, `frontend/tests/paginas.test.js`.

## Dónde se guardan las imágenes

Se elige con `STORAGE_DRIVER`:

| Valor | Uso | Detalle |
|---|---|---|
| `local` (por defecto) | desarrollo, QA y un solo servidor | carpeta `UPLOADS_DIR` (en Docker, el volumen `uploads`) |
| `s3` | **AWS con Auto Scaling** | bucket `S3_BUCKET` (lo crea CloudFormation) y `AWS_REGION` |

Con varias instancias hace falta S3: el disco de cada instancia es distinto y se pierde al reemplazarla. Las fotos originales del
sitio (`public/imagenes/…`) siguen funcionando; las nuevas se sirven por `/media/…`.

## Bloquear `/admin` en Cloudflare (recomendado)

La URL `/admin` solo está "oculta" por no estar enlazada; la protección real es el login. Con el dominio en Cloudflare se puede añadir
una **segunda puerta** que corta el tráfico **antes de que llegue a AWS**. Elija una de las dos opciones.

### Opción A — Regla WAF por IP (gratis, sin tarjeta, 2 minutos)
Solo deja pasar a `/admin` desde su IP (averígüela en https://ifconfig.me).

1. Cloudflare → su dominio → **Security → WAF → Custom rules → Create rule**.
2. Nombre: `Bloquear admin`. Pulse **Edit expression** y pegue (cambie la IP por la suya):
   ```
   ((starts_with(http.request.uri.path, "/admin") or starts_with(http.request.uri.path, "/api/admin")) and ip.src ne 203.0.113.10)
   ```
3. Acción: **Block**. Guarde con **Deploy**.
4. Pruebe: desde su IP, `https://cartapnk.xyz/admin` abre; desde otra red (p. ej. datos del celular) muestra la página de bloqueo de Cloudflare.

Importante: se bloquean **las dos** rutas, la página (`/admin`) y la API del panel (`/api/admin`); si sólo se protegiera la página, la API seguiría accesible.
Para varias IPs: `ip.src notin {203.0.113.10 198.51.100.7}`.
**Límite:** si su IP cambia (casi todos los hogares), queda bloqueado: edite la regla en el panel con la IP nueva (o desactívela un momento).

### Opción B — Cloudflare Access (inicio de sesión por correo; sirve con IP dinámica)
Antes de ver el login de la app, Cloudflare pide un código que llega a un correo autorizado. Gratis hasta 50 usuarios.

1. Cloudflare → **Zero Trust** (la primera vez pide crear un "team name" y elegir el plan **Free**; puede solicitar una tarjeta sin cobrar).
2. **Access → Applications → Add an application → Self-hosted**.
3. Application domain: `cartapnk.xyz`, path `admin`. Agregue una **segunda entrada** (*Add public hostname*) con el mismo dominio y path `api/admin`: así quedan protegidas la página y la API del panel.
4. Policy: **Allow** → Include → **Emails** → su correo (y el del profesor si debe entrar).
5. Método de acceso: **One-time PIN** (viene activado).
6. Guarde. Al abrir `/admin`, Cloudflare pide el correo, envía un código de 6 dígitos y recién entonces muestra el login de la app.

**Resultado:** para entrar al panel hacen falta **dos factores independientes**: acceso al correo autorizado (Cloudflare) + usuario y contraseña de administrador (la app).

> Las dos opciones se pueden combinar. Si usa Access, las peticiones de `/admin` llegan a la app con la cabecera `Cf-Access-Jwt-Assertion`
> (la app no la exige: Access actúa como barrera previa, no reemplaza al login).
