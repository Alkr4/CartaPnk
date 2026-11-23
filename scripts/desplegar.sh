#!/usr/bin/env bash
# =====================================================================================================================
# desplegar.sh — CartaPnk en AWS: RDS PostgreSQL + Application Load Balancer + Auto Scaling (CloudFormation)
#
#   ./scripts/desplegar.sh verificar          comprueba herramientas y permisos de su cuenta AWS (no crea nada)
#   ./scripts/desplegar.sh up [--sin-build]   construye la imagen, la sube a ECR y crea/actualiza toda la infraestructura
#   ./scripts/desplegar.sh status             estado de la pila, instancias, salud del balanceador y RDS
#   ./scripts/desplegar.sh url                imprime la URL pública
#   ./scripts/desplegar.sh certificado <dom>  pide un certificado de ACM para su dominio (HTTPS propio; validación DNS en Cloudflare)
#   ./scripts/desplegar.sh dominio [<dom>]    imprime qué crear en Cloudflare (registros CNAME y modo SSL) y comprueba si el dominio ya funciona
#   ./scripts/desplegar.sh cloudflare [<dom>] [--reemplazar]  crea/corrige los DNS en Cloudflare (API) y aplica ajustes de la zona; requiere CLOUDFLARE_API_TOKEN
#   ./scripts/desplegar.sh tunel              publica la URL con un túnel TEMPORAL de Cloudflare (trycloudflare.com)
#   ./scripts/desplegar.sh carga              genera tráfico para demostrar el Auto Scaling
#   ./scripts/desplegar.sh down [--ecr]       DESTRUYE la infraestructura (pide confirmación; --ecr borra también las imágenes)
#   ./scripts/desplegar.sh construir <version>            construye y publica en ECR las imágenes de esa versión (CI)
#   ./scripts/desplegar.sh publicar <ambiente> <version>  despliega la versión en pruebas|produccion y verifica el servicio (CI)
#   ./scripts/desplegar.sh revertir <ambiente>            vuelve a la versión anterior de ese ambiente
#   ./scripts/desplegar.sh versiones [<ambiente>]         versión publicada, anterior y disponibles
#   ./scripts/desplegar.sh continuidad <dominio> [seg]    retira un destino del balanceador y mide la continuidad del servicio
#   Códigos de salida: 0 éxito · 1 error de despliegue · 2 parámetros/requisitos · 3 verificación fallida
#
# Requisitos: bash, AWS CLI v2 con credenciales válidas, Docker, openssl y curl.
# Variables opcionales: PNK_STACK, PNK_ECR_REPO, PNK_ADMIN_EMAIL, PNK_INSTANCE_TYPE, PNK_ASG_MIN, PNK_ASG_DESIRED,
#                       PNK_ASG_MAX, PNK_COOKIE_SECURE, PNK_TRUST_PROXY, PNK_IMAGE_TAG, PNK_DB_ENGINE_VERSION, PNK_DB_CLASS,
#                       PNK_INSTANCE_PROFILE, PNK_SEED_CATALOGO (true = cargar los 7 restaurantes de ejemplo), PNK_DB_MULTIAZ (false = RDS sin réplica), AWS_REGION
# =====================================================================================================================
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="${PNK_STACK:-cartapnk}"
REPO="${PNK_ECR_REPO:-cartapnk}"
PLANTILLA="${RAIZ}/infra/pnk-stack.yaml"
ESTADO="${RAIZ}/.despliegue"
SECRETOS="${ESTADO}/secretos.env"
ULTIMA_IMAGEN="${ESTADO}/ultima-imagen"
CERT_FILE="${ESTADO}/certificado-arn"

# ------------------------------------------------------------------------------------------------ utilidades de salida
if [ -t 1 ]; then VERDE=$'\033[32m'; ROJO=$'\033[31m'; AMARILLO=$'\033[33m'; NEGRITA=$'\033[1m'; FIN=$'\033[0m'; else VERDE=""; ROJO=""; AMARILLO=""; NEGRITA=""; FIN=""; fi
paso()  { printf '\n%s==> %s%s\n' "${NEGRITA}" "$*" "${FIN}"; }
ok()    { printf '  %s✔%s %s\n' "${VERDE}" "${FIN}" "$*"; }
falla() { printf '  %s✘%s %s\n' "${ROJO}" "${FIN}" "$*"; }
aviso() { printf '  %s!%s %s\n' "${AMARILLO}" "${FIN}" "$*"; }
die()   { printf '%sError:%s %s\n' "${ROJO}" "${FIN}" "$*" >&2; exit 1; }

trap 'printf "%sEl script se detuvo en la línea %s (comando: %s)%s\n" "${ROJO}" "${LINENO}" "${BASH_COMMAND}" "${FIN}" >&2' ERR

# ------------------------------------------------------------------------------------------------ región y requisitos
resolver_region() {
  REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
  if [ -z "${REGION}" ]; then REGION="$(aws configure get region 2>/dev/null || true)"; fi
  REGION="${REGION:-us-east-1}"
  export AWS_DEFAULT_REGION="${REGION}"
}

requisitos() {
  local faltan=()
  for c in aws docker openssl curl; do command -v "${c}" >/dev/null 2>&1 || faltan+=("${c}"); done
  [ "${#faltan[@]}" -eq 0 ] || die "Faltan herramientas: ${faltan[*]}. Ver docs/DESPLIEGUE-AWS.md (sección Requisitos)."
  resolver_region
  CUENTA="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
    || die "AWS CLI sin credenciales válidas. En AWS Academy copie las credenciales de 'AWS Details' a ~/.aws/credentials (caducan al terminar la sesión del laboratorio)."
}

# ------------------------------------------------------------------------------------------------ verificar
cmd_verificar() {
  paso "Verificando herramientas y permisos (no se crea nada)"
  local fallos=0
  sonda() { # sonda "descripción" comando...  -> ✔ si el comando termina bien
    local desc="$1"; shift
    if salida="$("$@" 2>&1)"; then ok "${desc}"; else falla "${desc}  →  ${salida%%$'\n'*}"; fallos=$((fallos + 1)); fi
  }

  for c in aws docker openssl curl; do
    if command -v "${c}" >/dev/null 2>&1; then ok "herramienta instalada: ${c}"; else falla "falta la herramienta: ${c}"; fallos=$((fallos + 1)); fi
  done
  command -v aws >/dev/null 2>&1 || { falla "sin AWS CLI no se pueden probar los permisos"; return 1; }
  resolver_region

  sonda "Docker accesible (docker info)" docker info
  if CUENTA="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"; then
    ok "credenciales AWS válidas (cuenta ${CUENTA}, región ${REGION})"
  else
    falla "credenciales AWS no válidas: copie las de 'AWS Details' (AWS Academy) a ~/.aws/credentials"; return 1
  fi
  case "${REGION}" in us-east-1|us-west-2) ;; *) aviso "AWS Academy sólo permite us-east-1 y us-west-2; la región actual es ${REGION}";; esac

  sonda "EC2/VPC: listar VPCs"                      aws ec2 describe-vpcs --query 'length(Vpcs)' --output text
  sonda "RDS: PostgreSQL en la clase db.t3.micro"   bash -c "[ \"\$(aws rds describe-orderable-db-instance-options --engine postgres --db-instance-class db.t3.micro --max-items 1 --query 'length(OrderableDBInstanceOptions)' --output text)\" -ge 1 ]"
  local versiones
  versiones="$(aws rds describe-db-engine-versions --engine postgres --query "DBEngineVersions[?starts_with(EngineVersion,'17')].EngineVersion" --output text 2>/dev/null || true)"
  if [ -n "${versiones}" ]; then ok "RDS: PostgreSQL 17 disponible (${versiones})"; else aviso "RDS: no se listó PostgreSQL 17; ajuste DbEngineVersion en la plantilla (p. ej. 16)"; fi
  sonda "ELB: Application Load Balancer"           aws elbv2 describe-load-balancers --query 'length(LoadBalancers)' --output text
  sonda "Auto Scaling: grupos"                      aws autoscaling describe-auto-scaling-groups --query 'length(AutoScalingGroups)' --output text
  sonda "ECR: repositorios"                         aws ecr describe-repositories --query 'length(repositories)' --output text
  sonda "S3: listar buckets (imágenes del panel)"   aws s3api list-buckets --query 'length(Buckets)' --output text
  sonda "CloudFormation: pilas"                     aws cloudformation list-stacks --max-items 1
  if aws acm list-certificates --max-items 1 >/dev/null 2>&1; then ok "ACM: certificados disponibles (necesario sólo para HTTPS con dominio propio)"; else aviso "ACM no disponible en esta cuenta: con dominio use el modo 'Flexible' de Cloudflare (ver docs/DOMINIO-CLOUDFLARE.md)"; fi
  sonda "SSM: AMI de Amazon Linux 2023"             aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text
  if aws iam get-instance-profile --instance-profile-name LabInstanceProfile --query 'InstanceProfile.InstanceProfileName' --output text >/dev/null 2>&1; then
    ok "IAM: perfil de instancia LabInstanceProfile existe"
  else
    aviso "no se pudo comprobar LabInstanceProfile (en AWS Academy suele existir aunque IAM no permita consultarlo); si el despliegue falla, indique otro con InstanceProfileName"
  fi

  echo
  if [ "${fallos}" -eq 0 ]; then ok "Todo en orden: puede ejecutar './scripts/desplegar.sh up'"; else falla "${fallos} comprobación(es) fallaron. Corrija antes de desplegar."; return 1; fi
}

# ------------------------------------------------------------------------------------------------ secretos locales
asegurar_secretos() {
  mkdir -p "${ESTADO}"
  chmod 700 "${ESTADO}"
  if [ ! -f "${SECRETOS}" ]; then
    umask 077
    {
      echo "DB_PASSWORD=$(openssl rand -hex 16)"
      echo "SESSION_SECRET=$(openssl rand -hex 32)"
      echo "ADMIN_EMAIL=${PNK_ADMIN_EMAIL:-admin@cartapnk.cl}"
      echo "ADMIN_PASSWORD=$(openssl rand -hex 10)"
    } > "${SECRETOS}"
    SECRETOS_NUEVOS=1
  else
    SECRETOS_NUEVOS=0
  fi
  # shellcheck disable=SC1090
  . "${SECRETOS}"
}

# ------------------------------------------------------------------------------------------------ imagen (ECR)
construir_y_subir() {
  local registro="${CUENTA}.dkr.ecr.${REGION}.amazonaws.com"
  aws ecr describe-repositories --repository-names "${REPO}" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "${REPO}" --image-scanning-configuration scanOnPush=true >/dev/null
  ok "repositorio ECR: ${REPO}"

  local etiqueta="${PNK_IMAGE_TAG:-$(git -C "${RAIZ}" rev-parse --short HEAD 2>/dev/null || echo local)-$(date +%Y%m%d%H%M%S)}"
  # un solo repositorio ECR con dos imágenes, distinguidas por la etiqueta: back-<tag> (API) y front-<tag> (sitio web con Nginx)
  IMAGEN_BACK="${registro}/${REPO}:back-${etiqueta}"
  IMAGEN_FRONT="${registro}/${REPO}:front-${etiqueta}"

  if [ "${SIN_BUILD:-0}" = "1" ] && [ -f "${ULTIMA_IMAGEN}" ] && [ "$(wc -l < "${ULTIMA_IMAGEN}")" -ge 2 ]; then
    IMAGEN_BACK="$(sed -n 1p "${ULTIMA_IMAGEN}")"
    IMAGEN_FRONT="$(sed -n 2p "${ULTIMA_IMAGEN}")"
    ok "se reutilizan las últimas imágenes: ${IMAGEN_BACK} y ${IMAGEN_FRONT}"
    return
  fi

  paso "Construyendo las imágenes (backend: etapa 'produccion'; frontend: Nginx)"
  aviso "En un servidor de 1 GB de RAM necesita swap activo (ver docs/PUBLICACION.md); puede tardar varios minutos."
  docker build --target produccion -t "${IMAGEN_BACK}" "${RAIZ}/backend"
  docker build -t "${IMAGEN_FRONT}" "${RAIZ}/frontend"
  paso "Subiendo las imágenes a ECR"
  aws ecr get-login-password | docker login --username AWS --password-stdin "${registro}" >/dev/null
  docker push "${IMAGEN_BACK}"
  docker push "${IMAGEN_FRONT}"
  { echo "${IMAGEN_BACK}"; echo "${IMAGEN_FRONT}"; } > "${ULTIMA_IMAGEN}"
  ok "imágenes publicadas: ${IMAGEN_BACK} y ${IMAGEN_FRONT}"
}

# ------------------------------------------------------------------------------------------------ pila
salida_pila() { # salida_pila Clave
  aws cloudformation describe-stacks --stack-name "${STACK}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null
}

estado_pila() {
  aws cloudformation describe-stacks --stack-name "${STACK}" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NO_EXISTE"
}

eventos_fallidos() {
  echo
  falla "La pila no se pudo crear/actualizar. Eventos con error:"
  aws cloudformation describe-stack-events --stack-name "${STACK}" \
    --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" --output text 2>/dev/null | head -n 12 | sed 's/^/     /' || true
}

desplegar_pila() {
  paso "Creando/actualizando la infraestructura (CloudFormation: pila '${STACK}')"
  aviso "La primera vez tarda ~10-15 minutos (la base de datos RDS es lo más lento). No cierre la terminal."
  # Dominio propio + HTTPS: si existe un certificado de ACM (comando 'certificado'), el balanceador agrega :443 y la cookie pasa a Secure.
  local cert="${PNK_CERT_ARN:-}"
  if [ -z "${cert}" ] && [ -f "${CERT_FILE}" ]; then cert="$(cat "${CERT_FILE}")"; fi
  local cookie_secure="${PNK_COOKIE_SECURE:-}"
  if [ -z "${cookie_secure}" ]; then if [ -n "${cert}" ]; then cookie_secure=true; else cookie_secure=false; fi; fi
  if [ -n "${cert}" ]; then
    local estado_cert
    estado_cert="$(aws acm describe-certificate --certificate-arn "${cert}" --query Certificate.Status --output text 2>/dev/null || echo DESCONOCIDO)"
    [ "${estado_cert}" = "ISSUED" ] \
      || die "El certificado ${cert} está en estado '${estado_cert}'. Complete la validación DNS en Cloudflare (./scripts/desplegar.sh certificado <dominio>) antes de desplegar con HTTPS."
    ok "HTTPS activado con el certificado de ACM (cookie Secure: ${cookie_secure})"
  fi
  local params=(
    "BackImageUri=${IMAGEN_BACK}"
    "FrontImageUri=${IMAGEN_FRONT}"
    "DbPassword=${DB_PASSWORD}"
    "SessionSecret=${SESSION_SECRET}"
    "AdminEmail=${ADMIN_EMAIL}"
    "AdminPassword=${ADMIN_PASSWORD}"
    "InstanceType=${PNK_INSTANCE_TYPE:-t3.small}"
    "AsgMinSize=${PNK_ASG_MIN:-2}"
    "AsgDesiredCapacity=${PNK_ASG_DESIRED:-2}"
    "AsgMaxSize=${PNK_ASG_MAX:-4}"
    "CookieSecure=${cookie_secure}"
    "TrustProxy=${PNK_TRUST_PROXY:-3}"
    "SeedCatalogo=${PNK_SEED_CATALOGO:-false}"
    "DbMultiAz=${PNK_DB_MULTIAZ:-true}"
  )
  [ -z "${cert}" ] || params+=("CertificateArn=${cert}")
  # ajustes opcionales según lo que permita su laboratorio
  [ -z "${PNK_DB_ENGINE_VERSION:-}" ] || params+=("DbEngineVersion=${PNK_DB_ENGINE_VERSION}")
  [ -z "${PNK_DB_CLASS:-}" ] || params+=("DbInstanceClass=${PNK_DB_CLASS}")
  [ -z "${PNK_INSTANCE_PROFILE:-}" ] || params+=("InstanceProfileName=${PNK_INSTANCE_PROFILE}")
  if ! aws cloudformation deploy --stack-name "${STACK}" --template-file "${PLANTILLA}" \
        --parameter-overrides "${params[@]}" --no-fail-on-empty-changeset --tags proyecto=cartapnk; then
    eventos_fallidos
    die "Revise el error anterior (o ejecute './scripts/desplegar.sh down' para limpiar y reintentar)."
  fi
  ok "pila lista: $(estado_pila)"
}

esperar_salud() {
  paso "Esperando a que el balanceador marque las instancias como saludables"
  local tg objetivo=1 sanas=0 intentos=0   # basta una instancia sana para servir; las demás se suman solas
  tg="$(salida_pila TargetGroupArn)"
  [ -n "${tg}" ] || die "No se encontró el Target Group en las salidas de la pila."
  while [ "${intentos}" -lt 60 ]; do
    sanas="$(aws elbv2 describe-target-health --target-group-arn "${tg}" --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])" --output text 2>/dev/null || echo 0)"
    printf '\r  instancias saludables: %s (esperando %s)   ' "${sanas}" "${objetivo}"
    [ "${sanas}" -ge "${objetivo}" ] && break
    sleep 15; intentos=$((intentos + 1))
  done
  echo
  [ "${sanas}" -ge "${objetivo}" ] || { aviso "Aún no hay instancias saludables. Revise 'status' y, si persiste, /var/log/pnk-userdata.log en una instancia (ver docs)."; return 0; }
  ok "el balanceador ya envía tráfico a ${sanas} instancia(s)"
}

# Datos reales del balanceador (consultados a AWS por su DNS, no inferidos de la pila): "nombre estado tipo esquema"
balanceador_info() {
  local dns; dns="$(salida_pila LoadBalancerDns 2>/dev/null || true)"
  [ -n "${dns}" ] && [ "${dns}" != "None" ] || return 1
  aws elbv2 describe-load-balancers --query "LoadBalancers[?DNSName=='${dns}'].[LoadBalancerName,State.Code,Type,Scheme]" --output text 2>/dev/null
}

# Imprime el balanceador y sus listeners (puertos/protocolos). Si no existe, explica cómo diagnosticarlo.
mostrar_balanceador() {
  local info dns arn
  info="$(balanceador_info || true)"
  if [ -z "${info}" ] || [ "${info}" = "None" ]; then
    falla "No se encontró el balanceador de carga (ALB) en la región ${REGION}."
    echo "     Compruebe que la consola de AWS esté en la misma región (arriba a la derecha: ${REGION}) y que la pila haya terminado:"
    echo "       ./scripts/desplegar.sh status          aws cloudformation describe-stack-resources --stack-name ${STACK} --query \"StackResources[?ResourceType=='AWS::ElasticLoadBalancingV2::LoadBalancer']\""
    return 1
  fi
  dns="$(salida_pila LoadBalancerDns)"
  # shellcheck disable=SC2086
  set -- ${info}
  ok "balanceador de carga: $1  (estado: $2, tipo: $3, esquema: $4, región ${REGION})"
  arn="$(aws elbv2 describe-load-balancers --query "LoadBalancers[?DNSName=='${dns}'].LoadBalancerArn" --output text 2>/dev/null)"
  aws elbv2 describe-listeners --load-balancer-arn "${arn}" --query 'Listeners[].[Protocol,Port]' --output text 2>/dev/null | sed 's/^/     listener: /'
}

resumen() {
  local url; url="$(salida_pila ApplicationUrl)"
  echo
  printf '%s==============================================================================%s\n' "${NEGRITA}" "${FIN}"
  printf '%s Aplicación desplegada%s\n' "${NEGRITA}" "${FIN}"
  printf '   URL (HTTP):   %s\n' "${url}"
  printf '   Salud:        %s/salud\n' "${url}"
  printf '   Balanceador:  %s  (región %s)\n' "$(balanceador_info | awk '{print $1" ["$2"]"}' || true)" "${REGION}"
  printf '   Base de datos: RDS PostgreSQL (privada): %s\n' "$(salida_pila DatabaseEndpoint)"
  printf '   Panel admin:  %s/admin   (imágenes en S3: %s)\n' "${url}" "$(salida_pila MediaBucketName)"
  printf '   Administrador: %s\n' "${ADMIN_EMAIL}"
  if [ "${SECRETOS_NUEVOS:-0}" = "1" ]; then
    printf '   Contraseña:    %s   (se muestra SOLO ahora; queda también en %s)\n' "${ADMIN_PASSWORD}" "${SECRETOS}"
  else
    printf '   Contraseña:    en %s\n' "${SECRETOS}"
  fi
  printf '%s==============================================================================%s\n' "${NEGRITA}" "${FIN}"
  echo
  echo "Siguientes pasos:"
  echo "  • HTTPS con Cloudflare (manual):  ./scripts/desplegar.sh tunel      (ver docs/DESPLIEGUE-AWS.md, sección Cloudflare)"
  echo "  • Probar el Auto Scaling:         ./scripts/desplegar.sh carga      y  ./scripts/desplegar.sh status"
  echo "  • AL TERMINAR la demostración:    ./scripts/desplegar.sh down       (la infraestructura cuesta dinero mientras exista)"
}

# ------------------------------------------------------------------------------------------------ versiones (CI/CD)
# Comandos pensados para que Jenkins los invoque sin intervención humana:
#   construir <version>            construye y publica en ECR las imágenes back-<version> y front-<version>
#   publicar <ambiente> <version>  despliega esa versión en el ambiente y VERIFICA que el servicio la esté sirviendo
#   revertir <ambiente>            vuelve a publicar la versión anterior de ese ambiente
#   versiones [<ambiente>]         muestra la versión publicada, la anterior y las disponibles en ECR
# Códigos de salida: 0 = éxito · 1 = error de despliegue · 2 = parámetros inválidos o falta un requisito · 3 = la verificación falló
# PNK_REVERTIR_SI_FALLA=1 vuelve sola a la versión anterior si la verificación falla · PNK_DOMINIO=<dominio> verifica también por HTTPS
EXIT_PARAMETROS=2
EXIT_VERIFICACION=3
terminar() { local codigo="$1"; shift; printf '%sError:%s %s\n' "${ROJO}" "${FIN}" "$*" >&2; exit "${codigo}"; }

# Ambientes de AWS: cada uno es una pila de CloudFormation independiente.
usar_ambiente() {
  case "${1:-}" in
    pruebas) STACK="${PNK_STACK:-cartapnk}" ;;
    produccion) STACK="${PNK_STACK_PRODUCCION:-cartapnk-produccion}" ;;
    *) terminar "${EXIT_PARAMETROS}" "Ambiente inválido: '${1:-}'. Valores permitidos: pruebas, produccion" ;;
  esac
  AMBIENTE="$1"
}

validar_version() {
  [[ "${1:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] \
    || terminar "${EXIT_PARAMETROS}" "Versión inválida: '${1:-}'. Use letras, números, '.', '_' o '-' (p. ej. 1.4.0 o el hash corto del commit)"
}

imagenes_de() { # imagenes_de <version> -> deja IMAGEN_BACK e IMAGEN_FRONT
  local registro="${CUENTA}.dkr.ecr.${REGION}.amazonaws.com"
  IMAGEN_BACK="${registro}/${REPO}:back-$1"
  IMAGEN_FRONT="${registro}/${REPO}:front-$1"
}

existen_imagenes() { # existen_imagenes <version> -> 0 si back-<v> y front-<v> están en ECR
  local n
  n="$(aws ecr describe-images --repository-name "${REPO}" --image-ids "imageTag=back-$1" "imageTag=front-$1" \
        --query 'length(imageDetails)' --output text 2>/dev/null || echo 0)"
  [ "${n}" = "2" ]
}

version_publicada() { # versión que la pila está sirviendo (la etiqueta de la imagen de la API), o vacío
  local uri
  uri="$(aws cloudformation describe-stacks --stack-name "${STACK}" \
          --query "Stacks[0].Parameters[?ParameterKey=='BackImageUri'].ParameterValue" --output text 2>/dev/null || true)"
  [[ "${uri}" == *":back-"* ]] && echo "${uri##*:back-}"
}

etiqueta_pila() { # etiqueta_pila <clave>
  aws cloudformation describe-stacks --stack-name "${STACK}" --query "Stacks[0].Tags[?Key=='$1'].Value" --output text 2>/dev/null || true
}

cmd_construir() {
  local version="${1:-}"
  validar_version "${version}"
  requisitos
  aws ecr describe-repositories --repository-names "${REPO}" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "${REPO}" --image-scanning-configuration scanOnPush=true >/dev/null
  imagenes_de "${version}"
  if existen_imagenes "${version}"; then
    ok "la versión ${version} ya está en ECR (las imágenes son inmutables: no se reconstruye)"
    return 0
  fi
  local commit; commit="$(git -C "${RAIZ}" rev-parse HEAD 2>/dev/null || echo desconocido)"
  paso "Construyendo la versión ${version} (commit ${commit:0:12})"
  docker build --target produccion --build-arg "APP_VERSION=${version}" --build-arg "GIT_COMMIT=${commit}" -t "${IMAGEN_BACK}" "${RAIZ}/backend" \
    || terminar 1 "Falló la construcción de la imagen de la API"
  docker build -t "${IMAGEN_FRONT}" "${RAIZ}/frontend" || terminar 1 "Falló la construcción de la imagen del frontend"
  paso "Publicando en ECR"
  aws ecr get-login-password | docker login --username AWS --password-stdin "${IMAGEN_BACK%%/*}" >/dev/null
  docker push "${IMAGEN_BACK}" >/dev/null || terminar 1 "No se pudo publicar ${IMAGEN_BACK}"
  docker push "${IMAGEN_FRONT}" >/dev/null || terminar 1 "No se pudo publicar ${IMAGEN_FRONT}"
  ok "publicadas: back-${version} y front-${version}"
}

# Comprueba que el servicio responda con la versión esperada en N respuestas SEGUIDAS (así se cubren todas las instancias
# detrás del balanceador). Devuelve 0 si lo logra antes del plazo.
comprobar_version() { # comprobar_version <url-base> <version> <consecutivas> <plazo-segundos>
  local base="$1" esperada="$2" necesarias="$3" plazo="$4"
  local inicio seguidas=0 respuesta version instancias=""
  inicio="$(date +%s)"
  while [ $(( $(date +%s) - inicio )) -lt "${plazo}" ]; do
    respuesta="$(curl -fsS --max-time 10 -H 'Cache-Control: no-cache' "${base}/api/version" 2>/dev/null || true)"
    version="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' <<<"${respuesta}")"
    if [ "${version}" = "${esperada}" ]; then
      seguidas=$((seguidas + 1))
      instancias="${instancias} $(sed -n 's/.*"instancia":"\([^"]*\)".*/\1/p' <<<"${respuesta}")"
      if [ "${seguidas}" -ge "${necesarias}" ]; then
        ok "${base} sirve la versión ${esperada} (${seguidas} respuestas seguidas; instancias:$(tr ' ' '\n' <<<"${instancias}" | sort -u | tr '\n' ' '))"
        return 0
      fi
    else
      [ "${seguidas}" -gt 0 ] && aviso "respuesta con versión '${version:-sin respuesta}': se reinicia la cuenta"
      seguidas=0; instancias=""
    fi
    sleep 5
  done
  return 1
}

cmd_publicar() {
  local ambiente="${1:-}" version="${2:-}"
  usar_ambiente "${ambiente}"
  validar_version "${version}"
  [ -f "${PLANTILLA}" ] || terminar "${EXIT_PARAMETROS}" "No se encuentra ${PLANTILLA}"
  requisitos
  paso "Publicar versión ${version} en '${AMBIENTE}' (pila ${STACK} · cuenta ${CUENTA} · región ${REGION})"

  imagenes_de "${version}"
  if ! existen_imagenes "${version}"; then
    [ "${PNK_SIN_CONSTRUIR:-0}" = "1" ] && terminar "${EXIT_PARAMETROS}" "La versión ${version} no existe en ECR (ejecute antes: ./scripts/desplegar.sh construir ${version})"
    cmd_construir "${version}"
  fi

  local anterior estado
  estado="$(estado_pila)"
  anterior="$(version_publicada || true)"
  if [ "${estado}" = "NO_EXISTE" ]; then
    # primera vez: se crea toda la infraestructura (secretos generados y guardados sólo en este equipo)
    aviso "La pila '${STACK}' no existe: se crea completa (~15 min)."
    asegurar_secretos
    desplegar_pila
  else
    [[ "${estado}" == *_COMPLETE ]] || terminar 1 "La pila está en estado ${estado}; espere a que termine o revísela antes de publicar."
    if [ "${anterior}" = "${version}" ]; then ok "la versión ${version} ya está publicada en '${AMBIENTE}' (se verifica igual)"; fi
    # Actualización: SÓLO cambian las imágenes. El resto de parámetros (contraseñas incluidas) conserva su valor anterior,
    # así Jenkins nunca necesita ni imprime secretos.
    paso "Actualizando las imágenes (rolling update: las instancias se reemplazan de a una, sin cortar el servicio)"
    aws cloudformation deploy --stack-name "${STACK}" --template-file "${PLANTILLA}" \
        --parameter-overrides "BackImageUri=${IMAGEN_BACK}" "FrontImageUri=${IMAGEN_FRONT}" \
        --no-fail-on-empty-changeset \
        --tags proyecto=cartapnk "ambiente=${AMBIENTE}" "version=${version}" "version-anterior=${anterior:-ninguna}" \
      || { eventos_fallidos; terminar 1 "Falló la actualización de la pila (CloudFormation revierte solo a la versión anterior)."; }
  fi
  ok "pila lista: $(estado_pila)"

  paso "Verificando el servicio"
  local url; url="$(salida_pila ApplicationUrl)"
  [ -n "${url}" ] || terminar "${EXIT_VERIFICACION}" "La pila no informa la URL del balanceador."
  curl -fsS --max-time 10 "${url}/salud" >/dev/null 2>&1 || aviso "/salud aún no responde 200; se reintenta en la comprobación de versión"
  local motivo=""
  comprobar_version "${url}" "${version}" "${PNK_VERIFICAR_RESPUESTAS:-6}" "${PNK_VERIFICAR_SEGUNDOS:-600}" \
    || motivo="El balanceador no sirvió la versión ${version} dentro del plazo. Diagnóstico: ./scripts/desplegar.sh status"
  if [ -z "${motivo}" ] && [ -n "${PNK_DOMINIO:-}" ]; then
    comprobar_version "https://${PNK_DOMINIO}" "${version}" 3 "${PNK_VERIFICAR_SEGUNDOS:-600}" \
      || motivo="https://${PNK_DOMINIO} no sirve la versión ${version} (revise Cloudflare: ./scripts/desplegar.sh dominio)"
  fi
  if [ -n "${motivo}" ]; then
    # PNK_REVERTIR_SI_FALLA=1: si la verificación falla se vuelve sola a la versión anterior (el código de salida sigue siendo 3)
    if [ "${PNK_REVERTIR_SI_FALLA:-0}" = "1" ] && [ -n "${anterior}" ] && [ "${anterior}" != "${version}" ]; then
      falla "${motivo}"
      aviso "Reversión automática a la versión ${anterior}"
      ( PNK_REVERTIR_SI_FALLA=0 PNK_SIN_CONSTRUIR=1 cmd_publicar "${ambiente}" "${anterior}" ) || falla "la reversión automática también falló"
    fi
    terminar "${EXIT_VERIFICACION}" "${motivo}"
  fi
  echo
  ok "PUBLICADA: versión ${version} en '${AMBIENTE}' (anterior: ${anterior:-ninguna}). Para volver atrás: ./scripts/desplegar.sh revertir ${AMBIENTE}"
}

cmd_revertir() {
  local ambiente="${1:-}"
  usar_ambiente "${ambiente}"
  requisitos
  local anterior; anterior="$(etiqueta_pila version-anterior)"
  { [ -n "${anterior}" ] && [ "${anterior}" != "None" ] && [ "${anterior}" != "ninguna" ]; } \
    || terminar "${EXIT_PARAMETROS}" "No hay una versión anterior registrada para '${AMBIENTE}'. Publique una versión concreta: ./scripts/desplegar.sh publicar ${AMBIENTE} <version>"
  aviso "Se vuelve a la versión ${anterior} en '${AMBIENTE}'."
  PNK_SIN_CONSTRUIR=1 cmd_publicar "${ambiente}" "${anterior}"
}

cmd_versiones() {
  usar_ambiente "${1:-pruebas}"
  requisitos
  paso "Versiones de '${AMBIENTE}' (pila ${STACK})"
  echo "  publicada: $(version_publicada || echo '-')"
  echo "  anterior:  $(etiqueta_pila version-anterior)"
  paso "Disponibles en ECR (${REPO}), las más recientes primero"
  aws ecr describe-images --repository-name "${REPO}" --filter tagStatus=TAGGED \
    --query 'reverse(sort_by(imageDetails,&imagePushedAt))[].[imagePushedAt,join(`,`,imageTags)]' --output text 2>/dev/null \
    | grep 'back-' | head -n 10 | sed 's/back-//; s/^/  /' || echo "  (sin imágenes)"
}

# ------------------------------------------------------------------------------------------------ prueba de continuidad
# Retira de forma controlada UNO de los destinos del balanceador mientras se hacen solicitudes periódicas a una ruta dinámica
# sin caché (/api/version, llega a Node.js) y registra cada respuesta. Fases: antes (ambos destinos sanos) -> durante (un destino
# retirado) -> después (destino restituido). Deja un CSV con: fase, hora, código HTTP, instancia que respondió y tiempo.
cmd_continuidad() {
  local destino_url="${1:-}" segundos_fase="${2:-45}"
  [ -n "${destino_url}" ] || terminar "${EXIT_PARAMETROS}" "Uso: ./scripts/desplegar.sh continuidad <dominio|url> [segundos-por-fase]   (p. ej. continuidad ejemplo.com 45)"
  [[ "${destino_url}" == http* ]] || destino_url="https://${destino_url}"
  [[ "${segundos_fase}" =~ ^[0-9]+$ ]] || terminar "${EXIT_PARAMETROS}" "segundos-por-fase debe ser un número"
  usar_ambiente "${PNK_AMBIENTE:-pruebas}"
  requisitos

  local tg; tg="$(salida_pila TargetGroupArn)"
  [ -n "${tg}" ] && [ "${tg}" != "None" ] || terminar 1 "No se encontró el Target Group de la pila ${STACK}"
  local sanos; sanos="$(aws elbv2 describe-target-health --target-group-arn "${tg}" --query "TargetHealthDescriptions[?TargetHealth.State=='healthy'].Target.Id" --output text)"
  [ "$(wc -w <<<"${sanos}")" -ge 2 ] || terminar 1 "Se necesitan al menos 2 destinos sanos (hay: ${sanos:-ninguno})"
  local retirado; retirado="$(awk '{print $1}' <<<"${sanos}")"

  mkdir -p "${ESTADO}"
  local csv; csv="${ESTADO}/continuidad-$(date +%Y%m%d-%H%M%S).csv"
  echo "fase,hora,codigo,instancia,segundos" > "${csv}"
  local fase_archivo; fase_archivo="$(mktemp)"; echo "antes" > "${fase_archivo}"

  # sondeo en segundo plano: 1 solicitud por segundo
  (
    while [ -f "${fase_archivo}" ]; do
      local r codigo cuerpo
      r="$(curl -s --max-time 5 -H 'Cache-Control: no-cache' -w '\n%{http_code} %{time_total}' "${destino_url}/api/version?t=$(date +%s%N)" 2>/dev/null || printf '\n000 5')"
      codigo="$(tail -n1 <<<"${r}" | awk '{print $1}')"
      cuerpo="$(sed '$d' <<<"${r}")"
      echo "$(cat "${fase_archivo}" 2>/dev/null || echo fin),$(date +%H:%M:%S),${codigo},$(sed -n 's/.*"instancia":"\([^"]*\)".*/\1/p' <<<"${cuerpo}"),$(tail -n1 <<<"${r}" | awk '{print $2}')" >> "${csv}"
      sleep 1
    done
  ) &
  local sondeo=$!

  paso "Fase 1/3 · ambos destinos sanos (${segundos_fase} s) · URL ${destino_url}/api/version"
  sleep "${segundos_fase}"

  echo "durante" > "${fase_archivo}"
  paso "Fase 2/3 · se retira el destino ${retirado} del balanceador"
  aws elbv2 deregister-targets --target-group-arn "${tg}" --targets "Id=${retirado}"
  aws elbv2 wait target-deregistered --target-group-arn "${tg}" --targets "Id=${retirado}" || true
  ok "destino retirado (el balanceador drenó sus conexiones antes de sacarlo)"
  sleep "${segundos_fase}"

  echo "despues" > "${fase_archivo}"
  paso "Fase 3/3 · se restituye el destino ${retirado}"
  aws elbv2 register-targets --target-group-arn "${tg}" --targets "Id=${retirado}"
  aws elbv2 wait target-in-service --target-group-arn "${tg}" --targets "Id=${retirado}" || aviso "el destino tarda en volver a estar sano; revise 'status'"
  ok "destino restituido y sano"
  sleep "${segundos_fase}"

  rm -f "${fase_archivo}"; wait "${sondeo}" 2>/dev/null || true

  paso "Resultado (archivo: ${csv})"
  awk -F, 'NR>1 {
      total[$1]++; if ($3 != "200") { err[$1]++; racha++; if (racha > max) max = racha } else racha = 0
      if ($4 != "") inst[$1] = inst[$1] (index(inst[$1], $4) ? "" : " " $4)
    }
    END {
      split("antes durante despues", f, " ")
      for (i = 1; i <= 3; i++) printf "  %-8s solicitudes=%-4d errores=%-3d instancias:%s\n", f[i], total[f[i]], err[f[i]] + 0, inst[f[i]]
      printf "  interrupción más larga: %d s (solicitudes consecutivas fallidas a 1 por segundo)\n", max
    }' "${csv}"
}

# ------------------------------------------------------------------------------------------------ comandos
cmd_up() {
  [ -f "${PLANTILLA}" ] || die "No se encuentra ${PLANTILLA}"
  requisitos
  paso "Cuenta ${CUENTA} · región ${REGION} · pila '${STACK}'"
  asegurar_secretos
  construir_y_subir
  desplegar_pila
  esperar_salud
  resumen
}

cmd_status() {
  requisitos
  local estado; estado="$(estado_pila)"
  paso "Pila '${STACK}': ${estado}"
  [ "${estado}" != "NO_EXISTE" ] || { echo "  (no está desplegada)"; return 0; }
  echo "  URL: $(salida_pila ApplicationUrl)"

  local asg tg
  asg="$(salida_pila AutoScalingGroupName)"; tg="$(salida_pila TargetGroupArn)"
  paso "Auto Scaling Group"
  aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "${asg}" \
    --query 'AutoScalingGroups[0].[MinSize,DesiredCapacity,MaxSize]' --output text | awk '{printf "  mínimo=%s  deseadas=%s  máximo=%s\n",$1,$2,$3}'
  aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "${asg}" \
    --query 'AutoScalingGroups[0].Instances[].[InstanceId,AvailabilityZone,LifecycleState,HealthStatus]' --output text | sed 's/^/  /'

  paso "Balanceador de carga (ALB)"
  mostrar_balanceador || true

  paso "Salud en el balanceador"
  aws elbv2 describe-target-health --target-group-arn "${tg}" \
    --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Description]' --output text | sed 's/^/  /'

  paso "Base de datos (RDS)"
  aws rds describe-db-instances --query "DBInstances[?Endpoint.Address=='$(salida_pila DatabaseEndpoint)'].[DBInstanceIdentifier,DBInstanceStatus,Engine,EngineVersion,DBInstanceClass]" --output text | sed 's/^/  /'
}

cmd_url() { requisitos; salida_pila ApplicationUrl; }

# Solicita un certificado de ACM para su dominio y guía la validación por DNS en Cloudflare (paso manual).
cmd_certificado() {
  local dominio="${1:-}"
  [ -n "${dominio}" ] || die "Uso: ./scripts/desplegar.sh certificado <subdominio.sudominio.com>   (p. ej. menu.cartapnk.xyz)"
  [[ "${dominio}" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$ ]] || die "Dominio no válido: ${dominio}"
  requisitos
  paso "Certificado de ACM para ${dominio} (validación por DNS)"
  mkdir -p "${ESTADO}"
  local arn
  arn="$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='${dominio}'].CertificateArn | [0]" --output text 2>/dev/null || true)"
  if [ -z "${arn}" ] || [ "${arn}" = "None" ]; then
    arn="$(aws acm request-certificate --domain-name "${dominio}" --validation-method DNS --query CertificateArn --output text)"
    ok "solicitud creada"
  else
    ok "ya existía una solicitud para ese dominio"
  fi
  echo "${arn}" > "${CERT_FILE}"

  local nombre="" valor="" i
  for i in $(seq 1 30); do
    nombre="$(aws acm describe-certificate --certificate-arn "${arn}" --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Name' --output text 2>/dev/null || true)"
    [ -n "${nombre}" ] && [ "${nombre}" != "None" ] && break
    sleep 5
  done
  [ -n "${nombre}" ] && [ "${nombre}" != "None" ] || die "ACM aún no entregó el registro de validación; reintente en un minuto."
  valor="$(aws acm describe-certificate --certificate-arn "${arn}" --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Value' --output text)"

  echo
  printf '%s==============================================================================%s\n' "${NEGRITA}" "${FIN}"
  printf '%s Cree este registro en Cloudflare (DNS → Records → Add record)%s\n' "${NEGRITA}" "${FIN}"
  printf '   Tipo:           CNAME\n'
  printf '   Nombre:         %s\n' "${nombre%.}"
  printf '   Destino:        %s\n' "${valor%.}"
  printf '   Proxy status:   DNS only  (nube GRIS, sin proxy)\n'
  printf '%s==============================================================================%s\n' "${NEGRITA}" "${FIN}"
  echo
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    paso "Creando el registro de validación en Cloudflare con su token (automático)"
    cf_zona "${dominio}"
    cf_registro CNAME "${nombre%.}" "${valor%.}" false
  else
    aviso "Sin CLOUDFLARE_API_TOKEN: cree el registro a mano (o automatice: ver docs/DOMINIO-CLOUDFLARE.md, 'Automatizar con la API')."
  fi
  paso "Esperando la validación (2-10 min después de crear el registro; Ctrl+C para salir y volver a ejecutar este comando luego)"
  aws acm wait certificate-validated --certificate-arn "${arn}"
  ok "certificado EMITIDO: ${arn}"
  echo
  echo "Siguiente paso:  ./scripts/desplegar.sh up --sin-build      (activa HTTPS en el balanceador); luego ./scripts/desplegar.sh dominio ${dominio} te dice qué crear en Cloudflare"
  echo "Después:  ./scripts/desplegar.sh cloudflare ${dominio}     (crea/corrige el CNAME del sitio y los ajustes de la zona; requiere CLOUDFLARE_API_TOKEN)"
}

# Pide https://<dominio>/salud y explica el resultado (código HTTP de Cloudflare / del sitio).
comprobar_dominio() {
  local dominio="$1"
  local codigo
  codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${dominio}/salud" 2>/dev/null || true)"
  case "${codigo}" in
    200) ok "https://${dominio}/salud responde 200: el dominio ya funciona" ;;
    000|"") aviso "https://${dominio} todavía no responde (DNS sin crear/propagar, o el sitio no está desplegado)" ;;
    525|526) falla "Cloudflare responde ${codigo}: revise el modo SSL (Full strict) y que el balanceador ya use el certificado (up --sin-build)" ;;
    522|523|524) falla "Cloudflare responde ${codigo}: el CNAME apunta a un balanceador que no existe o no responde (¿DNS del balanceador antiguo?)" ;;
    *) aviso "https://${dominio}/salud respondió ${codigo}" ;;
  esac
}

# Deja en DOMINIO y ARN_CERT el dominio y el certificado de ACM a usar: el indicado, o el guardado / único de la cuenta.
resolver_certificado() {
  local dominio="${1:-}" arn=""
  if [ -n "${dominio}" ]; then
    [[ "${dominio}" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$ ]] || die "Dominio no válido: ${dominio}"
    arn="$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='${dominio}'].CertificateArn | [0]" --output text 2>/dev/null || true)"
  else
    # sin argumento: se usa el certificado guardado o, si hay uno solo en la cuenta, ese
    if [ -f "${CERT_FILE}" ]; then arn="$(cat "${CERT_FILE}")"; fi
    if [ -z "${arn}" ]; then
      local lista
      lista="$(aws acm list-certificates --query 'CertificateSummaryList[].CertificateArn' --output text 2>/dev/null || true)"
      [ "$(wc -w <<<"${lista}")" -eq 1 ] && arn="${lista}"
    fi
    [ -n "${arn}" ] && [ "${arn}" != "None" ] || die "No hay un certificado que usar. Indique el dominio: ./scripts/desplegar.sh dominio cartapnk.xyz   (si es una cuenta nueva, primero: ./scripts/desplegar.sh certificado cartapnk.xyz)"
    dominio="$(aws acm describe-certificate --certificate-arn "${arn}" --query Certificate.DomainName --output text)"
  fi
  [ -n "${arn}" ] && [ "${arn}" != "None" ] || die "Esta cuenta de AWS no tiene un certificado para ${dominio}. Los certificados no pasan de una cuenta a otra: ejecute primero ./scripts/desplegar.sh certificado ${dominio}"
  mkdir -p "${ESTADO}"
  echo "${arn}" > "${CERT_FILE}"

  DOMINIO="${dominio}"
  ARN_CERT="${arn}"
}

# Imprime TODO lo que hay que crear/configurar en Cloudflare para el dominio, con los valores de ESTA cuenta de AWS, y comprueba
# el estado (certificado, HTTPS del balanceador, respuesta real del dominio). No crea nada en AWS: se puede ejecutar las veces que quiera.
cmd_dominio() {
  requisitos
  resolver_certificado "${1:-}"
  local dominio="${DOMINIO}" arn="${ARN_CERT}"

  paso "Configuración de Cloudflare para ${dominio}  (cuenta ${CUENTA}, región ${REGION})"
  local estado nombre valor
  estado="$(aws acm describe-certificate --certificate-arn "${arn}" --query Certificate.Status --output text)"
  nombre="$(aws acm describe-certificate --certificate-arn "${arn}" --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Name' --output text 2>/dev/null || true)"
  valor="$(aws acm describe-certificate --certificate-arn "${arn}" --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Value' --output text 2>/dev/null || true)"

  # ---- registro 1: validación del certificado (ACM)
  echo
  printf '%s REGISTRO 1 — validación del certificado de ACM%s   estado: %s\n' "${NEGRITA}" "${FIN}" "${estado}"
  if [ -n "${nombre}" ] && [ "${nombre}" != "None" ]; then
    printf '   Tipo:           CNAME\n   Nombre:         %s\n   Destino:        %s\n   Proxy status:   DNS only  (nube GRIS, sin proxy)\n' "${nombre%.}" "${valor%.}"
  fi
  case "${estado}" in
    ISSUED) ok "certificado emitido. Deje este registro en Cloudflare: ACM lo usa para renovarlo solo" ;;
    PENDING_VALIDATION) aviso "falta crear el registro y esperar 2-10 min (./scripts/desplegar.sh certificado ${dominio} espera la validación)" ;;
    *) falla "estado inesperado del certificado (${estado}): pida uno nuevo con ./scripts/desplegar.sh certificado ${dominio}" ;;
  esac

  # ---- registro 2: el sitio apunta al balanceador
  local lb https etiqueta
  lb="$(salida_pila LoadBalancerDns 2>/dev/null || true)"
  https="$(salida_pila HttpsEnabled 2>/dev/null || true)"
  if [ "$(tr -cd '.' <<<"${dominio}" | wc -c)" -le 1 ]; then etiqueta="@   (la raíz: ${dominio})"; else etiqueta="${dominio%%.*}"; fi
  echo
  printf '%s REGISTRO 2 — el sitio apunta al balanceador%s\n' "${NEGRITA}" "${FIN}"
  printf '   Tipo:           CNAME\n   Nombre:         %s\n' "${etiqueta}"
  if [ -n "${lb}" ] && [ "${lb}" != "None" ]; then
    printf '   Destino:        %s\n' "${lb}"
  else
    printf '   Destino:        (aún no hay pila: ejecute ./scripts/desplegar.sh up y repita este comando)\n'
  fi
  printf '   Proxy status:   Proxied  (nube NARANJA)\n'
  echo "   Si ya existe un registro con ese nombre, EDITE su destino (no cree otro). El DNS del balanceador cambia con cada pila nueva."

  # ---- ajuste 3
  echo
  printf '%s AJUSTE 3 — SSL/TLS → Overview%s: modo "Full (strict)"\n' "${NEGRITA}" "${FIN}"

  # ---- comprobaciones
  echo
  paso "Estado actual"
  if [ "${https}" = "true" ]; then
    ok "el balanceador ya sirve HTTPS (listener 443)"
  elif [ "${estado}" = "ISSUED" ] && [ -n "${lb}" ]; then
    aviso "el certificado está listo pero el balanceador aún no usa HTTPS: ejecute ./scripts/desplegar.sh up --sin-build"
  fi
  comprobar_dominio "${dominio}"
}

# ------------------------------------------------------------------------------------------------ Cloudflare (API)
# Automatiza lo que antes se hacía a mano en el panel de Cloudflare: registros DNS y ajustes de la zona.
# Necesita un token de API limitado a SU zona (ver docs/DOMINIO-CLOUDFLARE.md, sección "Automatizar con la API").
# Por decisión de diseño NO aplica reglas WAF, rate limiting ni Cloudflare Access (ver docs/PANEL-ADMIN.md): dependen de su IP y de su cuenta.
CF_API="https://api.cloudflare.com/client/v4"

# cf METODO RUTA [JSON] -> imprime la respuesta JSON. El token viaja por stdin (-K -): no queda en la lista de procesos ni en el historial.
cf() {
  local metodo="$1" ruta="$2" cuerpo="${3:-}"
  local args=(-sS --max-time 30 -X "${metodo}" -K - -H "Content-Type: application/json")
  [ -z "${cuerpo}" ] || args+=(--data "${cuerpo}")
  printf 'header = "Authorization: Bearer %s"\n' "${CF_TOKEN}" | curl "${args[@]}" "${CF_API}${ruta}"
}
cf_ok() { grep -Eq '"success": ?true' <<<"$1"; }
cf_error() { sed -n 's/.*"message": \{0,1\}"\([^"]*\)".*/\1/p' <<<"$1" | head -n 1; }

# Valida el token y obtiene el id de la zona (el dominio raíz: cartapnk.xyz). Deja ZONA_ID y ZONA_NOMBRE.
cf_zona() {
  local dominio="$1" zona="${PNK_CF_ZONA:-}" r
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || die "Falta el token de Cloudflare: export CLOUDFLARE_API_TOKEN=...   (cómo crearlo: docs/DOMINIO-CLOUDFLARE.md, sección 'Automatizar con la API')"
  CF_TOKEN="${CLOUDFLARE_API_TOKEN}"
  # zona = las dos últimas etiquetas (cartapnk.xyz). Para dominios del tipo midominio.co.uk indique PNK_CF_ZONA=midominio.co.uk
  if [ -z "${zona}" ]; then zona="$(awk -F. '{ print $(NF-1) "." $NF }' <<<"${dominio}")"; fi
  r="$(cf GET "/user/tokens/verify" || true)"
  cf_ok "${r}" || die "Cloudflare no aceptó el token: $(cf_error "${r}")"
  r="$(cf GET "/zones?name=${zona}" || true)"
  cf_ok "${r}" || die "Cloudflare rechazó la consulta de la zona ${zona}: $(cf_error "${r}"). El token necesita el permiso Zone → DNS → Edit sobre esa zona."
  ZONA_ID="$(sed -n 's/.*"result": \{0,1\}\[{"id": \{0,1\}"\([a-f0-9]\{32\}\)".*/\1/p' <<<"${r}")"
  [ -n "${ZONA_ID}" ] || die "El token no ve la zona '${zona}'. ¿Está agregado el dominio a Cloudflare y el token tiene acceso a esa zona? (¿Dominio tipo .co.uk? use PNK_CF_ZONA)"
  ZONA_NOMBRE="${zona}"
  ok "token de Cloudflare válido; zona ${ZONA_NOMBRE} (${ZONA_ID})"
}

# cf_registro TIPO NOMBRE CONTENIDO PROXIED [--reemplazar]
# Idempotente: si ya existe un registro con ese nombre y el mismo tipo, lo ACTUALIZA (así se corrige el destino cuando cambia el balanceador);
# si no existe, lo crea. Si existe otro de distinto tipo (p. ej. un A de estacionamiento del registrador) se detiene, salvo con --reemplazar.
cf_registro() {
  local tipo="$1" nombre="$2" contenido="$3" proxied="$4" reemplazar="${5:-}"
  [[ "${nombre}" =~ ^[a-zA-Z0-9_.-]+$ ]] && [[ "${contenido}" =~ ^[a-zA-Z0-9_.-]+$ ]] || die "Valores no válidos para el registro DNS (${nombre} → ${contenido})"
  local r id existente cuerpo
  r="$(cf GET "/zones/${ZONA_ID}/dns_records?name=${nombre}" || true)"
  cf_ok "${r}" || die "No se pudo consultar el DNS de Cloudflare: $(cf_error "${r}")"
  id="$(sed -n 's/.*"result": \{0,1\}\[{"id": \{0,1\}"\([a-f0-9]\{32\}\)".*/\1/p' <<<"${r}")"
  existente="$(sed -n 's/.*"result": \{0,1\}\[{[^}]*"type": \{0,1\}"\([A-Z]*\)".*/\1/p' <<<"${r}")"
  cuerpo="{\"type\":\"${tipo}\",\"name\":\"${nombre}\",\"content\":\"${contenido}\",\"ttl\":1,\"proxied\":${proxied}}"

  if [ -n "${id}" ] && [ "${existente}" != "${tipo}" ]; then
    if [ "${reemplazar}" = "--reemplazar" ]; then
      r="$(cf DELETE "/zones/${ZONA_ID}/dns_records/${id}" || true)"
      cf_ok "${r}" || die "No se pudo borrar el registro ${existente} de ${nombre}: $(cf_error "${r}")"
      aviso "se borró el registro ${existente} existente de ${nombre} (--reemplazar)"
      id=""
    else
      die "Ya existe un registro ${existente} para ${nombre} en Cloudflare y no es CNAME. Bórrelo en el panel (DNS → Records) o vuelva a ejecutar con --reemplazar."
    fi
  fi
  if [ -n "${id}" ]; then
    r="$(cf PUT "/zones/${ZONA_ID}/dns_records/${id}" "${cuerpo}" || true)"
    cf_ok "${r}" || die "No se pudo actualizar ${nombre}: $(cf_error "${r}")"
    ok "DNS actualizado: ${nombre} → ${contenido}  (proxy: ${proxied})"
  else
    r="$(cf POST "/zones/${ZONA_ID}/dns_records" "${cuerpo}" || true)"
    cf_ok "${r}" || die "No se pudo crear ${nombre}: $(cf_error "${r}")"
    ok "DNS creado: ${nombre} → ${contenido}  (proxy: ${proxied})"
  fi
}

# cf_ajuste ID VALOR  -> ajuste de la zona (SSL/TLS, HTTPS, TLS mínimo…). Un fallo no detiene el script: se informa al final.
CF_AJUSTES_FALLIDOS=0
cf_ajuste() {
  local id="$1" valor="$2" r
  r="$(cf PATCH "/zones/${ZONA_ID}/settings/${id}" "{\"value\":\"${valor}\"}" || true)"
  if cf_ok "${r}"; then ok "ajuste ${id} = ${valor}"; else falla "ajuste ${id}: $(cf_error "${r}")"; CF_AJUSTES_FALLIDOS=$((CF_AJUSTES_FALLIDOS + 1)); fi
}

# Configura Cloudflare para el dominio: CNAME de validación del certificado (si aún no está emitido), CNAME del sitio hacia el
# balanceador (crea o corrige el destino) y los ajustes de seguridad de la zona. Se puede repetir sin problema.
cmd_cloudflare() {
  local dominio="" reemplazar=""
  for a in "$@"; do case "${a}" in --reemplazar) reemplazar="--reemplazar" ;; -*) die "Opción desconocida: ${a}" ;; *) dominio="${a}" ;; esac; done
  requisitos
  resolver_certificado "${dominio}"
  dominio="${DOMINIO}"
  paso "Configurando Cloudflare para ${dominio} mediante su API"
  cf_zona "${dominio}"

  local estado nombre valor lb
  estado="$(aws acm describe-certificate --certificate-arn "${ARN_CERT}" --query Certificate.Status --output text)"
  if [ "${estado}" != "ISSUED" ]; then
    nombre="$(aws acm describe-certificate --certificate-arn "${ARN_CERT}" --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Name' --output text 2>/dev/null || true)"
    valor="$(aws acm describe-certificate --certificate-arn "${ARN_CERT}" --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Value' --output text 2>/dev/null || true)"
    if [ -n "${nombre}" ] && [ "${nombre}" != "None" ]; then
      cf_registro CNAME "${nombre%.}" "${valor%.}" false "${reemplazar}"
      aviso "certificado ${estado}: ACM tarda 2-10 min en validarlo (./scripts/desplegar.sh certificado ${dominio} espera hasta que quede emitido)"
    else
      aviso "ACM aún no entregó el registro de validación: ejecute ./scripts/desplegar.sh certificado ${dominio}"
    fi
  else
    ok "certificado ya emitido: no hace falta crear el registro de validación"
  fi

  lb="$(salida_pila LoadBalancerDns 2>/dev/null || true)"
  if [ -n "${lb}" ] && [ "${lb}" != "None" ]; then
    cf_registro CNAME "${dominio}" "${lb}" true "${reemplazar}"
  else
    aviso "no hay pila desplegada: se omite el CNAME del sitio. Ejecute ./scripts/desplegar.sh up y luego repita este comando."
  fi

  paso "Ajustes de seguridad de la zona"
  cf_ajuste ssl strict                 # Cloudflare ↔ balanceador cifrado y con el certificado VERIFICADO (Full strict)
  cf_ajuste always_use_https on        # redirige HTTP → HTTPS
  cf_ajuste min_tls_version 1.2        # rechaza TLS 1.0/1.1
  cf_ajuste rocket_loader off          # inyecta scripts: la CSP (script-src 'self') los bloquearía
  [ "${CF_AJUSTES_FALLIDOS}" -eq 0 ] || aviso "${CF_AJUSTES_FALLIDOS} ajuste(s) fallaron: el token necesita también el permiso Zone → Zone Settings → Edit."

  paso "Estado actual"
  comprobar_dominio "${dominio}"
  echo
  aviso "NO se aplicó ninguna protección de /admin (WAF, rate limiting, Cloudflare Access): ver docs/PANEL-ADMIN.md (qué son, por qué importan y por qué no están activadas)."
}

cmd_tunel() {
  requisitos
  local dns; dns="$(salida_pila LoadBalancerDns)"
  [ -n "${dns}" ] || die "La pila no está desplegada."
  paso "Túnel TEMPORAL de Cloudflare hacia el balanceador (Ctrl+C para cerrarlo)"
  aviso "Aparecerá una URL https://<palabras>.trycloudflare.com . Cambia cada vez y sólo sirve para pruebas/demostración."
  docker run --rm cloudflare/cloudflared:latest tunnel --no-autoupdate --url "http://${dns}"
}

cmd_carga() {
  requisitos
  local url; url="$(salida_pila ApplicationUrl)"
  [ -n "${url}" ] || die "La pila no está desplegada."
  paso "Generando carga contra ${url}/restaurantes/1 (${PNK_CARGA_N:-60000} peticiones, ${PNK_CARGA_C:-80} simultáneas)"
  aviso "Mientras corre, en otra terminal: watch -n 15 ./scripts/desplegar.sh status   (la escala tarda 3-5 minutos en reaccionar)"
  docker run --rm httpd:alpine ab -k -n "${PNK_CARGA_N:-60000}" -c "${PNK_CARGA_C:-80}" "${url}/api/restaurantes/1"
}

cmd_down() {
  local borrar_ecr=0 si=0
  for a in "$@"; do case "${a}" in --ecr) borrar_ecr=1;; --yes|-y) si=1;; *) die "Opción desconocida: ${a}";; esac; done
  requisitos
  paso "Se va a DESTRUIR la pila '${STACK}' (RDS con todos sus datos, balanceador, instancias y red)"
  if [ "${si}" -ne 1 ]; then
    read -r -p "  Escriba 'si' para continuar: " resp
    [ "${resp}" = "si" ] || { echo "  Cancelado."; return 0; }
  fi
  if [ "$(estado_pila)" = "NO_EXISTE" ]; then
    ok "la pila no existe (nada que borrar)"
  else
    # CloudFormation no puede borrar un bucket con objetos: se vacía primero (las imágenes subidas se pierden)
    local bucket
    bucket="$(salida_pila MediaBucketName || true)"
    if [ -n "${bucket}" ] && [ "${bucket}" != "None" ]; then
      aws s3 rm "s3://${bucket}" --recursive >/dev/null 2>&1 && ok "bucket S3 '${bucket}' vaciado" || aviso "no se pudo vaciar el bucket '${bucket}' (¿ya estaba vacío?)"
    fi
    aws cloudformation delete-stack --stack-name "${STACK}"
    aviso "Eliminando… tarda ~10 minutos (RDS)."
    aws cloudformation wait stack-delete-complete --stack-name "${STACK}"
    ok "pila eliminada"
  fi
  if [ "${borrar_ecr}" -eq 1 ]; then
    aws ecr delete-repository --repository-name "${REPO}" --force >/dev/null 2>&1 && ok "repositorio ECR '${REPO}' eliminado" || aviso "no había repositorio ECR '${REPO}'"
  else
    aviso "El repositorio ECR '${REPO}' se conserva (cuesta centavos). Para borrarlo: ./scripts/desplegar.sh down --ecr"
  fi
}

uso() { sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

main() {
  local cmd="${1:-}"; shift || true
  case "${cmd}" in
    verificar) cmd_verificar ;;
    construir) cmd_construir "$@" ;;
    continuidad) cmd_continuidad "$@" ;;
    publicar) cmd_publicar "$@" ;;
    revertir) cmd_revertir "$@" ;;
    versiones) cmd_versiones "$@" ;;
    up|actualizar) for a in "$@"; do [ "${a}" = "--sin-build" ] && SIN_BUILD=1; done; cmd_up ;;
    status) cmd_status ;;
    url) cmd_url ;;
    tunel) cmd_tunel ;;
    carga) cmd_carga ;;
    down) cmd_down "$@" ;;
    certificado) cmd_certificado "$@" ;;
    dominio) cmd_dominio "$@" ;;
    cloudflare) cmd_cloudflare "$@" ;;
    ""|-h|--help|help) uso ;;
    *) uso; die "Comando desconocido: ${cmd}" ;;
  esac
}

main "$@"
