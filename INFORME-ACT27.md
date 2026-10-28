# Despliegue web y Docker aplicado a Eventia

**Universidad Rafael Landívar** — Campus San Alberto Hurtado, S.J. de Quetzaltenango
**Curso:** Programación Web — **Docente:** Ing. Manuel Rojas
**Actividad 27**

Nombre: ______________________________ Carné: ______________

| Entregable | Enlace |
|---|---|
| URL pública | **_<pendiente: URL de Render, p. ej. https://eventia-xxxx.onrender.com>_** |
| Repositorio | https://github.com/Berman-05/eventia |
| Dockerfile | [Dockerfile](Dockerfile) |
| Docker Compose | [docker-compose.yml](docker-compose.yml) |
| Configuración de Render | [render.yaml](render.yaml) |
| Evidencia de Docker y persistencia | [evidencias/act27-docker.md](evidencias/act27-docker.md) |

---

## 1) Despliegue real de Eventia

### Preparación del repositorio

Para poder desplegarlo, Eventia necesitaba tres cambios:

1. **Base de datos externa.** Hasta la Actividad 24, Eventia guardaba todo en un archivo SQLite dentro del servidor. En las plataformas gratuitas el disco del servidor es efímero: se borra en cada despliegue o reinicio, así que los datos se perderían. Se agregó una capa de datos ([src/db.js](src/db.js)) con la misma interfaz asíncrona para dos motores:
   - **PostgreSQL** cuando existe la variable `DATABASE_URL` (producción y Docker).
   - **SQLite** en memoria o en un archivo cuando no existe (pruebas y desarrollo rápido).

   Las rutas no saben qué motor usan. Las 46 pruebas automatizadas pasan con ambos.
2. **Configuración por variables de entorno** ([.env.example](.env.example)): puerto, base de datos, secreto JWT, contraseña de las cuentas de demostración y proxy de confianza. Si `NODE_ENV=production` y falta `JWT_SECRET`, el servidor no arranca, para no firmar tokens con el secreto de desarrollo.
3. **Endpoint de salud** `GET /api/salud`: comprueba que la base de datos responde. Lo usan Render y el `HEALTHCHECK` de Docker.

### Plataforma seleccionada: Render

| Criterio | Render | Vercel / Netlify | Railway | Heroku |
|---|---|---|---|---|
| Servidor Node.js siempre activo (Express) | ✅ | ❌ Orientadas a sitios estáticos y funciones *serverless* | ✅ | ✅ |
| PostgreSQL administrado | ✅ Plan gratuito | ❌ Requiere un servicio externo | ✅ | ✅ |
| Despliega desde un Dockerfile | ✅ | ❌ | ✅ | ✅ |
| Costo para el curso | Gratis, sin tarjeta | Gratis | Crédito de prueba limitado | De pago |
| HTTPS en un subdominio | ✅ `*.onrender.com` | ✅ | ✅ | ✅ |
| Infraestructura como código | ✅ `render.yaml` (Blueprint) | Parcial | Parcial | Parcial |

**Justificación:** Eventia es un servidor Express de larga duración que también publica el frontend y usa una base de datos relacional. Render ofrece las dos piezas gratis y sin tarjeta, construye la misma imagen Docker que usamos localmente y entrega HTTPS de forma automática. Además, con `render.yaml` toda la configuración queda versionada en el repositorio. Vercel y Netlify se descartaron porque están pensados para frontends y funciones *serverless*, no para un servidor Express con estado ni para PostgreSQL.

### Configuración (Blueprint `render.yaml`)

| Recurso | Configuración |
|---|---|
| `eventia-db` | PostgreSQL administrado, plan gratuito, región Oregon |
| `eventia` (web) | Construido con el `Dockerfile`, plan gratuito, *health check* en `/api/salud`, despliegue automático en cada push a `main` |

| Variable | Valor | Motivo |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión **interna** de `eventia-db` | La base no queda expuesta a Internet |
| `JWT_SECRET` | Generada por Render (aleatoria) | No se guarda en el repositorio |
| `SEED_PASSWORD` | Se escribe en el panel al crear el Blueprint | Contraseña de las cuentas de demostración, fuera del código |
| `TRUST_PROXY` | `1` | Render pone un proxy delante: así el límite de intentos de login ve la IP real del cliente |
| `NODE_ENV` | `production` | Activa la verificación de `JWT_SECRET` |

### Pasos para publicar

1. Entrar a <https://render.com> con la cuenta de GitHub.
2. **New → Blueprint** y seleccionar el repositorio `Berman-05/eventia`.
3. Escribir un valor para `SEED_PASSWORD` y pulsar **Apply**.
4. Esperar a que termine el build (unos 3–5 minutos) y abrir la URL `https://eventia-….onrender.com`.

### Verificación del despliegue

_Completar con capturas del sitio publicado:_

| Prueba | Resultado | Captura |
|---|---|---|
| Abrir la URL pública con HTTPS (candado del navegador) | | |
| `GET /api/salud` responde `{"estado":"ok","baseDeDatos":"postgres"}` | | |
| Abrir el sitio desde otro dispositivo o red (por ejemplo, el celular con datos móviles) | | |
| Panel de Render: servicio *Live* y base de datos *Available* | | |

---

## 2) Base de datos y persistencia

Eventia usa **PostgreSQL**: en Render, el servicio administrado `eventia-db`; en Docker, el contenedor `postgres:17-alpine` con un volumen.

Procedimiento demostrado en Docker ([evidencias/act27-docker.md](evidencias/act27-docker.md)) y que debe repetirse en el sitio publicado:

| Paso | Acción en Eventia | Resultado en Docker |
|---|---|---|
| 1. Registrar información | Crear una cuenta, publicar un evento como organizador e inscribirse con la cuenta nueva | Cuenta `id 6`, evento `id 5` con 40 cupos, inscripción de 3 lugares |
| 2. Cerrar la aplicación | `docker compose down` elimina los dos contenedores | No queda ningún contenedor de Eventia; el volumen `eventia_eventia-pgdata` sigue existiendo |
| 3. Volver a ingresar | `docker compose up -d` e iniciar sesión con la cuenta creada | Inicio de sesión correcto |
| 4. Consultar los datos | *Mis inscripciones* y consulta SQL directa | La inscripción de 3 lugares sigue ahí y el evento muestra `disponibles: 37` |

**En el sitio publicado:** registrar una cuenta e inscribirse, cerrar sesión y el navegador, volver a entrar desde otro dispositivo y abrir *Mis inscripciones*. En Render se puede además usar **Manual Deploy → Restart service**: el contenedor se reinicia y los datos siguen ahí porque viven en `eventia-db`, no en el servidor web.

---

## 3) Docker aplicado al proyecto

Se ejecutaron en Docker **dos componentes**: el backend con el frontend (imagen propia `eventia-app`) y la base de datos (imagen oficial `postgres:17-alpine`).

### Dockerfile

```dockerfile
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
USER node
ENV PORT=3005
EXPOSE 3005
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
```

Decisiones:
- Primero se copian solo `package.json` y `package-lock.json`, así la capa de dependencias se reutiliza mientras no cambien.
- Se instalan solo las dependencias de producción (`--omit=dev`). El `.dockerignore` deja fuera pruebas, documentación, la base local y `node_modules`.
- El proceso corre como el usuario sin privilegios `node`, no como root.
- `HEALTHCHECK` consulta `/api/salud`, de modo que Docker marca el contenedor como *healthy* solo cuando la API y la base de datos responden.

### docker-compose.yml (resumen)

```yaml
services:
  db:
    image: postgres:17-alpine
    environment: { POSTGRES_DB: eventia, POSTGRES_USER: eventia, POSTGRES_PASSWORD: … }
    volumes:
      - eventia-pgdata:/var/lib/postgresql/data   # volumen persistente
    healthcheck: { test: pg_isready -U eventia -d eventia }
  app:
    build: .
    depends_on: { db: { condition: service_healthy } }   # espera a que PostgreSQL esté listo
    environment:
      DATABASE_URL: postgres://eventia:…@db:5432/eventia
    ports: ["3005:3005"]
volumes:
  eventia-pgdata:
```

### Comandos y resultados

| Paso | Comando | Resultado |
|---|---|---|
| Construir la imagen y descargar PostgreSQL | `docker compose up -d --build` | Se crean el volumen `eventia_eventia-pgdata`, la red `eventia_default` y los contenedores `eventia-db` y `eventia-app` |
| Ver los contenedores | `docker compose ps` | `eventia-app … Up (healthy) 0.0.0.0:3005->3005` y `eventia-db … Up (healthy) 0.0.0.0:5433->5432` |
| Comprobar que funciona | `curl http://localhost:3005/api/salud` | `{"estado":"ok","baseDeDatos":"postgres"}` |
| Ver los registros | `docker logs eventia-app` | `Eventia escuchando en el puerto 3005 (base de datos: postgres)` |
| Pruebas automatizadas contra el PostgreSQL del contenedor | `TEST_DATABASE_URL=postgres://eventia:eventia_local@localhost:5433/eventia_test npm run test:pg` | **46 de 46 pruebas aprobadas** (incluida la de 10 inscripciones simultáneas sobre 3 cupos) |
| Comprobar la persistencia del volumen | `docker compose down` y luego `docker compose up -d` | Los datos registrados siguen ahí (ver sección 2) |
| Detener sin borrar datos | `docker compose down` | — |
| Borrar también los datos | `docker compose down -v` | Elimina el volumen |

Salida completa de cada comando: [evidencias/act27-docker.md](evidencias/act27-docker.md).

> **Capturas:** Docker Desktop → *Containers* (eventia-app y eventia-db en verde), *Volumes* (eventia_eventia-pgdata) y el navegador en http://localhost:3005.

---

## Diagrama de la arquitectura desplegada

```mermaid
flowchart LR
    U["👤 Usuario<br/>(navegador o celular)"] -- "HTTPS" --> R

    subgraph Render["Render (nube)"]
        R["Proxy / TLS<br/>eventia-….onrender.com"] -- "HTTP :3005" --> W
        subgraph W["Servicio web 'eventia' — contenedor Docker"]
            S["Express 5<br/>frontend estático (public/)<br/>API REST /api/*<br/>JWT + RBAC/ABAC"]
        end
        W -- "DATABASE_URL<br/>(red interna)" --> D[("PostgreSQL<br/>eventia-db")]
    end

    G["GitHub<br/>Berman-05/eventia"] -- "push a main → build del Dockerfile" --> W

    subgraph Local["Equipo de desarrollo — Docker Compose"]
        A["eventia-app<br/>:3005"] --> P[("eventia-db<br/>postgres:17-alpine")]
        P --- V[("volumen<br/>eventia-pgdata")]
    end
```

El mismo `Dockerfile` se usa en los dos entornos: en Render la base de datos es un servicio administrado y en el equipo local es un contenedor con volumen.

---

## 4) Análisis técnico

**1. ¿Qué plataforma utilizaron y por qué?**
Render. Ejecuta un servidor Node.js de forma continua, ofrece PostgreSQL administrado y HTTPS gratis sin pedir tarjeta, y construye directamente nuestro `Dockerfile`: lo que probamos en Docker es lo mismo que corre en producción. Con el Blueprint `render.yaml` la infraestructura queda descrita en el repositorio y se puede volver a crear con un clic.

**2. ¿Qué componentes de Eventia desplegaron y dónde?**
- **Frontend y API** (un solo servicio Express): en Render como *Web Service* construido desde el Dockerfile, en `https://eventia-….onrender.com`.
- **Base de datos PostgreSQL**: en Render como base administrada `eventia-db`, accesible solo por la red interna.
- **Localmente con Docker Compose**: los mismos dos componentes (`eventia-app` y `eventia-db` con volumen persistente).

**3. ¿Qué dificultades encontraron al publicar la aplicación?**
- **Persistencia:** SQLite guardaba los datos en un archivo del servidor, que en Render se pierde en cada despliegue. Hubo que adaptar la capa de datos a PostgreSQL: el acceso pasó de síncrono a asíncrono, cambiaron los tipos (`SERIAL`, `DOUBLE PRECISION`), los marcadores `?` pasaron a `$1` y `lastInsertRowid` se reemplazó por `RETURNING`.
- **Concurrencia:** con varias conexiones a PostgreSQL, las transacciones necesitan una conexión dedicada. También hubo que convertir la violación de `UNIQUE` en un `409` cuando dos solicitudes iguales llegan al mismo tiempo.
- **Proxy inverso:** detrás del proxy de Render todas las solicitudes parecen venir de la misma IP, y el límite de intentos de login habría bloqueado a todos a la vez. Se resolvió con `TRUST_PROXY=1`.
- **Secretos:** el secreto JWT y la contraseña de las cuentas de demostración no pueden ir en el repositorio. Se mueven a variables de entorno y el servidor se niega a arrancar en producción sin `JWT_SECRET`.
- **Plan gratuito:** el servicio se suspende tras 15 minutos sin tráfico y la primera visita tarda unos 50 segundos en despertar. La base de datos gratuita de Render vence a los 30 días.

**4. ¿Qué ventajas encontraron al utilizar Docker?**
- **Mismo entorno en todas partes:** la imagen fija la versión de Node (24) y las dependencias, así que el código que corre en la computadora es el mismo que corre en Render.
- **PostgreSQL sin instalarlo:** con un solo `docker compose up` se tiene la base lista, y con `down -v` se descarta.
- **Persistencia controlada:** el volumen separa los datos del contenedor, que se puede destruir y recrear sin perder información.
- **Orden de arranque y salud:** `depends_on` con `service_healthy` evita que la app intente conectarse antes de que PostgreSQL esté listo, y el `HEALTHCHECK` indica cuándo el servicio realmente funciona.
- **Pruebas reales:** la suite completa corrió contra un PostgreSQL de verdad, no solo contra SQLite en memoria.

**5. ¿Qué mejorarían antes de usar Eventia en producción real?**
- **Plan de pago** sin suspensión, con base de datos persistente y **respaldos automáticos** con restauración probada.
- **Migraciones versionadas** (por ejemplo `node-pg-migrate`) en lugar de crear y alterar tablas al iniciar.
- **Quitar las cuentas de demostración** y crear el primer administrador con un proceso seguro.
- **Refresh tokens** en cookie `HttpOnly` con rotación, para que la sesión no termine cada 15 minutos.
- **Límite de intentos compartido** (Redis), porque el actual vive en la memoria de una sola instancia y no sirve al escalar horizontalmente.
- **Cabeceras de seguridad** (Helmet: CSP, HSTS) y CORS restringido.
- **Observabilidad:** logs estructurados, métricas, alertas y seguimiento de errores (por ejemplo, Sentry).
- **CI/CD:** ejecutar las pruebas (SQLite y PostgreSQL) en GitHub Actions antes de cada despliegue, y un entorno de *staging*.
- **Dominio propio** y servir las fuentes desde el propio sitio para no depender de terceros.
