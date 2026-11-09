#!/usr/bin/env bash
# Muestra en UNA pantalla en qué se diferencian los tres ambientes que corren en este servidor
# (para la demostración al profesor / capturas del informe). Sólo lectura: no modifica nada.
#
# Uso:  bash tools/mostrar-ambientes.sh
# Puertos por defecto: dev 3010, qa 3001, prod 3000  (cámbielos con DEV_PORT, QA_PORT, PROD_PORT)
set -u

DEV_PORT="${DEV_PORT:-3010}"
QA_PORT="${QA_PORT:-3001}"
PROD_PORT="${PROD_PORT:-3000}"

linea() { printf '%s\n' "------------------------------------------------------------------------------"; }

echo
echo "CONTENEDORES"
linea
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' | grep -E 'NAMES|pnk-(dev|qa|prod)' || echo "(no hay contenedores pnk-* en ejecución)"

echo
echo "COMPARACIÓN DE AMBIENTES"
linea
printf '%-12s %-13s %-10s %-9s %-14s %s\n' "AMBIENTE" "APP_ENV" "HSTS" "COOKIE" "USUARIOS DEMO" "BD PUBLICADA AL HOST"
linea

for par in "dev:${DEV_PORT}" "qa:${QA_PORT}" "prod:${PROD_PORT}"; do
  nombre="${par%%:*}"
  puerto="${par##*:}"
  base="http://127.0.0.1:${puerto}"

  salud="$(curl -fsS --max-time 5 "${base}/salud" 2>/dev/null)"
  if [ -z "${salud}" ]; then
    printf '%-12s %s\n' "${nombre}" "no está corriendo en el puerto ${puerto}"
    continue
  fi
  app_env="$(printf '%s' "${salud}" | sed -n 's/.*"ambiente":"\([a-z]*\)".*/\1/p')"

  # Se simula una petición llegada por HTTPS a través de un proxy (como hace Cloudflare) para ver HSTS y la cookie Secure.
  cab="$(curl -sI --max-time 5 -H 'X-Forwarded-Proto: https' "${base}/restaurantes/1")"
  if printf '%s' "${cab}" | grep -qi '^strict-transport-security'; then hsts="si"; else hsts="no"; fi
  if printf '%s' "${cab}" | grep -i '^set-cookie' | grep -qi 'secure'; then cookie="Secure"; else cookie="sin Secure"; fi

  demo="$(docker exec "pnk-${nombre}-db-1" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM usuarios WHERE email IN ('"'"'admin@gmail.com'"'"','"'"'alondra@gmail.com'"'"')"' 2>/dev/null | tr -d '[:space:]')"
  [ -z "${demo}" ] && demo="?"
  if [ "${demo}" = "0" ]; then demo="no (0)"; else demo="si (${demo})"; fi

  if docker ps --format '{{.Names}} {{.Ports}}' | grep "pnk-${nombre}-db-1" | grep -q '0.0.0.0:\|127.0.0.1:'; then bd="sí (puerto abierto)"; else bd="no (sólo red interna)"; fi

  printf '%-12s %-13s %-10s %-9s %-14s %s\n' "${nombre}" "${app_env}" "${hsts}" "${cookie}" "${demo}" "${bd}"
done

linea
echo
echo "Lectura: producción es el único con HSTS y cookie Secure, sin usuarios de demostración y con la base de datos sin puertos."
echo
