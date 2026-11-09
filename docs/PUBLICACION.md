# Publicación: Git → AWS → Cloudflare

Flujo completo para dejar la aplicación en GitHub, ejecutándose en un EC2 de AWS Academy y publicada a través de Cloudflare.

```
 GitHub  ──git pull──►  EC2 (Docker: app + PostgreSQL)  ◄──túnel saliente──  Cloudflare (HTTPS, WAF, DNS)  ◄──  Usuarios
```

---

## 1. Git

1. En GitHub cree un repositorio **vacío** (sin README ni .gitignore), por ejemplo `pnkSecurity-node`.
2. Desde la carpeta del proyecto:

```bash
git remote add origin https://github.com/<usuario>/pnkSecurity-node.git
git branch -M main
git push -u origin main
```

3. Ramas sugeridas (se alinean con los tres ambientes):

| Rama | Ambiente | Uso |
|---|---|---|
| `feature/*` | desarrollo | trabajo diario, una rama por cambio |
| `develop` | QA | integración; aquí corre el pipeline de pruebas |
| `main` | producción | sólo código aprobado; proteja la rama (PR obligatorio + pruebas verdes) |

4. **Nunca** suba secretos: `env/*.env` ya está en `.gitignore`; sólo se versionan los `*.env.example`.

---

## 2. AWS (EC2 de AWS Academy)

### 2.1 Security Group

| Puerto | Origen | Para qué |
|---|---|---|
| 22 | su IP | SSH |
| 80 | *no necesario con Cloudflare Tunnel* | (sólo si Cloudflare enruta a la IP pública) |

Con **Cloudflare Tunnel** no hace falta abrir ni el 80 ni el 443: el túnel es una conexión *saliente* desde el servidor.

### 2.2 Docker en Amazon Linux 2023

(Mismos pasos que ya funcionaron con la versión PHP; se instalan Compose y Buildx como plugins.)

```bash
sudo dnf install -y docker git
sudo systemctl enable --now docker          # arranca solo al reiniciar el EC2
sudo usermod -aG docker ec2-user            # cerrar sesión SSH y volver a entrar

sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
sudo curl -fSL https://github.com/docker/buildx/releases/download/v0.19.3/buildx-v0.19.3.linux-amd64 -o /usr/local/lib/docker/cli-plugins/docker-buildx
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx
docker compose version && docker buildx version
```

> Cada comando `curl` va **en una sola línea** (un `\` con espacio al final rompe el comando). Si el EC2 es ARM (`uname -m` = `aarch64`) cambie `x86_64`/`amd64` por `aarch64`/`arm64`.

### 2.3 Desplegar

```bash
git clone https://github.com/<usuario>/pnkSecurity-node.git && cd pnkSecurity-node

# generar env/prod.env con secretos aleatorios (el servidor no necesita Node instalado: se usa un contenedor)
docker run --rm -v "$PWD":/app -w /app node:24-alpine node tools/init-env.js prod
#   -> imprime la contraseña inicial del administrador: guárdela
nano env/prod.env       # revisar ADMIN_EMAIL; TUNNEL_TOKEN se completa en el paso 3

docker compose -p pnk-prod --env-file env/prod.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -p pnk-prod ps
curl -s http://127.0.0.1:3000/salud            # {"estado":"ok","ambiente":"production"}
```

Actualizar a una versión nueva: `git pull && docker compose -p pnk-prod --env-file env/prod.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build`.
Respaldo de la base: `docker exec pnk-prod-db-1 pg_dump -U pnk pnk_prod > respaldo.sql` (ajuste usuario y base según `env/prod.env`).

### 2.4 Particularidades de AWS Academy (Learner Lab)

- Al terminar la sesión del laboratorio las instancias se detienen y **la IP pública cambia** al reiniciarlas (salvo que asigne una Elastic IP). Con Cloudflare Tunnel esto no importa: el túnel se reconecta solo y el nombre público no cambia.
- Como Docker está habilitado al arranque y los contenedores tienen `restart: unless-stopped`, la aplicación vuelve sola al iniciar el EC2.
- No exponga PostgreSQL: en producción el servicio `db` no publica puertos.

---

## 3. Cloudflare

### 3.1 Qué papel cumple (y qué no)

Cloudflare **no ejecuta** esta aplicación: *Pages* y *Workers* sirven sitios estáticos/funciones, no un servidor Express con PostgreSQL.
Aquí Cloudflare va **delante** de AWS como DNS, proxy inverso con HTTPS, CDN, WAF y protección anti-bots. Eso es lo que se publica "en Cloudflare".

### 3.2 Requisito: un dominio en Cloudflare

- Si ya tiene un dominio: *Add a domain* en el panel de Cloudflare y cambie los *nameservers* en su registrador por los que Cloudflare le indica.
- Si no tiene: puede comprar uno desde Cloudflare Registrar (precio de costo) u otro registrador y luego agregarlo.
- **Para una demostración sin dominio** use un *Quick Tunnel* (URL temporal `https://<aleatorio>.trycloudflare.com`, sin cuenta, sin garantía de disponibilidad; sólo pruebas):

```bash
docker run --rm --network pnk-prod_default cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://app:3000
```

### 3.3 Cloudflare Tunnel con token (recomendado)

1. Panel de Cloudflare → **Zero Trust** (la primera vez pide crear un "team name"; el plan *Free* es suficiente y puede pedir validar un método de pago).
2. **Networks → Tunnels → Create a tunnel →** tipo **Cloudflared** → nombre `pnk-prod` → copie el **token**.
3. En el servidor, edite `env/prod.env`:

```
TUNNEL_TOKEN=<pegue el token>
APP_BIND=127.0.0.1
```

4. En el panel, pestaña **Public Hostname → Add**: subdominio `menu`, dominio el suyo, **Service: HTTP**, **URL: `app:3000`**
   (se usa el nombre del servicio Compose porque `cloudflared` y `app` comparten la red de Docker; `localhost` apuntaría al propio contenedor del túnel).
   Cloudflare crea automáticamente el registro DNS `CNAME` con proxy activo.
5. Levante el conector:

```bash
docker compose -p pnk-prod --env-file env/prod.env -f docker-compose.yml -f docker-compose.prod.yml --profile tunnel up -d
docker compose -p pnk-prod logs cloudflared      # debe indicar "Registered tunnel connection"
```

6. Abra `https://menu.<su-dominio>` e inicie sesión con el administrador de `env/prod.env`.

### 3.4 Ajustes recomendados en el panel

| Sección | Ajuste |
|---|---|
| SSL/TLS | **Always Use HTTPS** activado; versión mínima de TLS 1.2. (La app ya envía HSTS en producción.) |
| Speed → Optimization | **Desactivar Rocket Loader**: inyecta scripts y la CSP (`script-src 'self'`) los bloquearía. Desactive también la ofuscación de correos y la inyección automática de *Web Analytics* o permita su dominio en la CSP. |
| Security → WAF | Activar las reglas administradas disponibles en el plan Free; crear una regla de **rate limiting** para `POST /auth/login`. |
| Security → Bots | *Bot Fight Mode* activado. |
| Caching | Los estáticos (`/css`, `/js`, `/img`, `/imagenes`, `/vendors`) pueden cachearse; la carta y el carrito dependen de la sesión y no deben cachearse. |

### 3.5 Verificación

```bash
curl -sI https://menu.<su-dominio>/restaurantes/1 | grep -iE "^(cf-ray|server|strict-transport|content-security|set-cookie)"
```

Debe verse `cf-ray` (pasó por Cloudflare), `strict-transport-security`, la CSP y la cookie `pnk.sid` con `Secure; HttpOnly; SameSite=Lax`.

> **IP del cliente y límite de intentos.** La app confía en 1 proxy (`TRUST_PROXY=1`) para obtener la IP real del visitante, que usa el límite de intentos de login. Detrás del túnel el valor correcto es 1; si agrega otro proxy en medio (por ejemplo Nginx), súbalo a 2.

### 3.6 Alternativa sin túnel (más pasos)

Registro DNS `A` hacia una Elastic IP con el proxy activado (nube naranja), SSL/TLS en modo **Full (strict)** y un *Origin Certificate* de Cloudflare instalado en un proxy TLS (Nginx/Caddy) en el EC2, con el puerto 443 del Security Group limitado a los rangos de IP de Cloudflare. Funciona, pero exige operar certificados y reglas de red; por eso se recomienda el túnel.

---

## 4. Lista de verificación para la entrega

- [ ] Repositorio en GitHub con la rama `main` (y `develop`) y sin archivos `env/*.env`.
- [ ] `npm run docker:dev`, `npm run docker:qa` (pruebas en verde) y producción funcionando.
- [ ] URL pública por Cloudflare con HTTPS y cookie `Secure`.
- [ ] Captura de `docker compose ps` en el EC2 y de la respuesta con `cf-ray`.
- [ ] Informe actualizado: tecnologías (Node/Express/PostgreSQL), MVC, ambientes y publicación.

## 5. Solución de problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El login "no hace nada" en producción (vuelve a la página sin sesión) | La cookie es `Secure` pero la app cree que la petición llegó por HTTP, así que no la emite | Confirme `COOKIE_SECURE=true` **y** `TRUST_PROXY=1`, y que se entra por `https://…` (no por la IP). Con Cloudflare, `X-Forwarded-Proto: https` llega solo. |
| Error 502/1033 de Cloudflare | El conector `cloudflared` no está conectado o el *Public Hostname* apunta a `localhost` | `docker compose -p pnk-prod logs cloudflared`; el servicio debe ser `http://app:3000` |
| `compose build requires buildx 0.17.0 or later` | Buildx antiguo del paquete de Amazon Linux | Instale el plugin de Buildx del paso 2.2 |
| `permission denied … docker.sock` | El usuario aún no pertenece al grupo `docker` | `sudo usermod -aG docker ec2-user` y vuelva a iniciar sesión por SSH |
| La app no arranca y el log dice `Variable de entorno obligatoria no definida` | Falta algo en `env/prod.env` | Complete la variable indicada (producción no usa valores por defecto) |
| Demasiados bloqueos de login a usuarios distintos | La IP detectada es la de Cloudflare, no la del visitante | Revise `TRUST_PROXY` (1 detrás del túnel) |
