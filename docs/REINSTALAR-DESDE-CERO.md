# Reinstalar CartaPnk desde cero (recuperación ante desastres)

Guía para que **cualquier persona** con acceso a la cuenta de AWS y a Cloudflare pueda volver a levantar todo si algo se borra.
Tiempo estimado de una reinstalación completa: **~25 minutos** (casi todo es esperar a RDS).

## 0. Qué se pierde y qué sobrevive según lo que se borre

| Si se borra… | Qué ocurre | Qué hacer |
|---|---|---|
| **Una instancia EC2** del Auto Scaling | **Nada visible.** El grupo detecta que falta y crea otra sola (3-5 min). El otro servidor atiende mientras tanto. Sesiones, carrito y datos viven en RDS/S3, no en la instancia. | Nada. Es justo lo que demuestra el Auto Scaling. |
| **Todas las instancias** | El sitio cae unos minutos y el grupo las recrea solo. | Esperar; revisar con `./scripts/desplegar.sh status`. |
| **La instancia o consola desde donde se ejecuta el script** (CloudShell, EC2 de trabajo, el PC) | **La producción no se toca**: ese equipo solo se usa para desplegar. Se pierde la carpeta `.despliegue/` (secretos). | Clonar de nuevo el repo (sección 2). Ver nota sobre secretos. |
| **La pila de CloudFormation** (`cartapnk`) | Se borra todo lo que esta crea: red, balanceador, instancias, **RDS (con sus datos)** y **el bucket S3 (con sus imágenes)**. El sitio queda caído. | Sección 2, completa. |
| **El repositorio ECR** | La infraestructura sigue funcionando, pero no podrá lanzar instancias nuevas hasta que haya imagen. | `./scripts/desplegar.sh up` reconstruye y sube la imagen. |
| **El certificado de ACM** | HTTPS deja de funcionar al renovar o recrear el balanceador. | `./scripts/desplegar.sh certificado cartapnk.xyz` y luego `up --sin-build`. |
| **El registro DNS en Cloudflare** | El dominio deja de resolver. | Crear de nuevo el CNAME (paso 2.6). |

**Lo que SÍ se recupera solo al reinstalar:** el código (GitHub), el catálogo de ejemplo (la app lo carga si la base está vacía) y
el usuario administrador (se crea con `ADMIN_EMAIL`/`ADMIN_PASSWORD`).

**Lo que NO se recupera:** restaurantes, cartas, platillos e imágenes que se hayan creado **desde el panel**. En el laboratorio la base
no tiene copias automáticas (`BackupRetentionPeriod: 0`) y el bucket se elimina con la pila. En una cuenta real se activarían los
backups de RDS y el versionado de S3 (ver `docs/DESPLIEGUE-AWS.md`, sección 6).

## 1. Qué se necesita

- Acceso a la cuenta de AWS (en AWS Academy: iniciar el laboratorio y copiar *AWS Details → AWS CLI*).
- Acceso al panel de Cloudflare del dominio.
- Un terminal con `bash`, AWS CLI v2, Docker, `openssl`, `curl` y `git` (**AWS CloudShell** ya los trae y no cuesta nada extra).
- Repositorio: https://github.com/Alkr4/CartaPnk (rama `main` = producción).

## 2. Reinstalación completa, paso a paso

### 2.1 Credenciales de AWS
En AWS Academy: **Start Lab → AWS Details → AWS CLI → Show**, y pegar el bloque en `~/.aws/credentials`:

```bash
mkdir -p ~/.aws && nano ~/.aws/credentials      # pegar el bloque [default] con las 3 claves
aws configure set region us-east-1
aws sts get-caller-identity                     # debe mostrar la cuenta
```

> Caducan a las ~4 horas: si un comando dice `ExpiredToken`, vuelva a copiarlas.

### 2.2 Obtener el código y comprobar la cuenta
```bash
git clone https://github.com/Alkr4/CartaPnk.git
cd CartaPnk
./scripts/desplegar.sh verificar        # no crea nada; todo debe salir con ✔
```

### 2.3 Certificado HTTPS (solo si se borró o nunca existió en esta cuenta)
```bash
./scripts/desplegar.sh certificado cartapnk.xyz
```
- Si el certificado **ya existe**, el script lo reutiliza, no pide nada nuevo y termina en segundos.
- **Cuenta de AWS nueva:** los certificados de ACM no pasan de una cuenta a otra, así que este paso es obligatorio y el CNAME de validación **es distinto** al anterior.
- Si es nuevo, imprime un registro **CNAME de validación**. Créelo en Cloudflare (*DNS → Records*) con **Proxy: DNS only (nube gris)**
  y espere a ver `certificado EMITIDO` (2-10 min).

### 2.4 Desplegar la infraestructura
```bash
./scripts/desplegar.sh up
```
Construye la imagen, la sube a ECR y crea red, RDS, bucket S3, balanceador y Auto Scaling (~15 min). Al final imprime la **URL del balanceador**
y el usuario administrador. Si existe el archivo del certificado, activa HTTPS solo.

### 2.5 Comprobar
```bash
./scripts/desplegar.sh status
curl -s "$(./scripts/desplegar.sh url)/salud"        # {"estado":"ok",...}
```

### 2.6 Apuntar el dominio al balanceador nuevo (¡siempre cambia!)
> **Atajo:** `./scripts/desplegar.sh dominio cartapnk.xyz` imprime los dos registros de Cloudflare con los valores de **esta** cuenta (validación
> del certificado y CNAME hacia el balanceador), el modo SSL, y comprueba si `https://cartapnk.xyz/salud` ya responde. Úselo al terminar el paso 2.4 y
> en cualquier momento para saber qué falta.

El DNS del balanceador **es distinto en cada pila nueva**. En Cloudflare (*DNS → Records*):

| Tipo | Nombre | Destino | Proxy |
|---|---|---|---|
| CNAME | `@` | el DNS que imprimió `up` (`cartap-LoadB-….elb.amazonaws.com`) | **Proxied** (naranja) |

Si ya existía el registro, **edite su destino** (no cree uno duplicado). Y en *SSL/TLS → Overview*: **Full (strict)**.

### 2.7 Probar
Abra `https://cartapnk.xyz` (candado) y entre a `https://cartapnk.xyz/admin` con el administrador.
La contraseña está en `.despliegue/secretos.env`:
```bash
cat .despliegue/secretos.env
```

## 3. Secretos: dónde están y qué pasa si se pierden

`./scripts/desplegar.sh up` genera contraseñas aleatorias (base de datos, sesión, administrador) y las guarda en
`.despliegue/secretos.env` **del equipo desde el que se ejecuta**. No están en Git.

- **Guárdelas** en un gestor de contraseñas apenas se generen.
- Si se pierde el archivo **y la pila sigue viva**, un nuevo `up` genera secretos nuevos y actualiza la pila: la contraseña del administrador
  cambia (la nueva queda en el archivo) y las instancias se reemplazan con la nueva configuración. No hay pérdida de datos.
- Si se reinstala **desde cero** no importa: todo se crea con secretos nuevos.

## 4. Cuentas de servicio que no se reinstalan (verificar que existan)

| Recurso | Dónde | Nota |
|---|---|---|
| Dominio `cartapnk.xyz` | Nameslink (registro) con DNS delegado a Cloudflare | Renovación anual |
| Zona DNS | Cloudflare (plan Free) | Los nameservers de Cloudflare están configurados en Nameslink |
| Código | GitHub `Alkr4/CartaPnk` | `main` producción, `develop` QA |

## 5. Si algo falla

Ver la tabla de *Solución de problemas* en [`DESPLIEGUE-AWS.md`](DESPLIEGUE-AWS.md#5-solución-de-problemas). Los casos más comunes al reinstalar:

| Síntoma | Causa | Solución |
|---|---|---|
| `credenciales no válidas` | Caducó la sesión del laboratorio | Repetir 2.1 |
| El dominio muestra **522** | El CNAME apunta al balanceador antiguo | Repetir 2.6 |
| **525/526** | SSL de Cloudflare no está en Full (strict) o el certificado no corresponde al dominio | Revisar 2.3 y 2.6 |
| `up` dice *certificado … no emitido* | Falta el CNAME de validación de ACM | Crearlo (2.3) |
| El sitio carga pero sin catálogo | `SeedCatalogo=false` | Desplegar sin esa variable (por defecto es `true`) |
