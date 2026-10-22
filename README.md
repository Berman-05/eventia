# Eventia API (versión segura)

Backend de Eventia con autenticación JWT y control de acceso por rol, propiedad y estado del recurso.

- Actividad 23 — auditoría OWASP API Security Top 10: [INFORME.md](INFORME.md)
- Actividad 24 — autenticación y control de acceso: [INFORME-ACT24.md](INFORME-ACT24.md)

## Ejecutar

```bash
npm install
npm start          # frontend en http://localhost:3005 · API en http://localhost:3005/api
npm test           # 46 pruebas (seguridad + autenticación)
npm run token:vencido   # imprime un JWT vencido para probar en Postman
```

La base `eventia.db` se crea con datos semilla. Usuarios de prueba (contraseña `Eventia2026!`):

| Correo | Rol |
|---|---|
| admin@eventia.test | administrador |
| olga@eventia.test | organizador (eventos 1, 3 y 4 — el 4 está cerrado) |
| oscar@eventia.test | organizador (evento 2) |
| carlos@eventia.test | usuario |
| ana@eventia.test | usuario |

Variables de entorno: `PORT`, `DB_PATH`, `JWT_SECRET` (obligatorio cambiarlo fuera de desarrollo), `JWT_EXPIRES_IN` (por defecto `15m`).

## Frontend

`public/` contiene una interfaz web sin dependencias (HTML, CSS y JavaScript) que el mismo servidor publica en `/`:

- **Eventos:** tarjetas con fecha, precio, cupos y estado; inscripción con selector de cantidad.
- **Mis inscripciones:** boletos del usuario autenticado.
- **Mis eventos** (organizador): crear, editar, cerrar y ver participantes.
- **Administración** (administrador): cambiar roles.
- **Laboratorio de acceso:** las pruebas de la Actividad 24 con un clic y su resultado.
- **Respuesta del backend:** registro de cada solicitud con su código HTTP.

El interruptor *“Mostrar también las acciones que no me corresponden”* hace visibles los botones que la interfaz normalmente oculta, para demostrar que la API los rechaza aunque el frontend los muestre. El token se guarda solo en memoria: al recargar la página hay que iniciar sesión de nuevo.

## Autenticación

1. `POST /api/auth/login` → `{ token, expiraEn }`
2. Enviar `Authorization: Bearer <token>` en cada petición protegida.
3. `POST /api/auth/logout` revoca el token; `POST /api/auth/logout-todas` cierra todas las sesiones.

Los 401 incluyen `codigo`: `token_ausente`, `token_invalido`, `token_expirado` o `token_revocado`.

## Estructura

- `public/` — frontend (index.html, styles.css, app.js)
- `src/routes/` — endpoints (`auth`, `usuarios`, `eventos`, `inscripciones`)
- `src/middleware/auth.js` — JWT y autorización por rol
- `src/schemas.js` — validación estricta (zod)
- `src/dto.js` — respuestas con lista blanca de campos
- `docs/openapi.yaml` — documentación OpenAPI 3
- `docs/eventia.postman_collection.json` — colección Actividad 23
- `docs/eventia-act24.postman_collection.json` — colección Actividad 24 (6 pruebas)
- `evidencias/` — resultados de las pruebas
