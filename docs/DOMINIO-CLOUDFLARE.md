# Dominio propio + HTTPS con Cloudflare y AWS

Con un dominio propio pasa de la URL temporal de trycloudflare a algo como `https://menu.cartapnk.xyz`, con **HTTPS de extremo a extremo**:

```
Navegador ──HTTPS──► Cloudflare (WAF, CDN, DNS) ──HTTPS (Full strict)──► ALB :443 (certificado de ACM) ──► instancias ──► RDS
```

Los pasos con "(manual)" se hacen en la web de Cloudflare o del registrador; el resto los automatiza `scripts/desplegar.sh`.

## 1. Comprar el dominio

Cualquier dominio sirve; para un trabajo de curso lo importante es el precio. **Los precios y las promociones cambian: compare en el momento de comprar** y mire el precio de *renovación* (a veces el primer año es muy barato y la renovación no).

| Opción | Comentario |
|---|---|
| **GitHub Student Developer Pack** (education.github.com) | Si es estudiante, suele incluir un dominio gratis por un año con algún registrador asociado. Conviene revisarlo primero. |
| **Cloudflare Registrar** | Vende dominios **al precio de costo** y los deja ya configurados en Cloudflare (sin cambiar *nameservers*). Sólo ofrece algunas extensiones (p. ej. `.com`, `.net`, `.org`, `.xyz`) y **no `.cl`**. |
| Otro registrador (Namecheap, Porkbun, Hostinger, etc.) | Extensiones baratas como `.xyz`, `.site`, `.online` cuestan poco el primer año. Hay que apuntar los *nameservers* a Cloudflare (paso 2). |
| `.cl` (NIC Chile) | Requiere RUT y trámite en nic.cl; es más lento. No hace falta para esta entrega. |

Recomendación: un `.com` o `.xyz` económico, con la **protección de datos del titular (WHOIS privacy)** activada (casi siempre es gratis).

## 2. Agregar el dominio a Cloudflare (manual)

*(Si lo compró en Cloudflare Registrar, ya está hecho.)*

1. Cree una cuenta gratuita en cloudflare.com.
2. **Add a domain** → escriba su dominio → plan **Free**.
3. Cloudflare muestra **dos nameservers** (p. ej. `xxx.ns.cloudflare.com`). En el panel de su registrador cambie los *nameservers* por esos dos.
4. Espere a que el dominio quede **Active** (de unos minutos a unas horas).

## 3. Certificado HTTPS para el balanceador (ACM)

Elija el subdominio de la aplicación (p. ej. `menu.cartapnk.xyz`) y ejecute, desde CloudShell o el EC2 con credenciales vigentes:

```bash
./scripts/desplegar.sh certificado menu.cartapnk.xyz
```

El comando solicita el certificado a AWS y **imprime un registro CNAME de validación**. Créelo en Cloudflare (**DNS → Records → Add record**):

| Campo | Valor |
|---|---|
| Tipo | `CNAME` |
| Nombre / Destino | los que imprime el script |
| **Proxy status** | **DNS only (nube gris)** — si queda con proxy, la validación falla |

El script espera hasta que el certificado quede **EMITIDO** (2 a 10 minutos después de crear el registro).
Si `./scripts/desplegar.sh verificar` avisa que **ACM no está disponible** en su cuenta, use el plan B (sección 6).

> **Atajo: `./scripts/desplegar.sh dominio`** — en cualquier momento imprime, con los valores de SU cuenta de AWS, los registros que hay que crear en
> Cloudflare (validación del certificado y CNAME del sitio), el modo SSL que corresponde y el **estado actual**: certificado emitido o pendiente,
> HTTPS activo en el balanceador y si `https://su-dominio/salud` ya responde. No crea nada, se puede repetir las veces que haga falta.
> Ejemplo: `./scripts/desplegar.sh dominio cartapnk.xyz` (sin argumento usa el certificado guardado). Detalle en la sección 5.

## 4. Activar HTTPS en el balanceador

```bash
./scripts/desplegar.sh up --sin-build
```

Detecta el certificado guardado y: agrega el listener HTTPS :443 al balanceador, abre el puerto 443 y activa la cookie de sesión `Secure` (`COOKIE_SECURE=true`). El puerto 80 sigue respondiendo (lo usan las pruebas de salud y `carga`).

## 5. Publicar el dominio en Cloudflare (manual)

```bash
./scripts/desplegar.sh dominio cartapnk.xyz
```

Imprime (los valores son de ejemplo):

```
 REGISTRO 1 — validación del certificado de ACM   estado: ISSUED
   Tipo: CNAME   Nombre: _a3d6….cartapnk.xyz   Destino: _c902….acm-validations.aws   Proxy status: DNS only (nube GRIS)
 REGISTRO 2 — el sitio apunta al balanceador
   Tipo: CNAME   Nombre: @ (la raíz)   Destino: cartap-LoadB-….us-east-1.elb.amazonaws.com   Proxy status: Proxied (nube NARANJA)
 AJUSTE 3 — SSL/TLS → Overview: modo "Full (strict)"
 Estado actual:  ✔ el balanceador ya sirve HTTPS   ✔ https://cartapnk.xyz/salud responde 200
```

Qué significa cada línea del estado:

| Mensaje | Qué hacer |
|---|---|
| `certificado emitido` | Nada. Deje el registro 1 en Cloudflare: ACM lo usa para renovar el certificado solo. |
| `falta crear el registro` (PENDING_VALIDATION) | Cree el registro 1 y espere 2-10 minutos. |
| `el balanceador aún no usa HTTPS` | `./scripts/desplegar.sh up --sin-build` |
| `Esta cuenta de AWS no tiene un certificado…` | Es una cuenta nueva: los certificados no pasan de una cuenta a otra. `./scripts/desplegar.sh certificado cartapnk.xyz` |
| Cloudflare **522/523/524** | El CNAME apunta a un balanceador que ya no existe: edite el destino con el DNS nuevo que imprime el comando. |
| Cloudflare **525/526** | SSL de Cloudflare no está en *Full (strict)* o el balanceador aún no usa el certificado. |
| `todavía no responde` | El DNS aún no se propagó (unos minutos) o el sitio no está desplegado. |

Pasos manuales equivalentes:

1. **DNS → Add record**: tipo `CNAME`, nombre `@` (o el subdominio, p. ej. `menu`), destino = el DNS del balanceador (lo imprime el script; también `./scripts/desplegar.sh status`), **Proxy status: Proxied (nube naranja)**.
2. **SSL/TLS → Overview**: modo **Full (strict)**.
3. **SSL/TLS → Edge Certificates**: *Always Use HTTPS* activado; *Minimum TLS Version* 1.2.
4. **Speed → Optimization**: desactive *Rocket Loader* (inyecta scripts y la política CSP de la app los bloquearía) y, si aparece, la inyección automática de *Web Analytics*.
5. **Security → WAF**: active las reglas administradas disponibles y cree una regla de **rate limiting** para `POST /api/admin/login`.

Verifique:

```bash
curl -sI https://cartapnk.xyz/ | grep -iE "^(cf-ray|strict-transport|content-security|set-cookie)"
```

Debe verse `cf-ray` (pasó por Cloudflare), `strict-transport-security` y la cookie `pnk.sid` con `Secure; HttpOnly; SameSite=Lax`. Entre a `https://cartapnk.xyz/admin` con el administrador.

## 5b. Automatizar Cloudflare con la API (opcional)

Todo lo de las secciones 3 y 5 (crear los registros DNS y ajustar la zona) puede hacerlo el script con la **API de Cloudflare**, usando un **token**
que usted crea una sola vez. Con una cuenta de AWS nueva el trámite completo se reduce a:

```bash
export CLOUDFLARE_API_TOKEN=...                      # el token (no se guarda en ningún archivo ni en Git)
./scripts/desplegar.sh certificado cartapnk.xyz      # ahora crea SOLO el CNAME de validación en Cloudflare y espera
./scripts/desplegar.sh up
./scripts/desplegar.sh cloudflare cartapnk.xyz       # CNAME del sitio → balanceador nuevo + ajustes de la zona
```

### Crear el token (2 minutos, una vez)

1. Cloudflare → icono de su perfil → **My Profile → API Tokens → Create Token → Create Custom Token**.
2. **Permissions** (3 filas): `Zone` · `DNS` · `Edit`   y   `Zone` · `Zone Settings` · `Edit`   y   `Zone` · `Zone` · `Read`.
3. **Zone Resources**: `Include` → `Specific zone` → **cartapnk.xyz** (así el token no puede tocar ninguna otra zona).
4. *(Recomendado)* **TTL**: fecha de vencimiento (p. ej. el día después de la entrega) y, si quiere, **Client IP Address Filtering**.
5. **Continue to summary → Create Token** y copie el valor (se muestra **una sola vez**).

### Qué hace `./scripts/desplegar.sh cloudflare [dominio] [--reemplazar]`

| Acción | Detalle |
|---|---|
| Comprueba el token y la zona | Falla con un mensaje claro si el token no existe, venció o no ve la zona. |
| Registro de validación del certificado | CNAME *DNS only* hacia ACM; sólo si el certificado aún no está emitido. |
| CNAME del sitio | `cartapnk.xyz` → DNS del balanceador, *Proxied*. **Si ya existe lo actualiza** (así se corrige solo cuando el balanceador cambia). |
| Ajustes de la zona | SSL/TLS **Full (strict)**, *Always Use HTTPS*, TLS mínimo **1.2**, *Rocket Loader* **apagado**. |
| Verificación | Pide `https://dominio/salud` y explica el resultado (200, 522, 525…). |

Es **idempotente**: puede ejecutarlo las veces que quiera. Si existe un registro de otro tipo con el mismo nombre (p. ej. un `A` de "estacionamiento" que pone el
registrador), se detiene y se lo dice; con `--reemplazar` lo borra y crea el CNAME.

Para dominios con sufijo compuesto (`midominio.co.uk`) indique la zona: `PNK_CF_ZONA=midominio.co.uk ./scripts/desplegar.sh cloudflare midominio.co.uk`.

### Seguridad del token (qué decir al profesor)

- Es una **credencial**: quien la tenga puede cambiar el DNS del dominio. Por eso se limita a **una zona**, con los **permisos mínimos** y fecha de vencimiento.
- Viaja sólo por **variable de entorno** (en CloudShell desaparece al cerrar la sesión) y por **stdin** hacia `curl` (`-K -`): no aparece en la lista de procesos ni en el historial.
- **Nunca** se escribe en el repositorio. Si se filtrara: Cloudflare → API Tokens → **Roll** (cambia el valor) o **Delete**.
- Lo que el script **no** automatiza a propósito: reglas WAF, *rate limiting* y *Cloudflare Access* (ver `docs/PANEL-ADMIN.md`: qué son, por qué importan y por qué no están activadas).

## 6. Plan B: Cloudflare en modo *Flexible* (sin ACM)

Si su cuenta no permite ACM: haga sólo el paso 5 con **SSL/TLS = Flexible** (Cloudflare habla HTTPS con el navegador y HTTP con el balanceador). La plantilla se queda como está (`COOKIE_SECURE=false`), porque el balanceador sólo ve HTTP. Es menos seguro: el tramo Cloudflare → AWS no va cifrado.

## 7. Cosas que conviene saber

- **Si destruye y vuelve a crear la pila** (`down` + `up`), el balanceador recibe un **DNS nuevo**: actualice el destino del `CNAME` en Cloudflare (`./scripts/desplegar.sh dominio` le imprime el destino nuevo). El certificado de ACM **no** se borra con la pila, no hace falta pedirlo otra vez.
- **El balanceador sigue accesible directamente** por su DNS de AWS, saltándose el WAF de Cloudflare. Para cerrarlo, limite el grupo de seguridad del balanceador a los rangos de IP de Cloudflare (https://www.cloudflare.com/ips/); no se hizo por defecto porque esos rangos cambian y complican el laboratorio.
- La tarifa del dominio es **anual**; el certificado de ACM es gratuito y se renueva solo mientras el registro de validación siga en Cloudflare (no lo borre).
- Las credenciales del laboratorio caducan a las 4 horas, pero el dominio, la cuenta de Cloudflare y el certificado son permanentes.
