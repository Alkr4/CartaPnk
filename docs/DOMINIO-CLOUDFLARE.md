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

## 4. Activar HTTPS en el balanceador

```bash
./scripts/desplegar.sh up --sin-build
```

Detecta el certificado guardado y: agrega el listener HTTPS :443 al balanceador, abre el puerto 443 y activa la cookie de sesión `Secure` (`COOKIE_SECURE=true`). El puerto 80 sigue respondiendo (lo usan las pruebas de salud y `carga`).

## 5. Publicar el subdominio en Cloudflare (manual)

1. **DNS → Add record**: tipo `CNAME`, nombre `menu`, destino = el DNS del balanceador (lo imprime el script; también `./scripts/desplegar.sh status`), **Proxy status: Proxied (nube naranja)**.
2. **SSL/TLS → Overview**: modo **Full (strict)**.
3. **SSL/TLS → Edge Certificates**: *Always Use HTTPS* activado; *Minimum TLS Version* 1.2.
4. **Speed → Optimization**: desactive *Rocket Loader* (inyecta scripts y la política CSP de la app los bloquearía) y, si aparece, la inyección automática de *Web Analytics*.
5. **Security → WAF**: active las reglas administradas disponibles y cree una regla de **rate limiting** para `POST /auth/login`.

Verifique:

```bash
curl -sI https://menu.cartapnk.xyz/restaurantes/1 | grep -iE "^(cf-ray|strict-transport|content-security|set-cookie)"
```

Debe verse `cf-ray` (pasó por Cloudflare), `strict-transport-security` y la cookie `pnk.sid` con `Secure; HttpOnly; SameSite=Lax`. Inicie sesión en `https://menu.cartapnk.xyz` con el administrador.

## 6. Plan B: Cloudflare en modo *Flexible* (sin ACM)

Si su cuenta no permite ACM: haga sólo el paso 5 con **SSL/TLS = Flexible** (Cloudflare habla HTTPS con el navegador y HTTP con el balanceador). La plantilla se queda como está (`COOKIE_SECURE=false`), porque el balanceador sólo ve HTTP. Es menos seguro: el tramo Cloudflare → AWS no va cifrado.

## 7. Cosas que conviene saber

- **Si destruye y vuelve a crear la pila** (`down` + `up`), el balanceador recibe un **DNS nuevo**: actualice el destino del `CNAME` en Cloudflare. El certificado de ACM **no** se borra con la pila, no hace falta pedirlo otra vez.
- **El balanceador sigue accesible directamente** por su DNS de AWS, saltándose el WAF de Cloudflare. Para cerrarlo, limite el grupo de seguridad del balanceador a los rangos de IP de Cloudflare (https://www.cloudflare.com/ips/); no se hizo por defecto porque esos rangos cambian y complican el laboratorio.
- La tarifa del dominio es **anual**; el certificado de ACM es gratuito y se renueva solo mientras el registro de validación siga en Cloudflare (no lo borre).
- Las credenciales del laboratorio caducan a las 4 horas, pero el dominio, la cuenta de Cloudflare y el certificado son permanentes.
