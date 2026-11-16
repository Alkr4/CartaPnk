// BORRADOR para la 4.ª entrega — pipeline CI/CD con controles de seguridad (DevSecOps).
// No se ha ejecutado contra un Jenkins real: los nombres de plugins/parámetros marcados con (*) deben validarse con el
// "Pipeline Syntax / Snippet Generator" de su instalación. Ver docs/JENKINS.md.
//
// Requisitos del agente: Docker (con Compose v2) y acceso al socket de Docker. No necesita Node instalado.
// Credenciales esperadas en Jenkins:  ec2-prod-ssh (SSH), prod-host (texto: usuario@host), prod-url (texto: https://menu.<dominio>)

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 60, unit: 'MINUTES')
  }

  environment {
    NODE_IMG   = 'node:24-alpine'
    PROY_QA    = "pnk-qa-ci-${env.BUILD_NUMBER}"
    IMAGEN     = "pnk-security:${env.BUILD_NUMBER}"
    COMPOSE_QA = "docker compose -p pnk-qa-ci-${env.BUILD_NUMBER} --env-file env/qa.env -f docker-compose.yml -f docker-compose.qa.yml"
  }

  stages {

    stage('Checkout') {
      steps {
        checkout scm
        sh 'mkdir -p reportes'
      }
    }

    stage('Preparar ambiente QA') {
      steps {
        // genera env/qa.env con secretos aleatorios (no se versiona)
        sh 'docker run --rm -v "$PWD":/app -w /app $NODE_IMG node tools/init-env.js qa'
      }
    }

    // ---------------------------------------------------------------- SEGURIDAD ESTÁTICA (antes de ejecutar nada)
    stage('Secretos (Gitleaks)') {
      steps {
        sh '''docker run --rm -v "$PWD":/repo zricethezav/gitleaks:latest detect --source /repo --no-banner \
              --report-format sarif --report-path /repo/reportes/gitleaks.sarif --exit-code 1'''
      }
    }

    stage('SAST (Semgrep: OWASP Top 10 + Node.js)') {
      steps {
        sh '''docker run --rm -v "$PWD":/src semgrep/semgrep semgrep scan --config p/owasp-top-ten --config p/nodejs \
              --sarif --output /src/reportes/semgrep.sarif --error /src'''
      }
    }

    stage('Dependencias (SCA)') {
      parallel {
        stage('npm audit') {
          steps {
            sh 'docker run --rm -v "$PWD":/app -w /app/backend $NODE_IMG sh -c "npm ci --omit=dev && npm audit --omit=dev --audit-level=high"'
          }
        }
        stage('OWASP Dependency-Check') {
          steps {
            // (*) requiere la herramienta "dependency-check" configurada en Manage Jenkins > Tools
            dependencyCheck additionalArguments: '--scan backend/package-lock.json --format JSON --format XML --format HTML --out reportes/dependency-check --failOnCVSS 9',
                            odcInstallation: 'dependency-check'
            // (*) umbrales: el nombre exacto de los parámetros se valida en el generador de snippets
            dependencyCheckPublisher pattern: 'reportes/dependency-check/dependency-check-report.xml',
                                     failedTotalCritical: 1, unstableTotalHigh: 1
          }
        }
      }
    }

    // ---------------------------------------------------------------- QA: lint + pruebas automáticas
    stage('Lint + pruebas (QA)') {
      steps {
        sh '$COMPOSE_QA up --build --abort-on-container-exit --exit-code-from pruebas'
      }
      post {
        always { sh '$COMPOSE_QA down -v || true' }
      }
    }

    // ---------------------------------------------------------------- IMAGEN
    stage('Construir imagen') {
      steps {
        sh 'docker build --target produccion -t $IMAGEN .'
      }
    }

    stage('Escaneo de la imagen (Trivy)') {
      steps {
        sh '''docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD/reportes":/reportes aquasec/trivy:latest image \
              --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --format sarif --output /reportes/trivy.sarif $IMAGEN'''
      }
    }

    // ---------------------------------------------------------------- DAST sobre QA
    stage('Desplegar QA y DAST (OWASP ZAP)') {
      steps {
        sh '$COMPOSE_QA up -d --build back front db'
        sh '''
          # esperar a que la app responda dentro de la red de Docker del proyecto
          for i in $(seq 1 30); do
            docker run --rm --network ${PROY_QA}_default curlimages/curl -fsS http://front:8080/salud && break || sleep 3
          done
          # escaneo pasivo (baseline); las reglas con FAIL en jenkins/zap-reglas.tsv rompen el build
          docker run --rm --network ${PROY_QA}_default -v "$PWD/reportes":/zap/wrk:rw -v "$PWD/jenkins":/zap/config:ro \
            ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://front:8080/restaurantes/1 \
            -c /zap/config/zap-reglas.tsv -r zap-baseline.html -J zap-baseline.json
        '''
      }
      post {
        always { sh '$COMPOSE_QA down -v || true' }
      }
    }

    // ---------------------------------------------------------------- MITRE: consolidar CWE -> CAPEC -> ATT&CK
    stage('Informe MITRE (CWE / CAPEC / ATT&CK)') {
      steps {
        sh 'docker run --rm -v "$PWD":/app -w /app $NODE_IMG node backend/tools/mapear-mitre.js reportes reportes/mitre.md'
      }
    }

    // ---------------------------------------------------------------- PRODUCCIÓN (sólo rama main, con aprobación)
    stage('Aprobación a producción') {
      when { branch 'main' }
      steps {
        timeout(time: 30, unit: 'MINUTES') {
          input message: '¿Desplegar a PRODUCCIÓN?', ok: 'Desplegar'
        }
      }
    }

    stage('Desplegar a producción (EC2)') {
      when { branch 'main' }
      steps {
        withCredentials([string(credentialsId: 'prod-host', variable: 'PROD_HOST'), string(credentialsId: 'prod-url', variable: 'PROD_URL')]) {
          sshagent(credentials: ['ec2-prod-ssh']) {
            sh '''ssh -o StrictHostKeyChecking=accept-new "$PROD_HOST" \
                  "cd ~/pnkSecurity-node && git fetch origin main && git reset --hard origin/main && \
                   docker compose -p pnk-prod --env-file env/prod.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build"'''
          }
          // prueba de humo a través de Cloudflare
          sh 'for i in $(seq 1 20); do curl -fsS "$PROD_URL/salud" && exit 0 || sleep 5; done; exit 1'
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'reportes/**', allowEmptyArchive: true
      // (*) plugin HTML Publisher
      publishHTML(target: [reportDir: 'reportes', reportFiles: 'zap-baseline.html', reportName: 'OWASP ZAP', allowMissing: true, keepAll: true, alwaysLinkToLastBuild: true])
      publishHTML(target: [reportDir: 'reportes/dependency-check', reportFiles: 'dependency-check-report.html', reportName: 'Dependency-Check', allowMissing: true, keepAll: true, alwaysLinkToLastBuild: true])
      // (*) plugin Warnings Next Generation: importa los informes SARIF de Semgrep, Gitleaks y Trivy
      recordIssues(tools: [sarif(id: 'semgrep', pattern: 'reportes/semgrep.sarif'), sarif(id: 'gitleaks', pattern: 'reportes/gitleaks.sarif'), sarif(id: 'trivy', pattern: 'reportes/trivy.sarif')])
    }
    failure { echo 'El pipeline falló: revise el informe de seguridad de la etapa marcada en rojo.' }
  }
}
