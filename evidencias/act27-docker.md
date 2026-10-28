# Actividad 27 — Evidencia de Docker y persistencia

Generado el 2026-10-28 09:37:27 en Docker 29.8.0.

## 1. Contenedores en ejecución

```console
$ docker compose ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
NAME          IMAGE                STATUS                    PORTS
eventia-app   eventia-app          Up 46 seconds (healthy)   0.0.0.0:3005->3005/tcp, [::]:3005->3005/tcp
eventia-db    postgres:17-alpine   Up 52 seconds (healthy)   0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp
```
```console
$ docker volume ls --filter name=eventia
DRIVER    VOLUME NAME
local     eventia_eventia-pgdata
```
```console
$ curl -s http://localhost:3005/api/salud
{"estado":"ok","baseDeDatos":"postgres"}
```

## 2. Registrar información con funcionalidades reales

Se crea una cuenta nueva, Olga publica un evento y la cuenta nueva se inscribe en él.
```console
$ curl -s -X POST http://localhost:3005/api/usuarios -H 'content-type: application/json' -d '{"nombre":"Prueba Persistencia","correo":"persistencia1793201847@correo.com","password":"Persistente2026"}'
{"id":6,"nombre":"Prueba Persistencia","correo":"persistencia1793201847@correo.com"}
```
```json
{"id":5,"titulo":"Evento persistente","descripcion":"Creado antes de reiniciar los contenedores","fecha":"2026-12-15T18:00:00Z","cupo":40,"disponibles":40,"precio":20,"organizadorId":2,"estado":"abierto"}
```
Inscripción de la cuenta nueva en el evento 5:
```json
{"id":1,"eventoId":5,"cantidad":3,"creadaEn":"2026-10-28T15:37:29.763Z"}
```

## 3. Cerrar la aplicación: eliminar los contenedores (el volumen se conserva)

```console
$ docker compose down
 Container eventia-app Stopping 
 Container eventia-app Stopped 
 Container eventia-app Removing 
 Container eventia-app Removed 
 Container eventia-db Stopping 
 Container eventia-db Stopped 
 Container eventia-db Removing 
 Container eventia-db Removed 
 Network eventia_default Removing 
 Network eventia_default Removed 
```
```console
$ docker ps -a --filter name=eventia --format '{{.Names}}'
```
No queda ningún contenedor de Eventia. El volumen sigue existiendo:
```console
$ docker volume ls --filter name=eventia
DRIVER    VOLUME NAME
local     eventia_eventia-pgdata
```

## 4. Volver a levantar Eventia

```console
$ docker compose up -d
 Network eventia_default Creating 
 Network eventia_default Creating 
 Network eventia_default Created 
 Network eventia_default Created 
 Container eventia-db Creating 
 Container eventia-db Created 
 Container eventia-app Creating 
 Container eventia-app Created 
 Container eventia-db Starting 
 Container eventia-db Started 
 Container eventia-db Waiting 
 Container eventia-db Healthy 
 Container eventia-app Starting 
 Container eventia-app Started 
```
```console
$ docker compose ps --format 'table {{.Name}}\t{{.Status}}'
NAME          STATUS
eventia-app   Up 6 seconds (healthy)
eventia-db    Up 11 seconds (healthy)
```

## 5. Consultar los datos registrados

La cuenta creada antes del reinicio sigue pudiendo iniciar sesión:
```json
{"id":6,"nombre":"Prueba Persistencia","correo":"persistencia1793201847@correo.com","rol":"usuario"}
```
Sus inscripciones:
```json
[{"id":1,"eventoId":5,"cantidad":3,"creadaEn":"2026-10-28T15:37:29.763Z"}]
```
El evento, con sus cupos ya descontados:
```json
{"id":5,"titulo":"Evento persistente","descripcion":"Creado antes de reiniciar los contenedores","fecha":"2026-12-15T18:00:00Z","cupo":40,"disponibles":37,"precio":20,"organizadorId":2,"estado":"abierto"}
```
Consulta directa en PostgreSQL:
```console
$ docker exec eventia-db psql -U eventia -d eventia -c "SELECT e.id, e.titulo, e.cupo, e.disponibles, i.cantidad, u.correo FROM eventos e JOIN inscripciones i ON i.evento_id = e.id JOIN usuarios u ON u.id = i.usuario_id WHERE e.id = 5"
 id |       titulo       | cupo | disponibles | cantidad |              correo               
----+--------------------+------+-------------+----------+-----------------------------------
  5 | Evento persistente |   40 |          37 |        3 | persistencia1793201847@correo.com
(1 row)

```

## 6. Resultado

La cuenta, el evento y la inscripción creados en el paso 2 siguen disponibles después de eliminar y volver a crear los contenedores, porque PostgreSQL guarda sus archivos en el volumen `eventia_eventia-pgdata`.
