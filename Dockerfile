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
COPY . .
RUN chmod +x docker/entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------- PRUEBAS (QA)
FROM deps-completas AS pruebas
ENV APP_ENV=test
COPY . .
# Falla (código distinto de 0) si el lint, alguna prueba o la auditoría de dependencias fallan.
CMD ["sh", "-c", "npm run lint && npm test && npm run audit:deps"]

# ---------------------------------------------------------------- PRODUCCIÓN
FROM base AS produccion
ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=3000
COPY --from=deps-produccion /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY db ./db
COPY public ./public
COPY docker/entrypoint.sh ./docker/entrypoint.sh
# Certificado raíz de Amazon RDS (para conectarse con TLS verificado: DB_SSL=true). Si la descarga falla, el build falla.
RUN mkdir -p db/certs \
 && wget -qO db/certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
 && test -s db/certs/rds-global-bundle.pem
RUN chmod +x docker/entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/salud >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["node", "src/server.js"]
