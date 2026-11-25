// Pipeline CI/CD de CartaPnk con controles de seguridad (4.ª entrega).
// Cada etapa llama a jenkins/controles.sh (los mismos comandos se pueden correr a mano: ver docs/JENKINS.md).
// Cualquier control que falle DETIENE el pipeline: la versión no se publica. Si todo pasa, se publica en AWS con
// scripts/desplegar.sh, que verifica el servicio y, si la verificación falla, vuelve sola a la versión anterior.
//
// Requisitos (los deja listos infra/jenkins.yaml): Docker con Compose, AWS CLI con el rol de la instancia y la credencial
// de tipo archivo "pnk-despliegue" (carpeta .despliegue empaquetada).

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '30'))
    timeout(time: 90, unit: 'MINUTES')
  }

  environment {
    PROYECTO = "pnk-ci-${env.BUILD_NUMBER}"   // contenedores de QA propios de esta ejecución
    REPORTES = "${env.WORKSPACE}/reportes"
  }

  stages {
    stage('Versión') {
      steps {
        script {
          env.VERSION = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          currentBuild.displayName = "#${env.BUILD_NUMBER} · ${env.VERSION}"
          currentBuild.description = sh(script: 'git log -1 --pretty=%s', returnStdout: true).trim()
        }
        sh 'rm -rf reportes .despliegue && ./jenkins/controles.sh preparar'
      }
    }

    stage('Secretos (Gitleaks)')        { steps { sh './jenkins/controles.sh secretos' } }
    stage('SAST (Semgrep)')             { steps { sh './jenkins/controles.sh sast' } }
    stage('Dependencias (npm audit)')   { steps { sh './jenkins/controles.sh dependencias' } }

    stage('Lint y pruebas (QA)') {
      steps { sh './jenkins/controles.sh pruebas' }
      post { always { sh './jenkins/controles.sh limpiar' } }
    }

    stage('Imágenes')                   { steps { sh './jenkins/controles.sh imagenes' } }
    stage('Imágenes: CVE (Trivy)')      { steps { sh './jenkins/controles.sh trivy' } }

    stage('DAST (OWASP ZAP)') {
      steps { sh './jenkins/controles.sh dast' }
      post { always { sh './jenkins/controles.sh limpiar' } }
    }

    stage('Publicar en AWS (pruebas)') {
      steps {
        withCredentials([file(credentialsId: 'pnk-despliegue', variable: 'DESPLIEGUE')]) {
          sh '''
            tar -xzf "$DESPLIEGUE"
            PNK_REVERTIR_SI_FALLA=1 ./scripts/desplegar.sh publicar pruebas "$VERSION"
          '''
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'reportes/**', allowEmptyArchive: true
      sh 'rm -rf .despliegue'                      // los secretos no quedan en el espacio de trabajo
      sh 'docker image prune -f >/dev/null || true'
    }
    success { echo "Versión ${env.VERSION}: pasó todos los controles y quedó publicada." }
    failure { echo "Versión ${env.VERSION}: BLOQUEADA. Revise la etapa en rojo y los informes en 'Artefactos' (reportes/)." }
  }
}
