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

## Defensa en profundidad: qué protege a `/admin` y qué dejamos fuera (y por qué)

Un panel de administración se protege en **capas**: si una falla, la siguiente sigue en pie.

| Capa | Dónde | Estado |
|---|---|---|
| 1. Contraseña con **bcrypt**, mensaje de error genérico, tiempo de respuesta igualado | La app | ✅ implementada |
| 2. **Rol** `admin` comprobado en el servidor en cada petición; CSRF; sesión de 2 h; cookie `HttpOnly`+`Secure`+`SameSite` | La app | ✅ implementada |
| 3. **Límite de intentos** de login: 5 fallos por IP+correo en 15 min (contador en PostgreSQL, vale para todas las instancias) | La app | ✅ implementada |
| 4. Páginas y API del panel con `no-store` y `noindex` (no se cachean ni salen en buscadores) | La app / Nginx | ✅ implementada |
| 5. **Regla WAF**: sólo ciertas IP llegan a `/admin` y `/api/admin` | Cloudflare | ⛔ no aplicada |
| 6. **Rate limiting en el borde**: Cloudflare corta los intentos de login antes de que lleguen a AWS | Cloudflare | ⛔ no aplicada |
| 7. **Cloudflare Access**: pide un código enviado a un correo autorizado *antes* de mostrar el login | Cloudflare | ⛔ no aplicada |

### Por qué importan las capas 5, 6 y 7

- **Reducen la superficie de ataque.** Sin ellas, *cualquiera en Internet* puede llegar al formulario de login y probar contraseñas; con ellas, el atacante ni siquiera ve el formulario. Un fallo futuro en la app (una vulnerabilidad nueva en el login, una dependencia con CVE) no sería explotable desde fuera.
- **Cortan el abuso donde es más barato.** La capa 3 detiene la fuerza bruta, pero la petición ya consumió CPU y base de datos de AWS. Con la 6, Cloudflare absorbe el tráfico malicioso sin gastar crédito de AWS (relevante frente a un ataque de denegación de servicio).
- **Añaden un segundo factor independiente de la app.** Con Access hacen falta *dos* cosas distintas: acceso al correo autorizado **y** usuario/contraseña. Es el equivalente a un 2FA sin escribir código.
- **Siguen el principio de *defense in depth*** (ISO/IEC 27034, OWASP ASVS V2 y V4): ningún control es infalible, por eso se apilan.

### Por qué NO están aplicadas en este proyecto (decisión consciente)

- **La regla WAF por IP (5) no es viable aquí:** el sitio se administra desde **dos redes distintas** (casa y universidad) con IP diferentes y dinámicas. Una regla fija nos bloquearía a nosotros mismos cada vez que cambie la IP, y en plena demostración sería un riesgo real de quedar fuera.
- **Access (7) sí resolvería el problema de la IP**, pero exige activar Zero Trust (a veces pide una tarjeta aun en el plan gratis) y depende de la cuenta de Cloudflare del alumno; para un laboratorio con cuentas de AWS rotativas se consideró un costo de gestión innecesario.
- **El rate limiting de borde (6)** en el plan gratuito permite **una** sola regla y duplica el límite que ya aplica la app (capa 3).
- Las capas 1 a 4 **ya cubren el riesgo principal** (adivinar contraseñas, escalar privilegios, CSRF, secuestro de sesión) y están **probadas con pruebas automáticas** (`backend/tests/admin-auth.test.js`, `admin-crud.test.js`).

> **Conclusión para la defensa:** las capas 5-7 son una **mejora recomendada, no un requisito**, y la ruta para añadirlas está documentada y es de minutos (secciones siguientes).
> En un entorno real (IP fija de oficina o VPN corporativa) activaría **la 5 y la 7** de inmediato.

## Cómo activar las capas 5-7 en Cloudflare (opcional)

La URL `/admin` solo está "oculta" por no estar enlazada; la protección real es el login. Con el dominio en Cloudflare se puede añadir
una **segunda puerta** que corta el tráfico **antes de que llegue a AWS**. Elija una de las dos opciones.

### Opción A — Regla WAF por IP (gratis, sin tarjeta, 2 minutos)
Solo deja pasar a `/admin` desde su IP (averígüela en https://ifconfig.me).

1. Cloudflare → su dominio → **Security → WAF → Custom rules → Create rule**.
2. Nombre: `Bloquear admin`. Pulse **Edit expression** y pegue (cambie la IP por la suya):
   ```
   (starts_with(http.request.uri.path, "/admin") and ip.src ne 203.0.113.10)
   ```
3. Acción: **Block**. Guarde con **Deploy**.
4. Pruebe: desde su IP, `https://cartapnk.xyz/admin/login` abre; desde otra red (p. ej. datos del celular) muestra la página de bloqueo de Cloudflare.

Para varias IPs: `ip.src notin {203.0.113.10 198.51.100.7}`.
**Límite:** si su IP cambia (casi todos los hogares), queda bloqueado: edite la regla en el panel con la IP nueva (o desactívela un momento).

### Opción B — Cloudflare Access (inicio de sesión por correo; sirve con IP dinámica)
Antes de ver el login de la app, Cloudflare pide un código que llega a un correo autorizado. Gratis hasta 50 usuarios.

1. Cloudflare → **Zero Trust** (la primera vez pide crear un "team name" y elegir el plan **Free**; puede solicitar una tarjeta sin cobrar).
2. **Access → Applications → Add an application → Self-hosted**.
3. Application domain: `cartapnk.xyz`, path `admin`. (Agregue una segunda entrada con path `admin/*` si el asistente lo pide.)
4. Policy: **Allow** → Include → **Emails** → su correo (y el del profesor si debe entrar).
5. Método de acceso: **One-time PIN** (viene activado).
6. Guarde. Al abrir `/admin`, Cloudflare pide el correo, envía un código de 6 dígitos y recién entonces muestra el login de la app.

**Resultado:** para entrar al panel hacen falta **dos factores independientes**: acceso al correo autorizado (Cloudflare) + usuario y contraseña de administrador (la app).

> Las dos opciones se pueden combinar. Si usa Access, las peticiones de `/admin` llegan a la app con la cabecera `Cf-Access-Jwt-Assertion`
> (la app no la exige: Access actúa como barrera previa, no reemplaza al login).
