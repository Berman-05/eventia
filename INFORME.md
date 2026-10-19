# Eventia: de una API insegura a un diseño seguro

**Universidad Rafael Landívar** — Campus San Alberto Hurtado, S.J. de Quetzaltenango
**Curso:** Programación Web — **Docente:** Ing. Manuel Rojas
**Actividad 23**

Nombre: ______________________________ Carné: ______________

Repositorio: https://github.com/Berman-05/eventia

> Referencia: OWASP API Security Top 10 – 2023 (API1 a API10).

---

## 1) Auditoría de las APIs existentes

| API | Problema identificado | Consecuencias | Riesgo OWASP API (principal / otros) | Solución propuesta |
|---|---|---|---|---|
| **API 1** `GET /api/inscripciones/125` | Solo verifica que la inscripción exista; no comprueba que pertenezca a quien la solicita. Los IDs son secuenciales. | Cualquier usuario autenticado puede recorrer `/inscripciones/1, 2, 3…` y obtener nombre, correo y eventos de todas las personas inscritas (fuga de datos personales, perfilamiento, phishing dirigido). | **API1:2023 Broken Object Level Authorization (BOLA)**. Secundario: API3:2023 (expone correo de terceros). | Autorización a nivel de objeto: solo el dueño, el organizador **de ese evento** o un administrador. A los demás responder 404 para no revelar la existencia del recurso. Devolver un DTO mínimo. |
| **API 2** `POST /api/usuarios` | Guarda todos los campos recibidos, incluido `rol`, que el cliente controla (asignación masiva). Acepta la contraseña `123456`. | Cualquiera se registra como `administrador` y obtiene control total de la plataforma (escalamiento de privilegios). Contraseñas débiles facilitan el robo de cuentas. | **API3:2023 Broken Object Property Level Authorization** (mass assignment). Secundarios: API5:2023 (acceso a funciones de administrador) y API2:2023 (política de contraseñas débil). | Lista blanca de campos (`nombre`, `correo`, `password`, `telefono`); rechazar cualquier otra propiedad con 400. El rol lo asigna el servidor (`usuario`); solo un administrador puede cambiarlo por un endpoint separado. Contraseña de 8+ caracteres, almacenada con bcrypt. |
| **API 3** `POST /api/eventos` | No valida datos (acepta `cupo: -50`, `precio: -100`) y cualquier usuario autenticado puede crear eventos. | Eventos con datos absurdos que rompen el cálculo de cupos y cobros (precio negativo = devolver dinero), errores en reportes; usuarios comunes publican eventos falsos o spam. | **API5:2023 Broken Function Level Authorization** (cualquier rol ejecuta una función de organizador). Secundario: falta de validación de entrada → integridad de la lógica de negocio (API6:2023 / A04 Insecure Design). | Exigir rol `organizador` o `administrador`. Validar esquema estricto: título no vacío, cupo entero positivo con máximo, precio ≥ 0, fecha futura, sin propiedades extra. El `organizadorId` se toma del token, nunca del cuerpo. |
| **API 4** `PUT /api/eventos/25` | Verifica el rol de organizador pero no que el evento le pertenezca. | Un organizador puede cambiar precio, fecha, cupo o título de eventos de la competencia, sabotearlos o redirigir a los asistentes. | **API1:2023 BOLA** (tener el rol no autoriza sobre cualquier objeto). | Además del rol, comprobar `evento.organizador_id === usuario.id` (o rol administrador). Validar los datos igual que en API 3 y no permitir reducir el cupo por debajo de los inscritos. |
| **API 5** `POST /api/eventos/25/inscripciones` | Sin límite por usuario (`cantidad: 500`) y control de cupos no atómico (leer → comprobar → escribir). | Una persona o bot acapara todos los cupos (reventa, denegación del servicio al resto). Con peticiones simultáneas se vende más cupo del existente (sobreventa por condición de carrera). | **API6:2023 Unrestricted Access to Sensitive Business Flows**. Secundario: API4:2023 Unrestricted Resource Consumption. | Máximo de lugares por usuario (4) y una inscripción por evento. Descontar cupos con una operación atómica (`UPDATE … SET disponibles = disponibles - n WHERE id = ? AND disponibles >= n`) dentro de una transacción; si no afecta filas → 409. Opcional: rate limiting y CAPTCHA en eventos de alta demanda. |
| **API 6** `GET /api/usuarios/35` | Devuelve la fila completa: teléfono, `passwordHash` y rol, aunque el frontend solo usa nombre y correo. Tampoco se indica control de propiedad. | Exposición de hashes que permite ataques de fuerza bruta offline, de datos personales (teléfono) y de información útil para escalar privilegios. | **API3:2023 Broken Object Property Level Authorization** (exposición excesiva de datos). Secundario: API1:2023 si cualquiera puede consultar cualquier ID. | Responder con un DTO de lista blanca (`id`, `nombre`, `correo`). Nunca serializar el modelo de BD. Solo el propio usuario o un administrador pueden consultar el recurso. |
| **API 7** `POST /api/auth/login` | Intentos ilimitados y mensajes distintos para "correo no registrado" y "contraseña incorrecta". | Enumeración de cuentas válidas y ataques de fuerza bruta / credential stuffing sin freno → robo de cuentas. | **API2:2023 Broken Authentication**. Secundario: API4:2023 (sin límite de peticiones). | Mensaje genérico "Credenciales inválidas" con el mismo código (401) y tiempo de respuesta similar (comparar contra un hash ficticio). Rate limiting por IP + correo (5 intentos / 15 min → 429), bloqueo temporal y registro de intentos. |

---

## 2) Rediseño de las siete operaciones

Controles comunes a todos los endpoints autenticados: token JWT `Bearer` (HS256, expira en 1 h) verificado con algoritmo fijo; el usuario y su rol se cargan desde la BD en cada petición; cuerpos JSON ≤ 10 KB; esquemas estrictos (propiedades no declaradas → 400); IDs de ruta enteros positivos; errores sin trazas internas.

### API 1 — Consultar una inscripción
- **Endpoint:** `GET /api/inscripciones/{id}`
- **Función:** devuelve una inscripción concreta.
- **Acceso:** usuario autenticado que sea dueño de la inscripción, organizador del evento al que pertenece, o administrador.
- **Datos recibidos:** `id` en la ruta.
- **Validaciones:** `id` entero positivo.
- **Controles de autorización:** validar token; cargar inscripción junto con `evento.organizador_id`; permitir solo si `inscripcion.usuario_id == usuario.id`, `evento.organizador_id == usuario.id` o rol administrador. Si no, responder igual que si no existiera.
- **Respuesta esperada:** `200 OK` → `{ id, eventoId, cantidad, creadaEn }` (el organizador/admin recibe además `participante: { id, nombre, correo }`).
- **Errores:** `400` id inválido · `401` sin token / token inválido · `404` no existe o no tiene acceso.
- Complemento: `GET /api/inscripciones/mias` lista solo las del usuario del token (sin parámetro de usuario).

### API 2 — Registro de usuarios
- **Endpoint:** `POST /api/usuarios`
- **Función:** crear una cuenta de participante.
- **Acceso:** público (visitante).
- **Datos recibidos:** `nombre`, `correo`, `password`, `telefono` (opcional).
- **Validaciones:** nombre 2–80 caracteres; correo con formato válido (normalizado a minúsculas); contraseña 8–72 caracteres; teléfono de 8 dígitos; **rechazar `rol` y cualquier otra propiedad**; correo único.
- **Controles de autorización:** el rol se fija en el servidor como `usuario`. El cambio de rol se hace solo con `PATCH /api/usuarios/{id}/rol` (administrador).
- **Respuesta esperada:** `201 Created` → `{ id, nombre, correo }` (sin hash ni rol).
- **Errores:** `400` datos inválidos o propiedad no permitida · `409` correo ya registrado · `429` (recomendado) demasiados registros desde la misma IP.

### API 3 — Creación de eventos
- **Endpoint:** `POST /api/eventos`
- **Función:** publicar un evento.
- **Acceso:** organizador o administrador autenticado.
- **Datos recibidos:** `titulo`, `descripcion` (opcional), `fecha`, `cupo`, `precio`.
- **Validaciones:** título 3–120 caracteres no vacío; fecha ISO 8601 futura; cupo entero 1–10 000; precio número 0–100 000; rechazar propiedades no permitidas (`organizador_id`, `disponibles`, …).
- **Controles de autorización:** validar token; verificar rol `organizador`/`administrador`; `organizador_id` = usuario del token; `disponibles` = `cupo` calculado en el servidor.
- **Respuesta esperada:** `201 Created` → evento creado.
- **Errores:** `400` datos inválidos · `401` no autenticado · `403` rol sin permiso.

### API 4 — Modificación de eventos
- **Endpoint:** `PUT /api/eventos/{id}`
- **Función:** actualizar los datos de un evento propio.
- **Acceso:** organizador **dueño del evento** o administrador.
- **Datos recibidos:** cualquiera de `titulo`, `descripcion`, `fecha`, `cupo`, `precio` (al menos uno).
- **Validaciones:** mismas reglas que API 3; el nuevo cupo no puede ser menor que los lugares ya inscritos; `disponibles` se recalcula en el servidor.
- **Controles de autorización:** validar token; verificar rol; cargar el evento y comprobar `evento.organizador_id == usuario.id` (o administrador).
- **Respuesta esperada:** `200 OK` → evento actualizado.
- **Errores:** `400` datos inválidos · `401` · `403` el evento no le pertenece · `404` no existe · `409` cupo menor a los inscritos.

### API 5 — Inscripción a un evento
- **Endpoint:** `POST /api/eventos/{id}/inscripciones`
- **Función:** reservar lugares en un evento.
- **Acceso:** usuario registrado u organizador (este último no en su propio evento).
- **Datos recibidos:** `cantidad`.
- **Validaciones:** `cantidad` entero 1–4; una sola inscripción por usuario y evento (restricción `UNIQUE` en BD); el evento existe.
- **Controles de autorización / negocio:** validar token y rol; el `usuario_id` sale del token; transacción `BEGIN IMMEDIATE` + `UPDATE eventos SET disponibles = disponibles - :n WHERE id = :id AND disponibles >= :n`; si no se actualiza ninguna fila no hay cupo. Recomendado: rate limiting por usuario y CAPTCHA/cola en eventos de alta demanda.
- **Respuesta esperada:** `201 Created` → `{ id, eventoId, cantidad, creadaEn }`.
- **Errores:** `400` cantidad inválida · `401` · `403` rol no permitido o evento propio · `404` evento inexistente · `409` sin cupos o ya inscrito · `429` demasiadas solicitudes.

### API 6 — Consulta de usuarios
- **Endpoint:** `GET /api/usuarios/{id}` (y `GET /api/usuarios` solo administrador)
- **Función:** obtener los datos de perfil necesarios para el frontend.
- **Acceso:** el propio usuario o un administrador.
- **Datos recibidos:** `id` en la ruta.
- **Validaciones:** `id` entero positivo.
- **Controles de autorización:** validar token; `usuario.id == id` o rol administrador; respuesta construida con DTO de lista blanca.
- **Respuesta esperada:** `200 OK` → `{ id, nombre, correo }` (el administrador recibe además `rol`). Nunca `passwordHash`.
- **Errores:** `400` · `401` · `403` consultar a otro usuario · `404` no existe.

### API 7 — Inicio de sesión
- **Endpoint:** `POST /api/auth/login`
- **Función:** autenticar y emitir un JWT.
- **Acceso:** público.
- **Datos recibidos:** `correo`, `password`.
- **Validaciones:** correo con formato válido; contraseña no vacía; sin propiedades extra.
- **Controles de seguridad:** máximo 5 intentos fallidos por IP + correo cada 15 minutos; mensaje y código idénticos para correo inexistente o contraseña incorrecta; comparación bcrypt también contra un hash ficticio para igualar tiempos; token de corta duración; HTTPS obligatorio en producción.
- **Respuesta esperada:** `200 OK` → `{ token, usuario: { id, nombre, correo } }`.
- **Errores:** `400` datos mal formados · `401` "Credenciales inválidas" · `429` demasiados intentos.

---

## 3) Matriz de roles y permisos

✅ permitido · ❌ denegado · ⚠️ permitido solo con la condición indicada

| Operación | Visitante | Usuario registrado | Organizador | Administrador |
|---|---|---|---|---|
| 1. Consultar eventos públicos | ✅ | ✅ | ✅ | ✅ |
| 2. Crear eventos | ❌ (401) | ❌ (403) | ✅ queda como dueño del evento | ✅ |
| 3. Modificar eventos propios | ❌ | ❌ | ⚠️ solo si `evento.organizador_id = su id` | ✅ |
| 4. Modificar eventos ajenos | ❌ | ❌ | ❌ (403) aunque tenga el rol | ⚠️ sí, como moderación (debe quedar registrado en bitácora) |
| 5. Inscribirse en eventos | ❌ (401) | ⚠️ máx. 4 lugares, una inscripción por evento, sujeto a cupo | ⚠️ igual que usuario, pero no en sus propios eventos | ❌ no es su función |
| 6. Consultar inscripciones propias | ❌ | ⚠️ solo las suyas (`usuario_id` del token) | ⚠️ solo las suyas | ✅ (cualquiera) |
| 7. Consultar inscripciones de un evento como organizador | ❌ | ❌ | ⚠️ solo de eventos que le pertenecen | ✅ |
| 8. Administrar usuarios (listar, cambiar rol) | ❌ | ❌ (solo puede ver su propio perfil) | ❌ | ✅ |

**Rol vs. autorización sobre el recurso.** El rol responde a *"¿puede este tipo de usuario ejecutar esta función?"* (autorización por función, API5:2023). Pero tener el rol `organizador` no basta para operar el evento 25: además hay que responder *"¿este objeto le pertenece?"* (autorización por objeto, API1:2023). Por eso las filas 3, 4, 6 y 7 tienen condiciones: el mismo rol recibe ✅ o ❌ según quién es el dueño del recurso. En el código se ve en dos pasos separados: `requiereRol('organizador', 'administrador')` y luego `verificarPropietario(evento, usuario)`.

---

## 4) Documentación OpenAPI

Archivo completo: [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.0.3). Documenta 8 operaciones corregidas: `POST /auth/login`, `POST /usuarios`, `GET /usuarios/{id}`, `GET /eventos`, `POST /eventos`, `PUT /eventos/{id}`, `POST /eventos/{id}/inscripciones` y `GET /inscripciones/{id}`. Se puede visualizar pegándolo en <https://editor.swagger.io>.

Cada operación incluye método y ruta, descripción, cuerpo/parámetros con sus restricciones (`minimum`, `maxLength`, `format`, `additionalProperties: false`), esquema de respuesta, códigos HTTP y requisito `bearerAuth` (o `security: []` cuando es pública). Las restricciones coinciden con los esquemas zod de [`src/schemas.js`](src/schemas.js).

Extracto (tres endpoints):

```yaml
  /eventos:
    post:
      summary: Crear evento (API 3)
      description: Solo organizador o administrador. El organizador del evento es el usuario autenticado.
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/EventoEntrada' } } }
      responses:
        '201': { description: Evento creado., content: { application/json: { schema: { $ref: '#/components/schemas/Evento' } } } }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }

  /eventos/{id}:
    put:
      summary: Modificar evento propio (API 4)
      description: Rol organizador y además dueño del evento (o administrador).
      security: [{ bearerAuth: [] }]
      parameters: [{ $ref: '#/components/parameters/EventoId' }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/EventoModificacion' } } }
      responses:
        '200': { description: Evento actualizado. }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }

  /auth/login:
    post:
      summary: Iniciar sesión (API 7)
      description: Mismo mensaje para correo inexistente o contraseña incorrecta. Máximo 5 intentos fallidos / 15 min.
      security: []
      responses:
        '200': { description: Autenticación correcta (devuelve token). }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { description: Credenciales inválidas. }
        '429': { description: Demasiados intentos fallidos. }

components:
  schemas:
    EventoEntrada:
      type: object
      additionalProperties: false
      required: [titulo, fecha, cupo, precio]
      properties:
        titulo: { type: string, minLength: 3, maxLength: 120 }
        fecha:  { type: string, format: date-time, description: Debe ser una fecha futura }
        cupo:   { type: integer, minimum: 1, maximum: 10000 }
        precio: { type: number, minimum: 0, maximum: 100000 }
```

---

## 5) Controles implementados en Eventia

**Stack:** Node.js 24 + Express 5, SQLite (`node:sqlite`), JWT (`jsonwebtoken`), `bcryptjs`, `zod` para validación y `express-rate-limit`.
Se corrigieron las siete APIs; a continuación se detallan tres controles. Las pruebas se ejecutaron con la colección [`docs/eventia.postman_collection.json`](docs/eventia.postman_collection.json) (importable en Postman o Thunder Client) y con pruebas automatizadas (`npm test`).

Usuarios de prueba (contraseña `Eventia2026!`): `admin@`, `olga@` (organizadora, dueña de los eventos 1 y 3), `oscar@` (organizador, dueño del evento 2), `carlos@` y `ana@` (usuarios) — todos `@eventia.test`.

### Control A — Validación de datos y autorización por función en `POST /api/eventos` (API 3)

1. **Comportamiento anterior:** el backend aceptaba `{ "titulo": "Concierto universitario", "cupo": -50, "precio": -100 }` y lo guardaba; cualquier usuario autenticado podía crear eventos.
2. **Problema:** API5:2023 BFLA + ausencia de validación de entrada (integridad del negocio).
3. **Modificación realizada:**
   - [`src/schemas.js`](src/schemas.js): esquema `crearEvento` estricto (`cupo` entero positivo ≤ 10 000, `precio` ≥ 0, fecha futura, título 3–120, propiedades extra rechazadas).
   - [`src/routes/eventos.js`](src/routes/eventos.js): `router.post('/', auth, requiereRol('organizador', 'administrador'), validar(schemas.crearEvento), …)`; `organizador_id` se toma de `req.usuario.id`.
   - Defensa en profundidad en la BD: `CHECK (cupo > 0)`, `CHECK (precio >= 0)` en [`src/db.js`](src/db.js).
4. **Prueba con datos válidos:** Olga (organizadora) envía `cupo: 150, precio: 75` → **201 Created**, `organizadorId: 2`, `disponibles: 150`.
5. **Prueba con datos inválidos / acceso no autorizado:**
   - Olga envía `cupo: -50, precio: -100` → **400** `{"error":"Datos inválidos","detalles":[{"campo":"cupo",…},{"campo":"precio",…}]}`.
   - Carlos (usuario) envía un evento válido → **403** "No tiene permiso para realizar esta operación".
   - Sin token → **401**.
   - Olga envía `organizador_id: 3` para suplantar a otro → **400** (propiedad no permitida).
6. **Resultado:** el evento inválido ya no se registra y solo los organizadores pueden publicar. ✅

### Control B — Autorización a nivel de objeto en `PUT /api/eventos/{id}` (API 4)

1. **Comportamiento anterior:** bastaba con tener rol de organizador; Olga podía modificar el evento 2 de Oscar.
2. **Problema:** API1:2023 BOLA.
3. **Modificación realizada:** en [`src/routes/eventos.js`](src/routes/eventos.js) se añadió `verificarPropietario(evento, req.usuario)`, que lanza 403 si `evento.organizador_id !== usuario.id` y el usuario no es administrador. También se valida el cuerpo (`modificarEvento`) y se impide bajar el cupo por debajo de lo inscrito (409).
4. **Prueba con datos válidos:** Oscar → `PUT /api/eventos/2` `{ "precio": 10 }` → **200 OK**, precio actualizado.
5. **Prueba de acceso no autorizado:** Olga → `PUT /api/eventos/2` `{ "precio": 0 }` → **403** "El evento no le pertenece". Olga → `PUT /api/eventos/1` `{ "cupo": 1 }` con 2 lugares ya inscritos → **409**.
6. **Resultado:** cada organizador solo modifica sus propios eventos. ✅

### Control C — Autorización a nivel de objeto en `GET /api/inscripciones/{id}` (API 1)

1. **Comportamiento anterior:** cualquier usuario autenticado obtenía la inscripción 125 de Carlos con su nombre y correo.
2. **Problema:** API1:2023 BOLA + exposición de datos.
3. **Modificación realizada:** [`src/routes/inscripciones.js`](src/routes/inscripciones.js) consulta la inscripción junto con el organizador del evento y solo responde si el solicitante es el dueño, el organizador de ese evento o administrador; en otro caso devuelve 404.
4. **Prueba válida:** Carlos → `GET /api/inscripciones/1` → **200**.
5. **Prueba no autorizada:** Ana → `GET /api/inscripciones/1` → **404**; Oscar (organizador de otro evento) → **404**; sin token → **401**.
6. **Resultado:** ya no es posible enumerar inscripciones ajenas. ✅

### Otros controles implementados y probados

| API | Prueba inválida | Resultado |
|---|---|---|
| 2 | Registro con `"rol": "administrador"` | 400, la cuenta no se crea |
| 5 | `cantidad: 500` | 400 (máximo 4) |
| 5 | 10 inscripciones simultáneas en un evento con 3 cupos | exactamente 3 × 201 y 7 × 409; `disponibles = 0` |
| 6 | Carlos consulta su perfil | 200 con solo `{ id, nombre, correo }` |
| 6 | Ana consulta el perfil de Carlos | 403 |
| 7 | Correo inexistente vs. contraseña incorrecta | ambos 401 "Credenciales inválidas" |
| 7 | 6 intentos fallidos seguidos | 401 ×5 y luego 429 |

**Evidencias:**
- [`evidencias/peticiones.md`](evidencias/peticiones.md): cada petición de la colección con su respuesta real (19/19 con el código esperado).
- [`evidencias/resultado-pruebas.txt`](evidencias/resultado-pruebas.txt): salida de `npm test` — 25 pruebas, 25 aprobadas.
- Para la entrega se recomienda agregar capturas de Postman/Thunder Client ejecutando la colección.

---

## Preguntas finales

**1. ¿Cuál de las siete APIs representa el mayor riesgo para Eventia?**
La **API 2 (registro con rol controlado por el cliente)**. Las demás exponen o alteran *algunos* datos; esta permite que cualquier visitante, sin credenciales previas ni conocimientos técnicos, se cree una cuenta de `administrador` con una sola petición. A partir de ahí tiene acceso a todas las funciones: leer todas las inscripciones y usuarios, modificar o eliminar cualquier evento y cambiar roles, es decir, la suma del impacto de las otras seis APIs. Su explotación es trivial y el impacto es total (confidencialidad, integridad y disponibilidad). Le siguen la API 1 y la API 6 por la exposición masiva de datos personales.

**2. ¿Por qué utilizar JWT no garantiza que una API esté correctamente protegida?**
Un JWT solo resuelve la **autenticación**: prueba *quién* hace la petición. No dice *qué* puede hacer ni *sobre qué recursos*. Las APIs 1, 4 y 6 de Eventia podían tener JWT y seguir siendo vulnerables, porque el problema era no comprobar la propiedad del objeto. Además, el JWT mal implementado introduce sus propios riesgos: aceptar `alg: none` o no fijar el algoritmo, secretos débiles, tokens sin expiración, guardar el rol en el token y confiar en él aunque haya cambiado, o no poder revocarlos. La autorización y la validación deben implementarse en cada endpoint aparte del token.

**3. ¿Qué diferencia existe entre validar los datos recibidos y autorizar una operación?**
**Validar** comprueba que los datos sean correctos y coherentes (*¿es el cupo un entero positivo?, ¿hay propiedades no permitidas?*); es independiente de quién envía la petición. **Autorizar** comprueba que el solicitante tiene permiso para ejecutar esa acción sobre ese recurso (*¿es organizador?, ¿el evento 25 es suyo?*). Una petición puede tener datos perfectamente válidos y no estar autorizada (Olga modificando el evento de Oscar con un precio correcto), o estar autorizada y tener datos inválidos (Olga creando su evento con cupo −50). Se necesitan ambas, y responden con códigos distintos: 400 para validación, 401/403 para autorización.

**4. ¿Por qué documentar la autenticación en OpenAPI no significa que la seguridad ya esté implementada?**
OpenAPI es una **descripción** del contrato, no código que se ejecute. Declarar `security: [bearerAuth]`, `minimum: 0` o `additionalProperties: false` no hace que el servidor rechace nada; si el backend no aplica esas reglas, la documentación solo describe una intención (e incluso puede dar una falsa sensación de seguridad). Además, OpenAPI no expresa bien la autorización por objeto ("solo el dueño"), que queda en texto. La documentación sirve para diseñar, comunicar y generar pruebas o validadores, pero la seguridad se verifica probando el comportamiento real, como en las pruebas de la Fase 5.

**5. ¿Qué controles deberían mantenerse cuando Eventia evolucione y use servicios independientes?**
- **Autenticación centralizada** (proveedor de identidad / OAuth2-OIDC) y validación del token en el API Gateway **y** en cada servicio (*zero trust*: no confiar en una petición solo porque viene de la red interna).
- **Autorización por objeto en cada servicio dueño de los datos** (el servicio de Inscripciones sigue verificando que la inscripción pertenezca al usuario); el gateway solo puede comprobar roles de forma gruesa.
- **Validación estricta de entrada en cada servicio** y también de las respuestas que consume de otros servicios o terceros (API10:2023).
- **DTOs mínimos** por servicio, sin exponer modelos internos.
- **Rate limiting y cuotas** en el gateway y en servicios críticos (login, inscripciones).
- **Operaciones atómicas e idempotentes** para cupos y pagos (claves de idempotencia, reintentos seguros con mensajería).
- **Comunicación servicio-a-servicio autenticada** (mTLS o tokens de servicio con mínimo privilegio) y TLS en todo el tráfico.
- **Gestión de secretos** fuera del código, **inventario de APIs y versiones** (API9:2023), registro y monitoreo centralizados de eventos de seguridad, y pruebas de seguridad automatizadas en el pipeline.
