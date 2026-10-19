# Eventia API (versión segura)

Backend de Eventia corregido tras la auditoría de seguridad de la Actividad 23 (OWASP API Security Top 10 – 2023).
El informe completo está en [INFORME.md](INFORME.md).

## Ejecutar

```bash
npm install
npm start          # http://localhost:3000/api
npm test           # 25 pruebas de seguridad
```

La base `eventia.db` se crea con datos semilla. Usuarios de prueba (contraseña `Eventia2026!`):

| Correo | Rol |
|---|---|
| admin@eventia.test | administrador |
| olga@eventia.test | organizador (eventos 1 y 3) |
| oscar@eventia.test | organizador (evento 2) |
| carlos@eventia.test | usuario |
| ana@eventia.test | usuario |

Variables de entorno: `PORT`, `DB_PATH`, `JWT_SECRET` (obligatorio cambiarlo fuera de desarrollo).

## Estructura

- `src/routes/` — endpoints (`auth`, `usuarios`, `eventos`, `inscripciones`)
- `src/middleware/auth.js` — JWT y autorización por rol
- `src/schemas.js` — validación estricta (zod)
- `src/dto.js` — respuestas con lista blanca de campos
- `docs/openapi.yaml` — documentación OpenAPI 3
- `docs/eventia.postman_collection.json` — colección para Postman / Thunder Client
- `evidencias/` — resultados de las pruebas
