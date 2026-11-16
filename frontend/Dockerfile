# syntax=docker/dockerfile:1
#
# Imagen del FRONTEND: Nginx (versión "unprivileged": corre como usuario sin privilegios, puerto 8080) que sirve el sitio
# estático de public/ y reenvía /api, /media y /salud al contenedor "back" (la API).
# No contiene código del servidor ni secretos: sólo archivos públicos.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/proxy.inc /etc/nginx/conf.d/proxy.inc
COPY nginx/seguridad.inc /etc/nginx/conf.d/seguridad.inc
COPY public /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/nginx-salud || exit 1
