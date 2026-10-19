# Eventia API (versión segura)

Backend de Eventia con autenticación JWT y control de acceso por rol, propiedad y estado del recurso.

- Actividad 23 — auditoría OWASP API Security Top 10: [INFORME.md](INFORME.md)
- Actividad 24 — autenticación y control de acceso: [INFORME-ACT24.md](INFORME-ACT24.md)

## Ejecutar

```bash
npm install
npm start          # http://localhost:3000/api
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

## Autenticación

1. `POST /api/auth/login` → `{ token, expiraEn }`
2. Enviar `Authorization: Bearer <token>` en cada petición protegida.
3. `POST /api/auth/logout` revoca el token; `POST /api/auth/logout-todas` cierra todas las sesiones.

Los 401 incluyen `codigo`: `token_ausente`, `token_invalido`, `token_expirado` o `token_revocado`.

## Estructura

- `src/routes/` — endpoints (`auth`, `usuarios`, `eventos`, `inscripciones`)
- `src/middleware/auth.js` — JWT y autorización por rol
- `src/schemas.js` — validación estricta (zod)
- `src/dto.js` — respuestas con lista blanca de campos
- `docs/openapi.yaml` — documentación OpenAPI 3
- `docs/eventia.postman_collection.json` — colección Actividad 23
- `docs/eventia-act24.postman_collection.json` — colección Actividad 24 (6 pruebas)
- `evidencias/` — resultados de las pruebas
