# Panel de administración (`/admin`)

El sitio público **no muestra ningún login**: los clientes sólo ven la carta. El administrador entra escribiendo la URL
`/admin` (se redirige a `/admin/login`). Desde ahí puede crear y mantener todo el contenido.

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
| Autorización por **rol** comprobada en el servidor en cada petición (`requiereAdmin`) | `src/middlewares/auth.js` |
| Login de administrador con mensaje **genérico**, igualación de tiempos, límite de intentos global y sesión nueva al entrar (anti *session fixation*) | `src/controllers/auth.controller.js` |
| Sesión de administrador de 2 h (`ADMIN_SESION_HORAS`); páginas con `Cache-Control: no-store` y `X-Robots-Tag: noindex` | `src/routes/admin.js` |
| **CSRF** en todos los formularios, también los *multipart* | `src/middlewares/csrf.js` |
| Validación por **lista blanca** de campos (tipo, largo y rango); sin asignación masiva | `src/utils/validacionAdmin.js` |
| Consultas SQL parametrizadas, ids de la URL validados (404 si no son enteros positivos), transacciones en altas/ediciones compuestas | `src/models/*` |
| Salida escapada (EJS) en todas las vistas: sin XSS almacenado | `src/views/*` |
| Imágenes: tipo real por **firma** (JPG/PNG/WEBP; SVG rechazado), máx. 2 MB, nombre aleatorio, no se ejecutan ni se escriben antes de validar | `src/middlewares/subida.js`, `src/storage/imagen.js` |
| Entrega de imágenes con `nosniff` y `Content-Security-Policy: sandbox`; sólo claves con el formato exacto (sin *path traversal*) | `src/routes/media.js` |
| Almacenamiento S3 **privado**, cifrado, sólo HTTPS, credenciales por rol de instancia | `infra/pnk-stack.yaml` |

Pruebas automáticas: `tests/admin-auth.test.js`, `tests/admin-crud.test.js`, `tests/almacenamiento.test.js`.

## Dónde se guardan las imágenes

Se elige con `STORAGE_DRIVER`:

| Valor | Uso | Detalle |
|---|---|---|
| `local` (por defecto) | desarrollo, QA y un solo servidor | carpeta `UPLOADS_DIR` (en Docker, el volumen `uploads`) |
| `s3` | **AWS con Auto Scaling** | bucket `S3_BUCKET` (lo crea CloudFormation) y `AWS_REGION` |

Con varias instancias hace falta S3: el disco de cada instancia es distinto y se pierde al reemplazarla. Las fotos originales del
sitio (`public/imagenes/…`) siguen funcionando; las nuevas se sirven por `/media/…`.

## Endurecer `/admin` aún más (opcional)

La URL `/admin` es "oculta" sólo por no estar enlazada; la protección real es el login. Con dominio en Cloudflare se puede añadir una
capa: *Cloudflare Access* (gratis hasta 50 usuarios) o una regla WAF que limite `/admin*` a su IP o a un correo verificado.
