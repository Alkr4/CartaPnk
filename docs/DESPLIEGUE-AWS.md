# Despliegue en AWS: RDS + Load Balancer + Auto Scaling

Procedimiento para que **cualquier persona** levante CartaPnk en AWS (AWS Academy / Learner Lab) con un solo script.
Todo se crea con **CloudFormation** (`infra/pnk-stack.yaml`) y se orquesta con **bash** (`scripts/desplegar.sh`).

## 1. Qué se crea

```
 Internet ──► Application Load Balancer (HTTP :80) ──► Auto Scaling Group (2 a 4 EC2 t3.small, 2 zonas)
                  salud: GET /salud                          cada una ejecuta 2 contenedores: Nginx (frontend) → API (backend); imágenes en ECR
                                                                         │ TLS verificado
                                                                         ▼
                                                          Amazon RDS PostgreSQL 17 (subredes privadas, sin acceso público)
```

| Recurso | Detalle |
|---|---|
| **VPC** `10.20.0.0/16` | 2 subredes públicas (balanceador e instancias) y 2 privadas (sólo RDS), sin NAT Gateway |
| **RDS PostgreSQL 17** | `db.t3.micro`, 20 GB gp3 cifrado, **no es accesible desde Internet**: su grupo de seguridad sólo acepta tráfico de las instancias de la app |
| **ALB** | recibe HTTP :80, comprueba `/salud` cada 15 s y saca del servicio a la instancia que no responde |
| **Auto Scaling Group** | mínimo 2, máximo 4 instancias; escala por **peticiones por instancia** (> 300/min) y por **CPU** (> 55 %); reemplaza instancias enfermas; actualiza imágenes con *rolling update* |
| **S3** | bucket **privado** (cifrado, sin acceso público, sólo HTTPS) con las imágenes que el administrador sube desde `/admin`; lo comparten todas las instancias |
| **ECR** | repositorio `cartapnk` con las 2 imágenes Docker: `back-<tag>` (API) y `front-<tag>` (Nginx + sitio web); lo crea el script |

Cadena de grupos de seguridad: `Internet → ALB (80) → instancia: Nginx (80, sólo desde el ALB) → API (3000, red interna de Docker, sin puerto publicado) → RDS (5432, sólo desde la instancia)`.

Las instancias no guardan estado: **sesiones, carrito y contadores del límite de login viven en PostgreSQL y las imágenes en S3**, por eso se puede añadir o quitar instancias sin que nadie pierda su sesión.

> **Costo:** mientras exista, la infraestructura consume crédito del laboratorio (2 × EC2, RDS, ALB; del orden de unos pocos dólares por día — verifique con la calculadora de precios de AWS). **Destrúyala al terminar** (`down`).
> **Tiempo:** la primera creación tarda ~10-15 minutos (RDS es lo más lento).

## 2. Requisitos

- Una cuenta de **AWS Academy Learner Lab** con la sesión iniciada (círculo verde en *Start Lab*), región **us-east-1** o **us-west-2**.
- Un equipo Linux/macOS/WSL con **bash, AWS CLI v2, Docker, openssl y curl**. La forma más simple es **el EC2 que ya usa para el proyecto** (Amazon Linux 2023 trae AWS CLI v2; Docker y Git ya están instalados según `docs/PUBLICACION.md`).
- Para **construir la imagen** en un servidor de 1 GB de RAM necesita el swap de 2 GB activo (`free -m`; ver `docs/PUBLICACION.md`). Con 2 GB o más no hace falta.
- Si `docker` le pide `sudo`, cierre la sesión SSH y vuelva a entrar (el grupo `docker` se aplica al iniciar sesión). No ejecute el script con `sudo`: las credenciales de AWS están en su usuario.

## 3. Paso a paso

### 3.1 Credenciales de AWS Academy

En el panel del laboratorio: **AWS Details → AWS CLI → Show** y copie el bloque a `~/.aws/credentials`:

```ini
[default]
aws_access_key_id=ASIA...
aws_secret_access_key=...
aws_session_token=...
```

```bash
mkdir -p ~/.aws && nano ~/.aws/credentials      # pegar el bloque
aws configure set region us-east-1
aws sts get-caller-identity                     # debe mostrar su cuenta
```

> Estas credenciales **caducan** al terminar la sesión del laboratorio (≈ 4 h): vuelva a copiarlas cuando el script diga "credenciales no válidas".

### 3.2 Obtener el código y verificar la cuenta

```bash
git clone https://github.com/Alkr4/CartaPnk.git && cd CartaPnk
./scripts/desplegar.sh verificar
```

`verificar` no crea nada: comprueba las herramientas y que su cuenta pueda usar RDS, ALB, Auto Scaling, ECR y CloudFormation.
Los mismos chequeos, a mano:

```bash
aws sts get-caller-identity
aws ec2 describe-vpcs --query 'length(Vpcs)'
aws rds describe-orderable-db-instance-options --engine postgres --db-instance-class db.t3.micro --max-items 1 --query 'length(OrderableDBInstanceOptions)'
aws rds describe-db-engine-versions --engine postgres --query "DBEngineVersions[?starts_with(EngineVersion,'17')].EngineVersion" --output text
aws elbv2 describe-load-balancers --query 'length(LoadBalancers)'
aws autoscaling describe-auto-scaling-groups --query 'length(AutoScalingGroups)'
aws ecr describe-repositories --query 'length(repositories)'
aws cloudformation list-stacks --max-items 1
aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text
aws iam get-instance-profile --instance-profile-name LabInstanceProfile      # puede estar bloqueado por IAM; no es grave
```

Si alguno responde `AccessDenied` / `not authorized`, esa capacidad no está habilitada en su laboratorio.

### 3.3 Desplegar

```bash
./scripts/desplegar.sh up
```

El script, en orden:

1. genera y guarda **secretos aleatorios** (contraseña de la base, secreto de sesión, contraseña del administrador) en `.despliegue/secretos.env` (no se sube a Git; se reutilizan en cada ejecución);
2. crea el repositorio **ECR**, **construye** las dos imágenes (`backend/` con `--target produccion` y `frontend/`) y las **sube**;
3. ejecuta `aws cloudformation deploy` con la plantilla;
4. espera a que el balanceador marque las instancias como *healthy* y le imprime la **URL**, el administrador y su contraseña (se muestra solo la primera vez).

Para cambiar el tamaño: `PNK_INSTANCE_TYPE=t3.medium PNK_ASG_MIN=2 PNK_ASG_MAX=6 ./scripts/desplegar.sh up`.

### 3.4 Comprobar

```bash
./scripts/desplegar.sh status                     # pila, instancias, salud del ALB y estado de RDS
curl -s "$(./scripts/desplegar.sh url)/salud"     # {"estado":"ok","ambiente":"production"}
```

Abra la URL en el navegador e inicie sesión con el administrador que imprimió el script.

> Con el balanceador en **HTTP** la cookie de sesión **no puede ser `Secure`** (`COOKIE_SECURE=false`, valor por defecto de la plantilla); sigue siendo `HttpOnly` y `SameSite=Lax`. Con un dominio + certificado ACM en el ALB se pone `PNK_COOKIE_SECURE=true`.

### 3.5 Cloudflare (manual)

La parte de Cloudflare se hace **a mano**. Sin dominio se usa un **túnel temporal** (HTTPS sin cuenta, sin garantías de disponibilidad):

```bash
./scripts/desplegar.sh tunel
```

Imprime una URL `https://<palabras>.trycloudflare.com` (déjela abierta; `Ctrl+C` la cierra). Equivale a:
`docker run --rm cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://<dns-del-ALB>`.

Con un **dominio propio** (HTTPS de extremo a extremo: Cloudflare → ALB con certificado de ACM, modo *Full (strict)*): siga [`docs/DOMINIO-CLOUDFLARE.md`](DOMINIO-CLOUDFLARE.md). El script automatiza el certificado (`./scripts/desplegar.sh certificado menu.sudominio.com`) y la activación de HTTPS (`up --sin-build`).

`TRUST_PROXY=3` (Nginx del frontend + balanceador + Cloudflare) ya viene configurado para que el límite de login use la IP real del visitante.

### 3.6 Demostrar el Auto Scaling y la alta disponibilidad

```bash
# Terminal 1: generar carga
./scripts/desplegar.sh carga
# Terminal 2: ver cómo crece el grupo (tarda 3-5 minutos en reaccionar)
watch -n 15 ./scripts/desplegar.sh status
```

**Alta disponibilidad:** termine una instancia y vea cómo el grupo la reemplaza sin que el sitio deje de responder:

```bash
aws ec2 terminate-instances --instance-ids <id-de-una-instancia>      # el id sale de 'status'
watch -n 10 ./scripts/desplegar.sh status
```

**La base de datos es privada:** `aws rds describe-db-instances` muestra `PubliclyAccessible: false`, y su endpoint no resuelve a una IP pública.

### 3.7 Actualizar la aplicación

Después de un `git pull` con cambios:

```bash
./scripts/desplegar.sh up
```

Construye imágenes nuevas (etiqueta distinta), las sube y CloudFormation **reemplaza las instancias de a una** (rolling update). Para reutilizar la última imagen sin reconstruir: `up --sin-build`.

### 3.8 Destruir todo

```bash
./scripts/desplegar.sh down          # pide confirmación; conserva el repositorio ECR
./scripts/desplegar.sh down --ecr    # además borra las imágenes
```

Tarda ~10 minutos. **Elimina la base de datos y sus datos.**

## 4. Qué hace la aplicación al arrancar en cada instancia

1. `user-data` instala Docker, escribe `/etc/pnk.env` (sólo root puede leerlo), inicia sesión en ECR, descarga las imágenes y ejecuta los contenedores `back` (API) y `front` (Nginx, publicado en el puerto 80) en una red de Docker propia (`--read-only`, sin capacidades de Linux, con límite de memoria).
2. `docker/entrypoint.sh` aplica las **migraciones** (con bloqueo asesor: si dos instancias arrancan a la vez, una espera a la otra) y carga el catálogo y el administrador una sola vez.
3. La app se conecta a RDS con **TLS verificado** contra el certificado raíz de AWS (incluido en la imagen) y empieza a responder `/salud`; el balanceador la incorpora tras dos comprobaciones correctas.

## 5. Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `verificar` marca ✘ en RDS/ELB/ASG/ECR/CloudFormation | El laboratorio no habilita ese servicio o la sesión caducó | Reinicie el laboratorio y vuelva a copiar las credenciales; si persiste, ese servicio no está disponible en su cuenta |
| La pila falla con *engine version* / *DBInstanceClass* | PostgreSQL 17 o `db.t3.micro` no disponibles en la región | Use una versión/clase que liste `verificar`: `PNK_DB_ENGINE_VERSION=16 PNK_DB_CLASS=db.t3.micro ./scripts/desplegar.sh up` |
| La pila falla con `AccessDenied` en el perfil de instancia | `LabInstanceProfile` no existe con ese nombre | `PNK_INSTANCE_PROFILE=<nombre-del-perfil> ./scripts/desplegar.sh up` |
| El script dice *"Aún no hay instancias saludables"* | La instancia sigue arrancando o no pudo descargar la imagen / conectar a RDS | `./scripts/desplegar.sh status`; luego `aws ec2 get-console-output --instance-id <id> --latest --output text` y busque errores de `pnk-userdata` |
| Instancias que se crean y se destruyen en bucle | Fallo en el `user-data` (permiso de ECR, imagen inexistente) | Revise la salida de consola anterior; confirme que la etiqueta de `ImageUri` existe en ECR |
| El login "no hace nada" | Cookie `Secure` sobre HTTP | Deje `COOKIE_SECURE=false` (por defecto) mientras el ALB sea HTTP |
| `docker build` muy lento o se cuelga | Poca RAM | Active el swap (`docs/PUBLICACION.md`) o use un equipo con ≥ 2 GB |
| `ExpiredToken` / *credenciales no válidas* | Caducó la sesión del laboratorio | Copie de nuevo las credenciales de *AWS Details* |

## 6. Seguridad: decisiones y límites (para el informe)

**Implementado**
- RDS en subredes **privadas**, cifrado en reposo, sin acceso público, conexión **TLS verificada**.
- Cadena de grupos de seguridad de mínimo privilegio (la app sólo acepta al ALB; la base sólo a la app).
- Sin credenciales en el código ni en Git: secretos generados al desplegar; `.despliegue/` está en `.gitignore`.
- Contenedor de solo lectura, `cap_drop: ALL`, `no-new-privileges`, IMDSv2 obligatorio.
- Imágenes en un bucket S3 **privado** (Block Public Access, SSE-AES256, política que exige HTTPS); la app las sirve por `/media` con `nosniff` y CSP `sandbox`; credenciales por rol de instancia (IMDSv2, sin claves en el código).
- Límite de intentos de login **global** (PostgreSQL), sesiones y carrito en base de datos.

**Límites conocidos (laboratorio) y cómo mejorarlos**
- Sin dominio, el ALB atiende sólo **HTTP** (entre Cloudflare y el ALB el tráfico va sin cifrar). Con dominio y certificado de ACM se activa HTTPS de extremo a extremo (`docs/DOMINIO-CLOUDFLARE.md`).
- Las instancias están en subredes públicas (para descargar imágenes sin NAT Gateway) aunque sólo aceptan tráfico del ALB.
- Los secretos viajan en el `user-data` de la plantilla de lanzamiento; en producción real usar **AWS Secrets Manager** (`ManageMasterUserPassword`) y un rol de instancia que los lea.
- RDS sin Multi-AZ y sin copias de seguridad automáticas (`BackupRetentionPeriod: 0`): sólo para laboratorio.
- El rol `LabRole` de AWS Academy es amplio; en una cuenta real se usaría un rol con permiso `s3:GetObject/PutObject/DeleteObject` sólo sobre este bucket.
- Sin WAF de AWS; con dominio, el WAF de Cloudflare cumple ese papel.
- No se ha validado en un Learner Lab real desde este repositorio: la plantilla pasa `cfn-lint` y el script se probó con AWS simulado; el primer despliegue real puede requerir ajustes menores (ver la tabla anterior).
