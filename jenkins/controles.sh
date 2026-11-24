#!/usr/bin/env bash
# =====================================================================================================================
# controles.sh — controles de seguridad y calidad del pipeline (los ejecuta el Jenkinsfile, uno por etapa).
# Se pueden correr a mano en cualquier equipo con Docker (p. ej. AWS CloudShell) para reproducir lo que hace Jenkins:
#
#   ./jenkins/controles.sh preparar      genera env/qa.env con secretos aleatorios (no se versiona)
#   ./jenkins/controles.sh secretos      Gitleaks sobre TODO el historial de Git        -> falla con cualquier secreto
#   ./jenkins/controles.sh sast          Semgrep (OWASP Top 10 + Node.js + JS)          -> falla con hallazgos ERROR
#   ./jenkins/controles.sh dependencias  npm audit (backend y frontend, producción)     -> falla con HIGH/CRITICAL
#   ./jenkins/controles.sh pruebas       lint + pruebas backend (QA con PostgreSQL) y frontend -> falla con 1 prueba roja
#   ./jenkins/controles.sh imagenes      construye las imágenes back y front de la versión
#   ./jenkins/controles.sh trivy         Trivy sobre ambas imágenes                     -> falla con HIGH/CRITICAL con parche
#   ./jenkins/controles.sh dast          levanta QA y corre OWASP ZAP baseline          -> falla con reglas FAIL (zap-reglas.tsv)
#   ./jenkins/controles.sh limpiar       baja los contenedores de QA de esta ejecución
#
# Variables: VERSION (por defecto, el commit corto) · PROYECTO (nombre de Compose, por defecto pnk-ci) · REPORTES (carpeta)
# Los informes quedan en reportes/ (SARIF/JSON/HTML) para archivarlos en Jenkins y adjuntarlos al informe.
# =====================================================================================================================
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${RAIZ}"
VERSION="${VERSION:-$(git rev-parse --short HEAD)}"
PROYECTO="${PROYECTO:-pnk-ci}"
REPORTES="${REPORTES:-${RAIZ}/reportes}"
mkdir -p "${REPORTES}"

# Herramientas en contenedores con versión fija (reproducible; se actualizan cambiando estas variables)
NODE_IMG="${NODE_IMG:-node:24-alpine}"
GITLEAKS_IMG="${GITLEAKS_IMG:-zricethezav/gitleaks:v8.21.2}"
SEMGREP_IMG="${SEMGREP_IMG:-semgrep/semgrep:1.99.0}"
TRIVY_IMG="${TRIVY_IMG:-aquasec/trivy:0.58.1}"
ZAP_IMG="${ZAP_IMG:-ghcr.io/zaproxy/zaproxy:2.16.0}"

IMG_BACK="cartapnk-back:${VERSION}"
IMG_FRONT="cartapnk-front:${VERSION}"
COMPOSE=(docker compose -p "${PROYECTO}" --env-file env/qa.env -f docker-compose.yml -f docker-compose.qa.yml)

paso() { printf '\n==> %s\n' "$*"; }

preparar() {
  paso "env/qa.env con secretos aleatorios"
  sed -e "s/^DB_PASSWORD=.*/DB_PASSWORD=$(openssl rand -hex 16)/" \
      -e "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" env/qa.env.example > env/qa.env
}

secretos() {
  paso "Gitleaks: secretos en todo el historial de Git (versión ${VERSION})"
  docker run --rm -v "${RAIZ}":/repo -v "${REPORTES}":/reportes "${GITLEAKS_IMG}" git /repo \
    --no-banner --redact --report-format sarif --report-path /reportes/gitleaks.sarif --exit-code 1
}

sast() {
  paso "Semgrep: OWASP Top 10, Node.js y JavaScript (falla con severidad ERROR)"
  docker run --rm -v "${RAIZ}":/src -v "${REPORTES}":/reportes -w /src "${SEMGREP_IMG}" semgrep scan --metrics=off \
    --config p/owasp-top-ten --config p/nodejs --config p/javascript \
    --exclude 'tests' --exclude '*.test.js' --exclude '*.test.jsx' --exclude 'node_modules' \
    --severity ERROR --error --sarif --output /reportes/semgrep.sarif
}

dependencias() {
  local d
  for d in backend frontend; do
    paso "npm audit ${d} (dependencias de producción, umbral HIGH)"
    docker run --rm -v "${RAIZ}/${d}":/app -w /app "${NODE_IMG}" \
      sh -c "npm audit --omit=dev --audit-level=high --json > /tmp/audit.json; c=\$?; cat /tmp/audit.json; exit \$c" \
      > "${REPORTES}/npm-audit-${d}.json"
  done
}

pruebas() {
  paso "Frontend: lint (reglas de seguridad y anti-XSS) + pruebas (Vitest)"
  docker run --rm -v "${RAIZ}/frontend":/app -w /app "${NODE_IMG}" \
    sh -c "npm ci --no-audit --no-fund && npm run lint && npm test"
  paso "Backend: lint + pruebas (Jest + Supertest contra PostgreSQL) + npm audit, en el ambiente QA"
  "${COMPOSE[@]}" up --build --abort-on-container-exit --exit-code-from pruebas db pruebas
}

imagenes() {
  local commit; commit="$(git rev-parse HEAD)"
  paso "Imágenes ${IMG_BACK} y ${IMG_FRONT}"
  docker build --target produccion --build-arg "APP_VERSION=${VERSION}" --build-arg "GIT_COMMIT=${commit}" -t "${IMG_BACK}" backend
  docker build -t "${IMG_FRONT}" frontend
}

trivy() {
  local img n=0
  for img in "${IMG_BACK}" "${IMG_FRONT}"; do
    n=$((n + 1))
    paso "Trivy: ${img} (HIGH/CRITICAL con parche disponible)"
    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v pnk-trivy-cache:/root/.cache/trivy -v "${REPORTES}":/reportes "${TRIVY_IMG}" image \
      --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --format sarif --output "/reportes/trivy-${n}.sarif" "${img}"
  done
}

dast() {
  paso "QA en contenedores y OWASP ZAP baseline (reglas: jenkins/zap-reglas.tsv)"
  "${COMPOSE[@]}" up -d --build back front db
  local red="${PROYECTO}_default" i
  for i in $(seq 1 40); do
    docker run --rm --network "${red}" curlimages/curl:8.11.1 -fsS http://front:8080/salud >/dev/null 2>&1 && break
    sleep 3
  done
  chmod 777 "${REPORTES}" # ZAP escribe los informes con su propio usuario
  # -I: las advertencias (WARN) no rompen el build; sólo las reglas marcadas FAIL
  docker run --rm --network "${red}" -v "${REPORTES}":/zap/wrk:rw -v "${RAIZ}/jenkins":/zap/config:ro "${ZAP_IMG}" \
    zap-baseline.py -t http://front:8080/restaurantes/1 -c /zap/config/zap-reglas.tsv -I -r zap-baseline.html -J zap-baseline.json
}

limpiar() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}

case "${1:-}" in
  preparar|secretos|sast|dependencias|pruebas|imagenes|trivy|dast|limpiar) "$1" ;;
  *) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
