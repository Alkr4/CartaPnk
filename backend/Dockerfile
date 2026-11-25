# syntax=docker/dockerfile:1
#
# Imagen multi-etapa. Un mismo Dockerfile sirve a los tres ambientes (se elige con "target"):
#   desarrollo -> código montado como volumen + recarga automática (nodemon)
#   pruebas    -> lint + pruebas automáticas + auditoría de dependencias (ambiente QA)
#   produccion -> imagen mínima: sólo dependencias de producción, usuario sin privilegios, healthcheck
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
# tini: proceso init correcto (reenvía señales y evita procesos zombi)
RUN apk add --no-cache tini

# ---------------------------------------------------------------- dependencias
# npm acotado en memoria (--max-old-space-size) y sin auditoría/anuncios: el build debe poder correr en servidores de 1 GB de RAM
FROM base AS deps-produccion
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=384
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM base AS deps-completas
ENV NODE_ENV=development \
    NODE_OPTIONS=--max-old-space-size=384
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------- DESARROLLO
FROM deps-completas AS desarrollo
ENV APP_ENV=development
COPY --chown=node:node . .
# también en desarrollo y QA se corre como usuario sin privilegios (Semgrep: dockerfile.security.missing-user)
RUN chmod +x docker/entrypoint.sh && mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------- PRUEBAS (QA)
FROM deps-completas AS pruebas
ENV APP_ENV=test
COPY --chown=node:node . .
RUN mkdir -p uploads reportes && chown node:node uploads reportes
USER node
# Falla (código distinto de 0) si el lint, alguna prueba o la auditoría de dependencias fallan.
CMD ["sh", "-c", "npm run lint && npm test && npm run audit:deps"]

# ---------------------------------------------------------------- PRODUCCIÓN
FROM base AS produccion
ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=3000
# Versión que identifica a esta imagen (la inyecta el pipeline con --build-arg); se expone en /api/version y /salud
ARG APP_VERSION=desarrollo
ARG GIT_COMMIT=desconocido
ENV APP_VERSION=${APP_VERSION} \
    GIT_COMMIT=${GIT_COMMIT}
COPY --from=deps-produccion /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY db ./db
COPY docker/entrypoint.sh ./docker/entrypoint.sh
# Certificado raíz de Amazon RDS (para conectarse con TLS verificado: DB_SSL=true). Si la descarga falla, el build falla.
RUN mkdir -p db/certs \
 && wget -qO db/certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
 && test -s db/certs/rds-global-bundle.pem
# /app/uploads: imágenes subidas desde el panel con STORAGE_DRIVER=local (en AWS se usa S3 y no se escribe a disco)
# La imagen de producción no necesita npm (arranca con node): se elimina junto con sus dependencias internas, que Trivy
# reportaba con CVE (undici, brace-expansion) y que sólo agrandaban la superficie de ataque.
RUN mkdir -p uploads && chmod +x docker/entrypoint.sh && chown -R node:node /app \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/salud >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["node", "src/server.js"]
