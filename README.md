# Eventia

Plataforma web para descubrir eventos, reservar lugares y administrarlos. Backend Express con autenticación JWT y control de acceso por rol, propiedad y estado del recurso; PostgreSQL o SQLite; frontend sin dependencias.

## Ejecutar

### Con Docker (app + PostgreSQL)

```bash
docker compose up -d --build   # http://localhost:3005
docker compose ps              # ambos contenedores deben estar "healthy"
docker compose down            # detiene; los datos quedan en el volumen eventia-pgdata
docker compose down -v         # detiene y borra los datos
```

### Sin Docker (SQLite)

```bash
npm install
npm start          # frontend en http://localhost:3005 · API en http://localhost:3005/api
npm test           # 46 pruebas (seguridad + autenticación) sobre SQLite en memoria
npm run test:pg    # las mismas pruebas sobre PostgreSQL (requiere TEST_DATABASE_URL)
npm run token:vencido   # imprime un JWT vencido para probar en Postman
```

### Despliegue

[render.yaml](render.yaml) describe el servicio web (construido con el `Dockerfile`) y la base PostgreSQL en Render: **New → Blueprint** → seleccionar este repositorio → escribir `SEED_PASSWORD` → **Apply**.

Sin `DATABASE_URL`, la base `eventia.db` (SQLite) se crea con datos semilla. Usuarios de prueba (contraseña `Eventia2026!`, o el valor de `SEED_PASSWORD`):

| Correo | Rol |
|---|---|
| admin@eventia.test | administrador |
| olga@eventia.test | organizador (eventos 1, 3 y 4 — el 4 está cerrado) |
| oscar@eventia.test | organizador (evento 2) |
| carlos@eventia.test | usuario |
| ana@eventia.test | usuario |

Variables de entorno: ver [.env.example](.env.example) (`PORT`, `DATABASE_URL`, `DB_PATH`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `SEED_PASSWORD`, `TRUST_PROXY`).

## Frontend

`public/` contiene la interfaz web (HTML, CSS y JavaScript, sin dependencias) que el mismo servidor publica en `/`:

- **Eventos:** tarjetas con fecha, precio, cupos y estado; búsqueda, filtros y reserva de 1 a 4 lugares.
- **Iniciar sesión / Crear cuenta:** ventanas modales desde la cabecera.
- **Mis inscripciones:** boletos del usuario autenticado.
- **Mis eventos** (organizador): crear, editar, cerrar y ver participantes.
- **Administración** (administrador): cambiar roles.

La interfaz muestra a cada persona solo las acciones de su rol, pero las reglas de acceso las aplica la API. El token se guarda solo en memoria: al recargar la página hay que iniciar sesión de nuevo. Las pruebas de acceso de la Actividad 24 están en `docs/eventia-act24.postman_collection.json`.

## Autenticación

1. `POST /api/auth/login` → `{ token, expiraEn }`
2. Enviar `Authorization: Bearer <token>` en cada petición protegida.
3. `POST /api/auth/logout` revoca el token; `POST /api/auth/logout-todas` cierra todas las sesiones.

Los 401 incluyen `codigo`: `token_ausente`, `token_invalido`, `token_expirado` o `token_revocado`.

## Estructura

- `public/` — frontend (index.html, styles.css, app.js)
- `src/db.js` — capa de datos (PostgreSQL o SQLite)
- `src/routes/` — endpoints (`auth`, `usuarios`, `eventos`, `inscripciones`)
- `src/middleware/auth.js` — JWT y autorización por rol
- `src/schemas.js` — validación estricta (zod)
- `src/dto.js` — respuestas con lista blanca de campos
- `docs/openapi.yaml` — documentación OpenAPI 3
- `docs/eventia.postman_collection.json` — colección Actividad 23
- `docs/eventia-act24.postman_collection.json` — colección Actividad 24 (6 pruebas)
- `evidencias/` — resultados de las pruebas
