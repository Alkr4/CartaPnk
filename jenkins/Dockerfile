# syntax=docker/dockerfile:1
#
# Imagen de Jenkins para CartaPnk: Jenkins LTS + CLI de Docker (con Compose) + AWS CLI, con los plugins y la configuración
# como código (JCasC) ya incluidos. Al arrancar no hay asistente de instalación: el usuario admin, la credencial de
# despliegue y el trabajo "cartapnk" salen de casc.yaml. Las herramientas de seguridad (Gitleaks, Semgrep, Trivy, ZAP)
# no se instalan aquí: el pipeline las ejecuta como contenedores con versión fija (jenkins/controles.sh).
FROM docker:27-cli AS docker-cli

FROM jenkins/jenkins:lts-jdk21
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip jq openssl \
 && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip \
 && unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
USER jenkins

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY casc.yaml /usr/share/jenkins/ref/casc.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/casc.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
