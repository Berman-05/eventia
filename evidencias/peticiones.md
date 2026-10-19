# Evidencias: ejecución de la colección Eventia

**Resultado: 19/19 peticiones con el código esperado.**

Generado el 2026-10-19T15:30:49.833Z contra una base de datos nueva (datos semilla).

## 0. Sesiones

## Control A - API 3 Crear eventos (validación + rol)

### Válido: organizador crea evento

```http
POST /api/eventos
Authorization: Bearer <token>

{
  "titulo": "Concierto universitario",
  "fecha": "2026-12-20T19:00:00Z",
  "cupo": 150,
  "precio": 75
}
```

Respuesta: **201** (esperado 201) ✅

```json
{
  "id": 4,
  "titulo": "Concierto universitario",
  "descripcion": null,
  "fecha": "2026-12-20T19:00:00Z",
  "cupo": 150,
  "disponibles": 150,
  "precio": 75,
  "organizadorId": 2
}
```

### Inválido: cupo -50 y precio -100

```http
POST /api/eventos
Authorization: Bearer <token>

{
  "titulo": "Concierto universitario",
  "fecha": "2026-12-20T19:00:00Z",
  "cupo": -50,
  "precio": -100
}
```

Respuesta: **400** (esperado 400) ✅

```json
{
  "error": "Datos inválidos",
  "detalles": [
    {
      "campo": "cupo",
      "mensaje": "Too small: expected number to be >0"
    },
    {
      "campo": "precio",
      "mensaje": "Too small: expected number to be >=0"
    }
  ]
}
```

### No autorizado: usuario normal crea evento

```http
POST /api/eventos
Authorization: Bearer <token>

{
  "titulo": "Concierto universitario",
  "fecha": "2026-12-20T19:00:00Z",
  "cupo": 150,
  "precio": 75
}
```

Respuesta: **403** (esperado 403) ✅

```json
{
  "error": "No tiene permiso para realizar esta operación"
}
```

### Sin token

```http
POST /api/eventos

{
  "titulo": "X evento",
  "fecha": "2026-12-20T19:00:00Z",
  "cupo": 1,
  "precio": 0
}
```

Respuesta: **401** (esperado 401) ✅

```json
{
  "error": "Autenticación requerida"
}
```

## Control B - API 4 Modificar eventos (propiedad)

### Válido: Oscar modifica su evento 2

```http
PUT /api/eventos/2
Authorization: Bearer <token>

{
  "precio": 10
}
```

Respuesta: **200** (esperado 200) ✅

```json
{
  "id": 2,
  "titulo": "Taller de seguridad web",
  "descripcion": "OWASP API Top 10",
  "fecha": "2026-11-20T15:00:00Z",
  "cupo": 30,
  "disponibles": 30,
  "precio": 10,
  "organizadorId": 3
}
```

### No autorizado: Olga modifica evento 2 de Oscar

```http
PUT /api/eventos/2
Authorization: Bearer <token>

{
  "precio": 0
}
```

Respuesta: **403** (esperado 403) ✅

```json
{
  "error": "El evento no le pertenece"
}
```

## Control C - API 1 Inscripciones (BOLA)

### Carlos se inscribe en evento 1

```http
POST /api/eventos/1/inscripciones
Authorization: Bearer <token>

{
  "cantidad": 2
}
```

Respuesta: **201** (esperado 201) ✅

```json
{
  "id": 1,
  "eventoId": 1,
  "cantidad": 2,
  "creadaEn": "2026-10-19 15:30:50"
}
```

### Válido: Carlos consulta su inscripción 1

```http
GET /api/inscripciones/1
Authorization: Bearer <token>
```

Respuesta: **200** (esperado 200) ✅

```json
{
  "id": 1,
  "eventoId": 1,
  "cantidad": 2,
  "creadaEn": "2026-10-19 15:30:50"
}
```

### No autorizado: Ana consulta inscripción 1

```http
GET /api/inscripciones/1
Authorization: Bearer <token>
```

Respuesta: **404** (esperado 404) ✅

```json
{
  "error": "Inscripción no encontrada"
}
```

## Otros controles

### API 2: registro con rol administrador

```http
POST /api/usuarios

{
  "nombre": "Ana",
  "correo": "ana@email.com",
  "password": "12345678",
  "rol": "administrador"
}
```

Respuesta: **400** (esperado 400) ✅

```json
{
  "error": "Datos inválidos",
  "detalles": [
    {
      "campo": "rol",
      "mensaje": "Unrecognized key: \"rol\""
    }
  ]
}
```

### API 5: cantidad 500

```http
POST /api/eventos/2/inscripciones
Authorization: Bearer <token>

{
  "cantidad": 500
}
```

Respuesta: **400** (esperado 400) ✅

```json
{
  "error": "Datos inválidos",
  "detalles": [
    {
      "campo": "cantidad",
      "mensaje": "Máximo 4 por usuario"
    }
  ]
}
```

### API 6: Carlos se consulta a sí mismo

```http
GET /api/usuarios/4
Authorization: Bearer <token>
```

Respuesta: **200** (esperado 200) ✅

```json
{
  "id": 4,
  "nombre": "Carlos",
  "correo": "carlos@eventia.test"
}
```

### API 6: Ana consulta a Carlos

```http
GET /api/usuarios/4
Authorization: Bearer <token>
```

Respuesta: **403** (esperado 403) ✅

```json
{
  "error": "No tiene permiso para consultar este usuario"
}
```

### API 7: correo inexistente

```http
POST /api/auth/login

{
  "correo": "noexiste@email.com",
  "password": "x"
}
```

Respuesta: **401** (esperado 401) ✅

```json
{
  "error": "Credenciales inválidas"
}
```

