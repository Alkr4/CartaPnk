#!/usr/bin/env bash
# =====================================================================================================================
# desplegar.sh — CartaPnk en AWS: RDS PostgreSQL + Application Load Balancer + Auto Scaling (CloudFormation)
#
#   ./scripts/desplegar.sh verificar          comprueba herramientas y permisos de su cuenta AWS (no crea nada)
#   ./scripts/desplegar.sh up [--sin-build]   construye la imagen, la sube a ECR y crea/actualiza toda la infraestructura
#   ./scripts/desplegar.sh status             estado de la pila, instancias, salud del balanceador y RDS
#   ./scripts/desplegar.sh url                imprime la URL pública
#   ./scripts/desplegar.sh certificado <dom>  pide un certificado de ACM para su dominio (HTTPS propio; validación DNS en Cloudflare)
#   ./scripts/desplegar.sh tunel              publica la URL con un túnel TEMPORAL de Cloudflare (trycloudflare.com)
#   ./scripts/desplegar.sh carga              genera tráfico para demostrar el Auto Scaling
#   ./scripts/desplegar.sh down [--ecr]       DESTRUYE la infraestructura (pide confirmación; --ecr borra también las imágenes)
#
# Requisitos: bash, AWS CLI v2 con credenciales válidas, Docker, openssl y curl.
# Variables opcionales: PNK_STACK, PNK_ECR_REPO, PNK_ADMIN_EMAIL, PNK_INSTANCE_TYPE, PNK_ASG_MIN, PNK_ASG_DESIRED,
#                       PNK_ASG_MAX, PNK_COOKIE_SECURE, PNK_TRUST_PROXY, PNK_IMAGE_TAG, PNK_DB_ENGINE_VERSION, PNK_DB_CLASS,
#                       PNK_INSTANCE_PROFILE, AWS_REGION
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

resumen() {
  local url; url="$(salida_pila ApplicationUrl)"
  echo
  printf '%s==============================================================================%s\n' "${NEGRITA}" "${FIN}"
  printf '%s Aplicación desplegada%s\n' "${NEGRITA}" "${FIN}"
  printf '   URL (HTTP):   %s\n' "${url}"
  printf '   Salud:        %s/salud\n' "${url}"
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
  paso "Esperando la validación (2-10 min después de crear el registro; Ctrl+C para salir y volver a ejecutar este comando luego)"
  aws acm wait certificate-validated --certificate-arn "${arn}"
  ok "certificado EMITIDO: ${arn}"
  echo
  echo "Siguiente paso:  ./scripts/desplegar.sh up --sin-build      (activa HTTPS en el balanceador)"
  echo "Después, en Cloudflare:  DNS → CNAME  ${dominio%%.*}  →  $(salida_pila LoadBalancerDns 2>/dev/null || echo '<DNS del balanceador>')  (nube NARANJA, con proxy)"
  echo "                         SSL/TLS → Overview → modo 'Full (strict)'"
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

uso() { sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

main() {
  local cmd="${1:-}"; shift || true
  case "${cmd}" in
    verificar) cmd_verificar ;;
    up|actualizar) for a in "$@"; do [ "${a}" = "--sin-build" ] && SIN_BUILD=1; done; cmd_up ;;
    status) cmd_status ;;
    url) cmd_url ;;
    tunel) cmd_tunel ;;
    carga) cmd_carga ;;
    down) cmd_down "$@" ;;
    certificado) cmd_certificado "$@" ;;
    ""|-h|--help|help) uso ;;
    *) uso; die "Comando desconocido: ${cmd}" ;;
  esac
}

main "$@"
