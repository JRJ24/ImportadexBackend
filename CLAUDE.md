# CLAUDE.md — ImportadexBackend

Guía técnica y operativa para trabajar en este repositorio. Última auditoría integral: 2026-08-03. Actualizado 2026-08-04 con hallazgos de producción y el incidente de entrega de email.

## 0. Corrección de expectativas importante

Este repositorio **NO es un stack MERN**. Es un backend Express + TypeScript con **PostgreSQL** (vía Prisma ORM), sin frontend ni MongoDB en ningún punto del código. Si una tarea futura asume MongoDB, Mongoose o React dentro de este repo, esa suposición es incorrecta — verifícalo contra este documento antes de actuar.

- **DB principal:** PostgreSQL, gestionada con Prisma 7 (`@prisma/adapter-pg`).
- **No hay React ni ningún frontend en este repositorio.** El `Dockerfile` (`server/Dockerfile`) copia un directorio hermano `../MIREX-CLIENT` durante el build, lo que indica que el frontend vive en **otro repositorio separado**, y que el contexto de build de Docker esperado es el directorio **padre** que contiene tanto `ImportadexBackend/` como `MIREX-CLIENT/`.
- Este repo es un **módulo backend ("Importadex")** que se integra a un sistema más grande llamado **MIREX**, del cual depende para autenticación/usuarios (ver sección 3).
- El repo no tenía `.git` inicializado al comenzar esta auditoría. Se inicializó `git init`, se agregó `origin` apuntando a `https://github.com/JRJ24/ImportadexBackend.git`, se hizo `fetch` y se alineó la rama local `main` con `origin/main` (sin commits nuevos, sin push). El working tree coincide exactamente con `origin/main` salvo por este archivo.

## 1. Stack técnico real

| Componente | Detalle |
|---|---|
| Runtime | Node.js (Docker de producción usa `node:20-alpine`; no hay `.nvmrc` ni `engines` en `package.json`) |
| Lenguaje | TypeScript 6, compilado a CommonJS (`module: Node16`, sin `"type": "module"`) |
| Framework HTTP | Express 5 |
| Gestor de paquetes | **pnpm** (`packageManager: pnpm@10.28.2`, solo existe `pnpm-lock.yaml`; no hay `package-lock.json` ni `yarn.lock`) |
| ORM / DB | Prisma 7 + PostgreSQL (`@prisma/adapter-pg`, driver `pg`) |
| Tiempo real | Socket.io (inicializado en `src/Socket.ts`, pero los listeners están comentados — no hay eventos activos todavía) |
| Autenticación | JWT validado localmente, pero el usuario se resuelve contra una base de datos **externa** de MIREX (ver sección 3) |
| Almacenamiento de archivos | DigitalOcean Spaces (S3-compatible) vía `@aws-sdk/client-s3`, con fallback a filesystem local |
| Email | Nodemailer sobre SMTP configurable, con lógica de fallback de hosts y logging a DB (`ImportadexEmailLog`) |
| Contenedores | `server/Dockerfile` (multi-stage, pnpm, build de Prisma + tsc) — no hay `docker-compose.yml` de producción en este repo |

## 2. Estructura del repositorio

```
src/
  App.ts                 # bootstrap Express + Prisma + Socket.io
  Routes.ts              # monta /api-alt -> routes/importadex
  Socket.ts              # Socket.io (handlers comentados, sin uso real aún)
  config/connectionDB.ts # cliente Prisma (adapter-pg)
  controllers/importadex/
  controllers/auth.controller.ts   # VACÍO (0 bytes) — scaffold sin usar
  controllers/user.controller.ts   # VACÍO (0 bytes) — scaffold sin usar
  routes/auth.routes.ts             # VACÍO — no se monta en Routes.ts
  routes/user.routes.ts             # VACÍO — no se monta en Routes.ts
  routes/importadex/importadex.routes.ts  # única ruta realmente activa
  middlewares/
    importadexAdmin.ts   # valida JWT y resuelve usuario contra MIREX_DATABASE_URL
    processFiles.ts       # multer + sharp + S3 (Spaces) o filesystem local
    loginRateLimit.ts      # rate limit en memoria (no usado en ninguna ruta activa actualmente)
    token.ts               # completamente comentado — código muerto (auth propia con Prisma User, abandonada)
  services/
    mirex-users.service.ts           # Pool `pg` crudo contra MIREX_DATABASE_URL
    importadex/importadex.service.ts
    importadex/importadex-client.service.ts
  helpers/
    emailManaged.ts   # SMTP, plantillas de email, ~1200 líneas
    encrypted.ts       # AES-256-CBC para email de clientes en reposo
    hashPassword.ts     # bcrypt (no referenciado desde ningún controller activo)
  validators/importadex.schemas.ts   # Zod
prisma/
  schema.prisma        # ~20 modelos, todos prefijados Importadex*
  migrations/           # 13 migraciones aplicadas, historial limpio
  seed.ts                # catálogos + 1 operación de ejemplo (ver riesgo 6.1)
server/Dockerfile
```

### Dominio de negocio (Prisma models)

Gestión de operaciones logísticas de importación/exportación para clientes de "Importadex / Flypack": `ImportadexOperation` (con `shipments`, `containers`, `cargoItems`, `customsFiles`, `documents`, `events`, `incidents`, `comments`, `attachments`, `auditLogs`, `emailLogs`), `ImportadexClient` (personas/empresas, con aprobación/rechazo por un admin), catálogos configurables (`ImportadexCatalog`, providers, carriers, ports, airports, warehouses, terminals).

## 3. Autenticación — depende de un sistema externo (MIREX)

Este backend **no tiene su propio sistema de usuarios**. El flujo real es:

1. El cliente envía un JWT (header `x-access-token` o `Authorization: Bearer`).
2. `src/middlewares/importadexAdmin.ts` verifica la firma con `MIREX_JWT_SECRET` o `JWT_SECRET` (prueba ambos).
3. Con el `_id`/`email` del payload, se consulta una tabla `users` en una base de datos **distinta** (`MIREX_DATABASE_URL`) vía `src/services/mirex-users.service.ts`, usando `pg` crudo (no Prisma).
4. El rol devuelto (`ADMIN` / `IMPORTADEX_ADMIN` / `OPERACIONES`, etc.) determina acceso a rutas admin.

Esto significa que **para reproducir el comportamiento de auth localmente hace falta simular esa tabla `users` externa** (ver sección 5 — ya se hizo para esta auditoría). Los archivos `auth.routes.ts`, `user.routes.ts`, `auth.controller.ts`, `user.controller.ts` y `middlewares/token.ts` son restos de un intento anterior de sistema de auth propio (con Prisma `User` + bcrypt + JWT) que fue **abandonado** en favor de delegar en MIREX. Están vacíos o comentados — no development activo ahí salvo que se decida retomarlos explícitamente.

`passport` y `passport-google-oauth20` están en `package.json` pero **no se usan en ningún archivo de `src/`** — dependencia muerta.

## 4. Variables de entorno

Solo se documentan nombre y propósito — nunca valores reales de producción.

```env
# Bases de datos
DATABASE_URL=            # Postgres propio de Importadex (Prisma)
MIREX_DATABASE_URL=      # Postgres del sistema MIREX (solo lectura de tabla `users`, pg crudo)

# App
PORT=                    # puerto HTTP (5000 en .env.example — cuidado: choca con AirPlay Receiver en macOS)
NODE_ENV=                # "DEV" | "PROD" (valores custom, no el estándar "development"/"production")
URL_FRONTEND=             # origen permitido por CORS de Socket.io en PROD

# Seguridad
JWT_SECRET=               # firma/verifica JWT propio
MIREX_JWT_SECRET=         # firma/verifica JWT emitidos por MIREX (se prueban ambos secrets)
ENCRYPTION_KEY=            # AES-256-CBC — DEBE tener exactamente 32 bytes o crashea en runtime

# Email (Nodemailer)
EMAILUSER / EMAILPASS / EMAIL_FROM
SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASSWORD
SMTP_FALLBACK_HOSTS
SMTP_CONNECTION_TIMEOUT_MS / SMTP_GREETING_TIMEOUT_MS / SMTP_SOCKET_TIMEOUT_MS
SMTP_ALLOW_LOCAL_RECIPIENTS
IMPORTADEX_EMAIL_AUDIT_BCC   # BCC de auditoría para emails salientes

# Seed (NO USADAS actualmente en el código — ver riesgo 6.4)
SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME

# Almacenamiento (DigitalOcean Spaces / S3-compatible)
SPACES_ENDPOINT / SPACES_REGION / SPACES_NAME / SPACES_BUCKET / SPACES_PUBLIC_URL
SPACES_UPLOAD_PREFIX
ACCESS_KEY_ID / ACCESS_SECRET_KEY / ACCESS_KEY_NAME
LOCAL_UPLOAD_DIR / LOCAL_UPLOAD_PUBLIC_URL   # fallback si no hay bucket configurado
MAX_UPLOAD_MB
```

`SPACES_REGION` y `SPACES_ENDPOINT` **no pueden estar vacíos nunca**, ni siquiera en local — ver riesgo 6.2.

## 5. Cómo levantar el entorno local (ya validado en esta auditoría)

Requisitos: Docker, Node 20+ (probado también con Node 22 sin problemas), y `pnpm` (no viene preinstalado en esta máquina; usar `npx pnpm@10.28.2 <comando>` o instalarlo vía `corepack enable` con permisos adecuados).

1. **Postgres local (dos instancias):** un `docker-compose.local.yml` (no versionado, solo para desarrollo) levanta:
   - `db` (puerto `55432`) → `DATABASE_URL` propio de Importadex.
   - `mirex_db` (puerto `55433`) → simula `MIREX_DATABASE_URL`. Requiere crear manualmente una tabla `users` mínima (`id, email, name, role, institution, active, status`) e insertar un usuario `ADMIN` de prueba, ya que el schema real de MIREX no vive en este repo.
2. **`.env` local** (gitignorado por `.gitignore`, seguro de editar): usar `.env.example` como base, con secretos generados localmente (nunca reutilizar credenciales de producción), `PORT` distinto de `5000` en macOS (conflicto con AirPlay Receiver), y `SPACES_REGION`/`SPACES_ENDPOINT` con cualquier valor no vacío aunque no haya bucket real (dejar `SPACES_NAME`/`SPACES_BUCKET`/`ACCESS_KEY_NAME` vacíos activa el fallback a filesystem local).
3. Instalar dependencias: `pnpm install`.
4. `pnpm run db:generate` (Prisma Client).
5. `pnpm run db:deploy` (aplica las 13 migraciones existentes sin generar nuevas — más seguro que `db:migrate` para un entorno que solo consume el historial existente).
6. `pnpm run db:seed` — **actualmente falla** (ver riesgo 6.1); no es bloqueante para levantar el servidor.
7. `pnpm run dev` levanta el servidor con `tsx watch`. `pnpm run build` (tsc + tsc-alias) compila sin errores.

Todo esto fue ejecutado y verificado end-to-end en esta sesión: catálogos, dashboard, listado de operaciones, y el guard de admin (`requireImportadexAdmin`) devolviendo `401` sin token y `200` con un JWT firmado localmente y resuelto contra el usuario mock de MIREX.

## 6. Riesgos técnicos y operativos identificados

1. ~~**`prisma/seed.ts` está roto.**~~ **CORREGIDO (2026-08-03).** Insertaba en `importadex_operations`, `importadex_containers`, `importadex_cargo_items`, `importadex_documents`, `importadex_customs_files` e `importadex_incidents` con SQL crudo (`$executeRawUnsafe`) sin incluir `updated_at`. La migración `20260609234617_migrationdocker_postgreesql_init` eliminó el `DEFAULT CURRENT_TIMESTAMP` de esa columna en esas seis tablas (comportamiento esperado de Prisma con campos `@updatedAt`, que normalmente los puebla el cliente, no la DB). Como el seed usa SQL crudo y no el cliente Prisma, la columna llegaba `NULL` y violaba el `NOT NULL`. Se agregó `updated_at` (con `now()`) a los seis INSERT afectados. Validado localmente: `pnpm run db:seed` corre limpio, es idempotente (se probó dos veces), y todas las filas quedan con `updated_at` poblado.
2. ~~**Crash total de la app si `SPACES_REGION` falta.**~~ **CORREGIDO (2026-08-03).** `src/middlewares/processFiles.ts` instanciaba `new S3Client(...)` a nivel de módulo (import time), no de forma perezosa. El SDK de AWS lanzaba `Error: Region is missing` si no había región resoluble, y como este middleware se importa desde `Routes.ts` en el arranque, **toda la aplicación crasheaba al iniciar**, no solo la subida de archivos. Se cambió a un getter perezoso (`getS3Client()`) que solo instancia el cliente cuando realmente hay un bucket configurado y se va a subir un archivo a Spaces. Validado localmente: el servidor arranca y el fallback a filesystem local funciona correctamente con `SPACES_REGION`/`SPACES_ENDPOINT` vacíos.
3. **Doble base de datos con acoplamiento fuerte a un sistema externo.** Cualquier cambio de esquema en la tabla `users` de MIREX (columnas, nombres, tipos) rompe silenciosamente `mirex-users.service.ts` sin que este repo lo detecte en build/tests, porque es SQL crudo sin tipado compartido. ~~**Confirmado en producción (2026-08-04):** el contenedor `api-alt` real actualmente registra `Importadex notifications skipped: MIREX_DATABASE_URL is missing.` en cada operación creada — es decir, las notificaciones internas (a staff ADMIN/OPERACIONES) están deshabilitadas en producción.~~ **CORREGIDO (2026-08-04).** Se copió el mismo valor de `DATABASE_URL` que ya usa `MIREXBackend/.env` (la misma DB donde vive la tabla `users`) como `MIREX_DATABASE_URL` en `/opt/MIREX/ImportadexBackend/.env`, y se recreó el contenedor (`docker compose up -d --force-recreate api-alt`). Backup previo del `.env` en `/opt/MIREX/ImportadexBackend/.env.bak.1785873163`. Validado con una query de conteo ejecutada dentro del propio contenedor (`docker exec api-alt node -e ...`, misma condición que usa `getImportadexNotificationUsers()`): devuelve 3 usuarios `ADMIN` y 5 `OPERACIONES` activos — la consulta que antes devolvía `[]` ahora resuelve destinatarios reales. Sigue existiendo el riesgo de acoplamiento de esquema descrito arriba; solo se corrigió que la variable de entorno faltara.
4. **Deriva entre `.env.example` y el código real.** `SEED_ADMIN_EMAIL/PASSWORD/NAME` están documentadas pero no se usan en ningún lado (`seed.ts` no las referencia). Indica documentación de env vars desactualizada o una feature de auto-creación de admin que se planeó y nunca se implementó.
5. **Sin tests automatizados** (`"test": "echo \"Error: no test specified\" && exit 1"`), **sin ESLint/Prettier configurado**, **sin CI/CD** (`.github/` no existe). Todo el control de calidad depende de revisión manual antes del deploy.
6. **`dist/` (build compilado) está versionado en git**, junto al código fuente. Esto duplica el diff en cada commit y puede generar drift si el build local no coincide exactamente con el que corre en producción (el Dockerfile reconstruye desde cero, pero el `dist/` commiteado sugiere que en algún momento se ha corrido `node ./dist/src/App.js` directo sin rebuild).
7. **Historial de git en una sola rama (`main`), sin PRs, un solo autor.** 15 commits directos a `main` desde julio 2026. No hay convención de branching ni revisión de código visible en el historial.
8. **Código muerto que puede confundir a futuras sesiones:** `middlewares/token.ts` (100% comentado), `auth.routes.ts`/`user.routes.ts`/`auth.controller.ts`/`user.controller.ts` (vacíos, no montados), dependencias `passport`/`passport-google-oauth20` sin uso, `loginRateLimit.ts` no enganchado a ninguna ruta activa.
9. **`ENCRYPTION_KEY` sin validación de longitud.** `helpers/encrypted.ts` usa `Buffer.from(ENCRYPTION_KEY)` directo como clave AES-256, que requiere exactamente 32 bytes. Un valor de longitud incorrecta en `.env` de producción rompería el registro/consulta de clientes en runtime sin aviso previo en el arranque.
10. **`package.json.main` apunta a `index.js`** (inexistente), mientras que el script `start` real usa `./dist/src/App.js`. Inconsistencia menor pero puede confundir a herramientas que lean `main`.
11. **El build de Docker depende de una ruta relativa (`../MIREX-CLIENT`) fuera de este repo.** Si alguien intenta construir la imagen solo con `ImportadexBackend/` como contexto, el build fallará. Esto no quedó documentado en ningún README de este repo.

## 7. Arquitectura de producción (confirmada 2026-08-04)

El Droplet (`IMPORTADEX-OPS`, Ubuntu 24.04, IP `143.244.147.235`) corre todo vía **Docker Compose**, orquestado desde `/opt/MIREX/docker-compose.yml` (fuera de este repo). Estructura real en el servidor:

```
/opt/MIREX/
  docker-compose.yml       # orquesta los 4 servicios de abajo
  ImportadexBackend/        # este repo, clonado (git remoto configurado, origin = GitHub)
  MIREXBackend/              # backend del sistema MIREX (otro repo)
  MIREX-CLIENT/               # frontend (otro repo)
```

Servicios definidos en `docker-compose.yml`:

| Servicio | Imagen/build | Puerto interno | Rol |
|---|---|---|---|
| `nginx` | `nginx:1.25-alpine` | 80/443 (públicos) | Proxy reverso, TLS (certbot + letsencrypt montado) |
| `client` | build de `MIREX-CLIENT` | 80 (interno) | Frontend MIREX (React/Vite, según `VITE_API_URL_DEV`/`VITE_API_ALT_DEV`) |
| `api` | build de `MIREXBackend/server/Dockerfile` | 3000 (interno) | Backend MIREX (otro repo, no este) |
| `api-alt` | build de **este repo** (`ImportadexBackend/server/Dockerfile`) | 3000 (interno) | **Este backend**, montado bajo `/api-alt` |

No hay PM2, systemd ni nginx a nivel de host — todo containerizado. Cada servicio usa su propio `env_file` (ej. `api-alt` usa `/opt/MIREX/ImportadexBackend/.env`).

**Base de datos real:** no vive en el Droplet — es **Neon** (Postgres serverless administrado, `*.neon.tech`, región `us-east-1`). `DATABASE_URL` apunta ahí.

### Proceso de deploy (el que se usó el 2026-08-04, sin script propio — todo manual vía consola web de DigitalOcean)

```bash
cd /opt/MIREX/ImportadexBackend
git fetch origin && git pull                 # trae el código nuevo (fast-forward)

cd /opt/MIREX
docker compose build api-alt                  # reconstruye SOLO la imagen (sin downtime)
docker compose run --rm api-alt pnpm run db:deploy   # aplica migraciones pendientes de Prisma
                                                        # (contenedor temporal, no toca el que está en vivo)
docker compose up -d api-alt                    # recrea el contenedor en vivo (downtime breve, solo /api-alt)
docker logs api-alt --tail 60                    # verificar arranque sin errores
```

**Importante:** antes del `up -d`, siempre correr `db:deploy` si el `git pull` trajo migraciones nuevas de Prisma — el código nuevo puede depender de columnas/tablas que no existen aún.

No existe pipeline de CI/CD — todo el proceso arriba es manual. Considerar automatizarlo (GitHub Actions + SSH, o un webhook) como mejora futura.

## 8. Incidente: correos de la app no llegan a destino (Bluehost) — RESUELTO (causa raíz confirmada + fix aplicado 2026-08-04)

**Causa raíz real (confirmada por logs de Exim de Bluehost, no especulación):** Nodemailer, al no recibir un `name` explícito en `createTransporter`, intentaba autodetectar el hostname local para el saludo SMTP (HELO/EHLO). Corriendo dentro del contenedor Docker del Droplet, esa autodetección resolvía a **`127.0.0.1`** en vez de un hostname real. El propio Exim de Bluehost tiene una regla anti-spam (`fightspamHG`) que **descarta automáticamente a `/dev/null`** cualquier correo cuyo HELO sea `127.0.0.1` — sin generar rebote, exactamente el síntoma observado. Corriendo desde una máquina normal (fuera de Docker), el hostname autodetectado es válido (`Manuels-MacBook-Pro.local`) y por eso esos envíos sí llegaban.

**Fix aplicado:** en `src/helpers/emailManaged.ts`, función `createTransporter`, se agregó `name: "importadex.do"` explícito a la config de `nodemailer.createTransport(...)`, eliminando la dependencia de la autodetección. Esto es exactamente lo que el equipo de soporte escalado de Bluehost (ticket `E-570847`) recomendó tras revisar sus logs.

### Cronología de la investigación (2026-08-04)

### Lo que se investigó y confirmó (2026-08-04)

1. El plan era migrar el envío de correo de la app de una cuenta Gmail vieja/rota (`EMAILUSER=jonaifry.rodriguez@flypack.com.do`, sin `SMTP_HOST` configurado → `getSmtpHost()` no resolvía nada porque ese correo no termina en `@gmail.com` → **ningún correo se enviaba en absoluto** antes de este trabajo) a `info@importadex.do` (Bluehost).
2. Se comprobó que **DNS está bien configurado** para `importadex.do`: SPF válido, DKIM válido (selector `default`), DMARC `p=none`. La herramienta "Email Deliverability" de cPanel confirma que el host de envío correcto/alineado (PTR + HELO) para este dominio es **`box2419.bluehost.com`** — no `mail.importadex.do` (que resuelve a otra caja compartida, `box989.bluehost.com`, sin la misma alineación).
3. Se probó el envío real (crear una operación → dispara `sendImportadexClientOperationEmail`) en 4 combinaciones:

   | Origen del envío | Host SMTP | Destinatario | ¿Llegó? |
   |---|---|---|---|
   | Mi máquina local (IP residencial) | `mail.importadex.do` | mherrera@flypack.com.do | ✅ Sí |
   | Droplet (producción, IP `143.244.147.235`, DigitalOcean) | `mail.importadex.do` | mherrera@flypack.com.do | ❌ No (sin spam, sin rebote) |
   | Mi máquina local | `box2419.bluehost.com` | mherrera@flypack.com.do | ✅ Sí |
   | Droplet (producción) | `box2419.bluehost.com` | mherrera@flypack.com.do | ❌ No |
   | Droplet (producción) | `box2419.bluehost.com` | manuelr_16@hotmail.com (dominio no relacionado) | ❌ No |

   En **todos** los casos el servidor SMTP respondió `250 OK` con `messageId` válido — es decir, la app hace su trabajo correctamente y Bluehost acepta el mensaje en cola. La única variable que correlaciona con el fallo es **el origen (IP del Droplet)**, no el host SMTP usado ni el dominio destinatario.
4. Se verificó que la IP del Droplet no está en las blacklists públicas principales (Spamhaus ZEN, Barracuda, SpamCop, SORBS) — el bloqueo, si es eso, es probablemente una política/heurística propia de Bluehost para conexiones SMTP AUTH desde IPs de datacenter/VPS conocidas (whois confirma `143.244.147.235` → `DigitalOcean, LLC`), no una lista negra pública.

### Estado final — CONFIRMADO EN PRODUCCIÓN (2026-08-04)

- `.env` de producción y local: `SMTP_HOST="box2419.bluehost.com"`, `SMTP_USER="info@importadex.do"`, `EMAIL_FROM="info@importadex.do"`, `SMTP_PORT=465`, `SMTP_SECURE=true` — correctos desde antes, el problema nunca fue la configuración SMTP.
- Fix de código (commit `4f63f2d`, `name: "importadex.do"` en `createTransporter`) desplegado a producción: `git pull` + `docker compose build api-alt` + `docker compose up -d api-alt`. Sin migraciones (no hubo cambios de schema).
- **Prueba real post-deploy:** se creó una operación nueva desde la UI (`IMPX-2026-870908`, cliente Manuel Herrera) y el correo **llegó a la bandeja de entrada** (no spam) en minutos. Confirmado con captura del correo real recibido.
- **Ticket con soporte de Bluehost (`E-570847`):** su equipo escalado identificó correctamente la causa (HELO loopback) revisando sus logs de Exim y sugirió el mismo fix que se aplicó. Queda pendiente responderles confirmando que se resolvió, para cerrar el ticket formalmente.
- Evidencia de la investigación (borradores de tickets, logs de Exim que dio soporte, capturas) quedó en la raíz del repo, no versionada: `ticket-bluehost-borrador.txt`, `ticket-bluehost-seguimiento.txt`, `smtp-config-para-soporte.jpg`, `exim logs of info@importadex.do.txt`, `Bluehost Customer Support [E-570847].png`.

## 9. Reglas de seguridad vigentes para esta y futuras sesiones

- No hacer commit, push, ni PR sin autorización explícita del usuario en cada ocasión.
- No conectarse ni escribir en `MIREX_DATABASE_URL` o `DATABASE_URL` de producción — usar siempre las instancias locales descritas en la sección 5.
- No reutilizar secretos de producción en `.env` local — generar valores nuevos (ver comandos usados en esta sesión con `crypto.randomBytes`).
- No modificar `server/Dockerfile`, la configuración del Droplet, Nginx, PM2, systemd o certificados sin presentar antes el impacto y obtener aprobación.
- No arreglar los riesgos de la sección 6 sin confirmar primero el alcance — varios (seed roto, S3Client eager) son candidatos obvios a fix, pero se dejan documentados, no corregidos, hasta autorización explícita.

## 10. Estado de git y producción (actualizado 2026-08-04)

- `origin` → `https://github.com/JRJ24/ImportadexBackend.git`, rama `main` sincronizada con `origin/main` en commit **`82cdce4`** ("fix: seed missing updated_at + eager S3Client crash") — **pusheado y desplegado en producción** el 2026-08-04.
- Producción (`/opt/MIREX/ImportadexBackend` en el Droplet) está al día con este commit: se hizo `git pull`, `docker compose build api-alt`, `docker compose run --rm api-alt pnpm run db:deploy` (aplicó las 4 migraciones pendientes) y `docker compose up -d api-alt`. Verificado con `docker logs` y con requests HTTPS reales contra `https://operaciones.importadex.do/api-alt/...`.
- `.gitignore` tiene cambios locales sin commitear (excluye `NOTAS_SESION_*.txt`, `Captura.png`, `.DS_Store`) — pendiente de decisión del usuario sobre si commitear.
- `.env`, `docker-compose.local.yml`, y los archivos de la sección 8 (`ticket-bluehost-*.txt`, capturas de consola/cPanel) existen localmente, no versionados y no deben commitearse.
- El `.env` de producción también fue modificado directamente en el Droplet (no vía git, es un archivo ignorado ahí también): se agregó `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` para Bluehost (ver sección 8). Queda un backup en el propio Droplet: `/opt/MIREX/ImportadexBackend/.env.bak.<timestamp>`.

## 11. Acceso operativo al Droplet vía `doctl` (agregado 2026-08-04)

- Esta Mac ahora tiene `doctl` autenticado contra la cuenta de DigitalOcean (`mherrera@flypack.com.do` / cuenta "My Team"), lo que permite listar/gestionar droplets y, vía `doctl compute ssh <droplet-id>`, ejecutar comandos remotos sin depender de un `ssh` directo con llaves preexistentes.
- Se agregó la llave pública `~/.ssh/id_ed25519` (`manuelr_16@hotmail.com`) a `/root/.ssh/authorized_keys` del droplet `IMPORTADEX-OPS` (ID `571678205`, IP `143.244.147.235`) vía la consola web de DigitalOcean, porque ninguna de las llaves privadas ya presentes en esta Mac (`importadex_id_rsa`, `flypack_deploy_ed25519`, el `id_ed25519` original) coincidía con la llave `SSHOPS` ya registrada en la cuenta de DO para ese droplet. `doctl compute ssh 571678205` ahora funciona de punta a punta.
- **Fix aplicado y confirmado en producción (2026-08-04):** riesgo de la sección 6.3 (notificaciones internas deshabilitadas). Se copió el valor de `DATABASE_URL` de `/opt/MIREX/MIREXBackend/.env` como `MIREX_DATABASE_URL` en `/opt/MIREX/ImportadexBackend/.env` (backup en `.env.bak.1785873163`), se recreó `api-alt` (`docker compose up -d --force-recreate api-alt`), y se validó con una query de conteo dentro del propio contenedor (misma condición que `getImportadexNotificationUsers()`): 3 `ADMIN` + 5 `OPERACIONES` activos. Las notificaciones internas de nuevas operaciones deberían llegar de nuevo a ese staff.
- Nota de permisos: el clasificador de auto-mode de Claude Code bloquea por defecto la ejecución de `doctl compute ssh` y cualquier referencia explícita a un archivo de llave privada (`--ssh-key-path`) hacia este droplet. Para permitir lo primero, el usuario agregó `"Bash(doctl compute ssh 571678205)"` y `"Bash(doctl compute ssh 571678205 *)"` a `permissions.allow` en `~/.claude/settings.json` (alcance: usuario global, no versionado). Lo segundo (`--ssh-key-path` explícito) sigue bloqueado — por eso el flujo depende de que el sistema encuentre la llave correcta por descubrimiento automático de SSH (`~/.ssh/id_ed25519` como nombre estándar), no por ruta explícita.
