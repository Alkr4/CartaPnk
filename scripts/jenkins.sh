#!/usr/bin/env bash
# =====================================================================================================================
# jenkins.sh — servidor Jenkins de CartaPnk en AWS (pila CloudFormation "cartapnk-jenkins", plantilla infra/jenkins.yaml)
#
#   ./scripts/jenkins.sh up <su-ip>[/32]   crea/actualiza Jenkins; sólo esa IP puede abrir la interfaz (puerto 8080)
#   ./scripts/jenkins.sh url               dirección de Jenkins
#   ./scripts/jenkins.sh clave             contraseña del usuario admin
#   ./scripts/jenkins.sh actualizar        aplica cambios de jenkins/ (plugins, casc.yaml) sin recrear el servidor
#   ./scripts/jenkins.sh down              destruye el servidor y borra sus secretos de SSM
#
# Requiere la carpeta .despliegue/ del despliegue (contraseñas de la pila y certificado): se sube cifrada a SSM Parameter
# Store para que la etapa "Publicar" del pipeline pueda crear/actualizar la pila. Códigos: 0 éxito · 1 error · 2 parámetros.
# =====================================================================================================================
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="${PNK_JENKINS_STACK:-cartapnk-jenkins}"
PREFIJO="/cartapnk/jenkins"
export AWS_DEFAULT_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

error() { printf 'Error: %s\n' "$2" >&2; exit "$1"; }
salida() { aws cloudformation describe-stacks --stack-name "${STACK}" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

cmd_up() {
  local ip="${1:-}"
  [ -n "${ip}" ] || error 2 "Indique su IP pública: ./scripts/jenkins.sh up 200.1.2.3  (la ve en https://checkip.amazonaws.com)"
  [[ "${ip}" == */* ]] || ip="${ip}/32"
  [ -f "${RAIZ}/.despliegue/secretos.env" ] || error 2 "Falta .despliegue/secretos.env (cópielo del despliegue anterior o descomprima su respaldo)"

  echo "==> Secretos en SSM Parameter Store (${PREFIJO}/*, cifrados)"
  if ! aws ssm get-parameter --name "${PREFIJO}/admin" >/dev/null 2>&1; then
    aws ssm put-parameter --name "${PREFIJO}/admin" --type SecureString --value "$(openssl rand -base64 18 | tr -d '/+=')" >/dev/null
  fi
  aws ssm put-parameter --name "${PREFIJO}/despliegue" --type SecureString --overwrite \
    --value "$(tar -czf - -C "${RAIZ}" .despliegue | base64 -w0)" >/dev/null

  echo "==> Pila ${STACK} (EC2 ${PNK_JENKINS_TIPO:-t3.medium}; acceso sólo desde ${ip})"
  aws cloudformation deploy --stack-name "${STACK}" --template-file "${RAIZ}/infra/jenkins.yaml" --no-fail-on-empty-changeset \
    --parameter-overrides "AccesoCidr=${ip}" "InstanceType=${PNK_JENKINS_TIPO:-t3.medium}" "Rama=${PNK_JENKINS_RAMA:-develop}" \
    --tags proyecto=cartapnk componente=jenkins || error 1 "No se pudo crear la pila (revise los eventos en CloudFormation)"

  # (no se espera aquí: CloudShell no está en la red autorizada, así que no podría abrir Jenkins)
  echo "Listo. En ~5-8 min (instala Docker, construye la imagen y arranca) abra en su navegador: $(salida JenkinsUrl)"
  echo "Usuario: admin  ·  contraseña: ./scripts/jenkins.sh clave"
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  url) salida JenkinsUrl ;;   # IP elástica: no cambia al reiniciar el laboratorio
  actualizar)
    id="$(salida InstanceId)"
    cmd="$(aws ssm send-command --instance-ids "${id}" --document-name AWS-RunShellScript \
      --parameters 'commands=["/usr/local/bin/jenkins-actualizar"]' --query Command.CommandId --output text)"
    aws ssm wait command-executed --command-id "${cmd}" --instance-id "${id}" || error 1 "Falló la actualización (vea la salida del comando ${cmd} en SSM)"
    echo "Jenkins actualizado: $(salida JenkinsUrl)" ;;
  clave) aws ssm get-parameter --name "${PREFIJO}/admin" --with-decryption --query Parameter.Value --output text ;;
  down)
    aws cloudformation delete-stack --stack-name "${STACK}"
    aws cloudformation wait stack-delete-complete --stack-name "${STACK}"
    aws ssm delete-parameters --names "${PREFIJO}/admin" "${PREFIJO}/despliegue" >/dev/null 2>&1 || true
    echo "Jenkins eliminado (la pila de la aplicación no se toca)." ;;
  *) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
