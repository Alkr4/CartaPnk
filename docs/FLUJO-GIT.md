# Flujo de trabajo: ramas, ambientes y Docker

## Idea central

El código vive en **un solo lugar: GitHub**. Los ambientes **no se pasan código entre sí**: cada uno *trae* (`git pull`) la rama que le corresponde y la ejecuta con su propia configuración.

```
 feature/*  ──PR──►  develop  ──PR (si QA pasó)──►  main
                        │                             │
                        ▼ pull                        ▼ pull
                  DESARROLLO + QA                PRODUCCIÓN
```

| Rama | Para qué sirve | Quién la ejecuta |
|---|---|---|
| `feature/<nombre>` | un cambio concreto (una funcionalidad o corrección) | desarrollo |
| `develop` | cambios integrados, listos para probar | QA |
| `main` | sólo código aprobado | producción |

Docker hace que los ambientes sean "el mismo código con distinta configuración":
`Dockerfile` (etapas `desarrollo` / `pruebas` / `produccion`) + `docker-compose.<ambiente>.yml` + `env/<ambiente>.env` + un nombre de proyecto propio (`pnk-dev`, `pnk-qa`, `pnk-prod`) que da a cada ambiente su red y su base de datos.

## Paso a paso

### 1. Desarrollar

```bash
git checkout develop && git pull
git checkout -b feature/mi-cambio
# ... editar y probar en el ambiente de desarrollo ...
git add -A && git commit -m "Describe el cambio"
git push -u origin feature/mi-cambio
```

En GitHub: **Pull Request** de `feature/mi-cambio` hacia `develop`. El chequeo automático `calidad` (lint + pruebas + auditoría, definido en `.github/workflows/ci.yml`) debe quedar en verde antes de fusionar.

### 2. Probar en QA

```bash
cd ~/CartaPnk-dev          # carpeta con la rama develop (ver "Carpetas" más abajo)
git checkout develop && git pull
sudo docker compose -p pnk-qa --env-file env/qa.env -f docker-compose.yml -f docker-compose.qa.yml up --build --abort-on-container-exit --exit-code-from pruebas
```

Si termina con `62 passed` y `exited with code 0`, el cambio pasó QA. Si falla, se vuelve a desarrollo.

### 3. Llevar a producción

En GitHub: **Pull Request** de `develop` hacia `main` (sólo cuando QA pasó). Luego, en el servidor de producción:

```bash
cd ~/CartaPnk              # carpeta con la rama main
git checkout main && git pull
sudo docker compose -p pnk-prod --env-file env/prod.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

La base de datos de producción vive en su propio volumen de Docker, así que actualizar el código no borra los datos.

## Carpetas: por qué una por ambiente

Una carpeta clonada (una "copia de trabajo") tiene **una sola rama activa a la vez**, y Docker construye las imágenes con los archivos que haya *en ese momento* en esa carpeta.

Si usa una sola carpeta para todo y cambia de rama con `git checkout develop`, el siguiente `up --build` de producción construiría el código de `develop` sin que usted lo note. Para evitarlo, una carpeta por rama:

| Carpeta | Rama | Qué ejecuta |
|---|---|---|
| `~/CartaPnk` | `main` | **producción** (`-p pnk-prod`) |
| `~/CartaPnk-dev` | `develop` | **desarrollo y QA** (`-p pnk-dev` y `-p pnk-qa`) |

```bash
git clone https://github.com/Alkr4/CartaPnk.git ~/CartaPnk                       # ya existe
git clone -b develop https://github.com/Alkr4/CartaPnk.git ~/CartaPnk-dev        # carpeta nueva
```

Detalles que importan:

- Los archivos `env/*.env` **no están en Git**, por lo que cada carpeta nueva necesita los suyos:
  `docker run --rm -v "$PWD":/app -w /app node:24-alpine node tools/init-env.js dev qa` (y `sudo chown $USER:$USER env/*.env`).
  La carpeta de producción conserva su `env/prod.env`.
- Los contenedores ya levantados **siguen funcionando** aunque cambie la rama de la carpeta; el cambio se nota sólo al reconstruir (`up --build`). Los datos están en volúmenes de Docker, no en la carpeta.
- En un proyecto real cada ambiente sería un servidor distinto y el problema desaparece; aquí comparten un EC2 sólo por la demostración.

## Proteger la rama `main` en GitHub

Esto se configura en el sitio de GitHub (no en el código). Sirve para que nadie suba cambios directo a producción.

1. Repositorio → **Settings → Branches → Add branch ruleset** (o *Add classic branch protection rule*) para `main`.
2. Marcar:
   - **Require a pull request before merging** (con al menos 1 aprobación si trabajan en equipo).
   - **Require status checks to pass before merging** → agregar el chequeo **`calidad`**
     (aparece en la lista después de que el flujo de CI se haya ejecutado una vez, por ejemplo con el primer Pull Request).
   - **Require branches to be up to date before merging**.
   - **Block force pushes** y **Restrict deletions**.
3. Opcional pero recomendable: **Do not allow bypassing the above settings**, para que la regla valga también para el dueño del repositorio.

> En repositorios **privados** del plan gratuito de GitHub las reglas de protección de ramas pueden no estar disponibles; en repositorios públicos sí.

Para `develop` se puede aplicar una regla más liviana: exigir sólo el chequeo `calidad`.
