# Actividad 24 — Evidencias de las pruebas

Generado el 2026-10-19T15:43:47.612Z ejecutando la colección `docs/eventia-act24.postman_collection.json` contra una base nueva.

**Resultado: 12/12 pruebas con el código esperado.**

Preparación: login de Carlos, Olga y Ana; Carlos se inscribe en el evento 1; se abre y se cierra una segunda sesión de Carlos (`token_logout`).

## Resumen

| # | Operación realizada | Usuario / rol | Resultado esperado | Código HTTP obtenido | Resultado real |
|---|---|---|---|---|---|
| 1 | Acceder a una ruta privada sin autenticación | Visitante (sin token) | 401 — Rechazar: autenticación requerida | **401** | ✅ Autenticación requerida (`token_ausente`) |
| 2 | Acceder a una ruta privada con autenticación válida | Carlos (usuario registrado) | 200 — Devolver los datos del usuario autenticado | **200** | ✅ Operación completada |
| 2b | Consultar mis propias inscripciones | Carlos (usuario registrado) | 200 — Devolver solo las inscripciones de Carlos | **200** | ✅ Operación completada |
| 3 | Modificar un evento propio (evento 1) | Olga (organizadora, dueña del evento 1) | 200 — Evento actualizado | **200** | ✅ Operación completada |
| 4 | Modificar el evento 2, que pertenece a Oscar | Olga (organizadora) | 403 — Rechazar: el evento no le pertenece | **403** | ✅ El evento no le pertenece |
| 5 | Consultar las inscripciones privadas de Carlos | Ana (usuario registrado) | 403 — Rechazar: solo puede ver las propias | **403** | ✅ Solo puede consultar sus propias inscripciones |
| 5b | Consultar la inscripción 1 de Carlos por id | Ana (usuario registrado) | 404 — Rechazar sin revelar que existe | **404** | ✅ Inscripción no encontrada |
| 6a | Usar un token vencido | Carlos (token expirado) | 401 — Rechazar: sesión expirada | **401** | ✅ La sesión ha expirado. Inicie sesión nuevamente (`token_expirado`) |
| 6b | Usar un token inválido (alterado) | Desconocido | 401 — Rechazar: token inválido | **401** | ✅ Token inválido (`token_invalido`) |
| 6c | Usar un token después de cerrar sesión | Carlos (sesión cerrada) | 401 — Rechazar: sesión cerrada | **401** | ✅ La sesión fue cerrada. Inicie sesión nuevamente (`token_revocado`) |
| C | Situación C: cambiar rol con sesión vencida | Administrador (token expirado) | 401 — Rechazar y no ejecutar la operación | **401** | ✅ La sesión ha expirado. Inicie sesión nuevamente (`token_expirado`) |
| D | Situación D: modificar evento propio cerrado (evento 4) | Olga (dueña del evento 4) | 409 — Rechazar: el evento está cerrado | **409** | ✅ El evento está cerrado y no admite cambios (`evento_cerrado`) |

## Detalle de cada petición

### Prueba 1: Acceder a una ruta privada sin autenticación

Usuario: Visitante (sin token)

```http
GET /api/auth/me
```

Respuesta **401 Unauthorized** · `WWW-Authenticate: Bearer realm="eventia"`

```json
{
  "error": "Autenticación requerida",
  "codigo": "token_ausente"
}
```

### Prueba 2: Acceder a una ruta privada con autenticación válida

Usuario: Carlos (usuario registrado)

```http
GET /api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c…
```

Respuesta **200 OK**

```json
{
  "id": 4,
  "nombre": "Carlos",
  "correo": "carlos@eventia.test",
  "rol": "usuario"
}
```

### Prueba 2b: Consultar mis propias inscripciones

Usuario: Carlos (usuario registrado)

```http
GET /api/usuarios/4/inscripciones
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c…
```

Respuesta **200 OK**

```json
[
  {
    "id": 1,
    "eventoId": 1,
    "cantidad": 2,
    "creadaEn": "2026-10-19 15:43:47"
  }
]
```

### Prueba 3: Modificar un evento propio (evento 1)

Usuario: Olga (organizadora, dueña del evento 1)

```http
PUT /api/eventos/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c…

{
  "precio": 80
}
```

Respuesta **200 OK**

```json
{
  "id": 1,
  "titulo": "Concierto universitario",
  "descripcion": "Bandas locales",
  "fecha": "2026-12-05T19:00:00Z",
  "cupo": 150,
  "disponibles": 148,
  "precio": 80,
  "organizadorId": 2,
  "estado": "abierto"
}
```

### Prueba 4: Modificar el evento 2, que pertenece a Oscar

Usuario: Olga (organizadora)

```http
PUT /api/eventos/2
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c…

{
  "precio": 999
}
```

Respuesta **403 Forbidden**

```json
{
  "error": "El evento no le pertenece"
}
```

### Prueba 5: Consultar las inscripciones privadas de Carlos

Usuario: Ana (usuario registrado)

```http
GET /api/usuarios/4/inscripciones
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c…
```

Respuesta **403 Forbidden**

```json
{
  "error": "Solo puede consultar sus propias inscripciones"
}
```

### Prueba 5b: Consultar la inscripción 1 de Carlos por id

Usuario: Ana (usuario registrado)

```http
GET /api/inscripciones/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c…
```

Respuesta **404 Not Found**

```json
{
  "error": "Inscripción no encontrada"
}
```

### Prueba 6a: Usar un token vencido

Usuario: Carlos (token expirado)

```http
GET /api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c…
```

Respuesta **401 Unauthorized** · `WWW-Authenticate: Bearer realm="eventia", error="invalid_token"`

```json
{
  "error": "La sesión ha expirado. Inicie sesión nuevamente",
  "codigo": "token_expirado"
}
```

### Prueba 6b: Usar un token inválido (alterado)

Usuario: Desconocido

```http
GET /api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJz…
```

Respuesta **401 Unauthorized** · `WWW-Authenticate: Bearer realm="eventia", error="invalid_token"`

```json
{
  "error": "Token inválido",
  "codigo": "token_invalido"
}
```

### Prueba 6c: Usar un token después de cerrar sesión

Usuario: Carlos (sesión cerrada)

```http
GET /api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c…
```

Respuesta **401 Unauthorized** · `WWW-Authenticate: Bearer realm="eventia", error="invalid_token"`

```json
{
  "error": "La sesión fue cerrada. Inicie sesión nuevamente",
  "codigo": "token_revocado"
}
```

### Prueba C: Situación C: cambiar rol con sesión vencida

Usuario: Administrador (token expirado)

```http
PATCH /api/usuarios/5/rol
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c…

{
  "rol": "organizador"
}
```

Respuesta **401 Unauthorized** · `WWW-Authenticate: Bearer realm="eventia", error="invalid_token"`

```json
{
  "error": "La sesión ha expirado. Inicie sesión nuevamente",
  "codigo": "token_expirado"
}
```

### Prueba D: Situación D: modificar evento propio cerrado (evento 4)

Usuario: Olga (dueña del evento 4)

```http
PUT /api/eventos/4
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c…

{
  "precio": 10
}
```

Respuesta **409 Conflict**

```json
{
  "error": "El evento está cerrado y no admite cambios",
  "codigo": "evento_cerrado"
}
```

