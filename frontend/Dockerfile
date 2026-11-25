# syntax=docker/dockerfile:1
#
# Imagen del FRONTEND en dos etapas:
#   1) "compilacion": Node compila la aplicación React (Vite) a archivos estáticos (dist/).
#   2) Nginx "unprivileged" (usuario sin privilegios, puerto 8080) sirve dist/ y reenvía /api, /media y /salud al
#      contenedor "back". La imagen final no lleva Node, ni node_modules, ni código fuente: sólo archivos públicos.
FROM node:24-alpine AS compilacion
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Rama "mainline" de Nginx + paquetes de Alpine actualizados al construir. Trivy bloqueó la 1.27 (CVE corregidos en libxml2,
# openssl, expat y libpng) y también la stable 1.30.6 (6 CVE de nginx corregidos en 1.30.7, que aún no tiene imagen);
# la mainline ya trae el parche. El pipeline vuelve a escanear cada imagen nueva.
FROM nginxinc/nginx-unprivileged:mainline-alpine
USER root
RUN apk upgrade --no-cache
USER 101
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/proxy.inc /etc/nginx/conf.d/proxy.inc
COPY nginx/seguridad.inc /etc/nginx/conf.d/seguridad.inc
COPY --from=compilacion /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/nginx-salud || exit 1
