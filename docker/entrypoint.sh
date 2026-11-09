#!/bin/sh
# Arranque del contenedor: aplica migraciones, carga datos iniciales (según variables) y lanza la aplicación.
set -e

node db/migrate.js

if [ "${SEED_CATALOGO:-false}" = "true" ] || [ "${SEED_USUARIOS_DEMO:-false}" = "true" ] || [ -n "${ADMIN_EMAIL:-}" ]; then
  node db/seed.js
fi

exec "$@"
