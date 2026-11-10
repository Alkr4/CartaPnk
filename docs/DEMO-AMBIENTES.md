# Demostración de los tres ambientes (sin dominio)

Sirve para mostrar al profesor **desarrollo, QA y producción funcionando a la vez** en el mismo EC2, cada uno con su propia
URL pública temporal de Cloudflare (`trycloudflare.com`). No requiere dominio ni cuenta de Cloudflare.

> Un EC2 de 1 GB de RAM va justo para los tres ambientes a la vez. Cree el swap (ver `docs/PUBLICACION.md`) y, si el servidor se
> pone lento, muestre los ambientes de a uno (el procedimiento es el mismo).

## 1. Levantar los tres ambientes

```bash
cd ~/CartaPnk
git pull

# archivos de configuración (cada ambiente con sus propios secretos aleatorios)
docker run --rm -v "$PWD":/app -w /app node:24-alpine node tools/init-env.js dev qa
sudo chown $USER:$USER env/*.env
echo "APP_PORT=3010" >> env/dev.env      # dev en el 3010 para no chocar con producción (3000)

# DESARROLLO  (código montado como volumen, recarga automática)
docker compose -p pnk-dev --env-file env/dev.env -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# QA  (misma imagen que producción; sólo sitio (front + back) + base, sin el contenedor de pruebas)
docker compose -p pnk-qa --env-file env/qa.env -f docker-compose.yml -f docker-compose.qa.yml up -d --build back front db

# PRODUCCIÓN  (si ya está levantada, no hace falta repetir)
docker compose -p pnk-prod --env-file env/prod.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## 2. Un túnel público temporal por ambiente

```bash
for amb in dev qa prod; do
  docker rm -f tunel-$amb 2>/dev/null
  docker run -d --name tunel-$amb --network pnk-${amb}_default cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://front:8080
done
sleep 8
for amb in dev qa prod; do
  echo -n "$amb: "; docker logs tunel-$amb 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1
done
```

Cada línea imprime la URL pública de ese ambiente. Las direcciones cambian si se reinician los túneles.

## 3. Qué mostrar (guion de ~5 minutos)

1. **Una sola pantalla con la comparación** (captura para el informe):

   ```bash
   bash tools/mostrar-ambientes.sh
   ```

   Muestra los tres grupos de contenedores (`pnk-dev`, `pnk-qa`, `pnk-prod`) y una tabla con `APP_ENV`, HSTS, cookie `Secure`,
   usuarios de demostración y si la base de datos está expuesta. Producción debe ser el único con HSTS, cookie `Secure`, sin
   usuarios demo y con la base de datos sin puertos.

2. **Las tres URLs en el navegador**, cada una con `/salud` al final: responde `{"estado":"ok","ambiente":"development" | "qa" | "production"}`.
3. **Login con el usuario de laboratorio** (`admin@gmail.com` / `admin01`) en la URL de **dev** y de **QA**: entra.
   En **producción** ese usuario **no existe** (sólo el administrador definido en `env/prod.env`).
4. **Infraestructura como código**: abrir en GitHub `docker-compose.yml` + `docker-compose.dev.yml` / `.qa.yml` / `.prod.yml`
   y las plantillas `env/*.env.example` (los secretos reales no están en el repositorio).
5. **QA automatizado**: mostrar la salida de `docker compose -p pnk-qa --env-file env/qa.env -f docker-compose.yml -f docker-compose.qa.yml up --build --abort-on-container-exit --exit-code-from pruebas`
   con `62 passed`, lint sin advertencias y `found 0 vulnerabilities`.
6. **Pipeline (4.ª entrega)**: `docs/JENKINS.md` y el `Jenkinsfile`.

## 4. Diferencias entre ambientes (para el informe)

| | Desarrollo | QA | Producción |
|---|---|---|---|
| `APP_ENV` | `development` | `qa` | `production` |
| Imagen Docker | etapa `desarrollo` (nodemon, código montado) | etapa `produccion` + `pruebas` | etapa `produccion` |
| Datos | catálogo + usuarios demo | catálogo + usuarios demo | catálogo, sin usuarios demo |
| Secretos | por defecto permitidos | obligatorios (≥ 32 caracteres) | obligatorios (≥ 32 caracteres) |
| Cookie `Secure` / HSTS | no | no | sí |
| Base de datos | puerto 5432 sólo en localhost | sin puertos | sin puertos |
| Contenedor | sin restricciones | sin restricciones | FS de solo lectura, `cap_drop: ALL`, `no-new-privileges`, límites de memoria y PIDs |
| Tests | — | lint + 62 pruebas + `npm audit` | — |
| Proyecto Compose | `pnk-dev` | `pnk-qa` | `pnk-prod` (red y volumen propios) |

## 5. Apagar la demostración

```bash
for amb in dev qa prod; do docker rm -f tunel-$amb 2>/dev/null; done
docker compose -p pnk-dev --env-file env/dev.env -f docker-compose.yml -f docker-compose.dev.yml down
docker compose -p pnk-qa  --env-file env/qa.env  -f docker-compose.yml -f docker-compose.qa.yml  down -v
```

(Producción se deja encendida.)
