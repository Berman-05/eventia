#!/usr/bin/env bash
# Demuestra la persistencia de PostgreSQL en el volumen de Docker y escribe la evidencia.
# Uso (con docker compose levantado): bash scripts/demo-persistencia.sh . evidencias/act27-docker.md
set -u
cd "$1"
OUT="$2"
BASE=http://localhost:3005/api
SEMILLA="Eventia2026!"
CORREO="persistencia$(date +%s)@correo.com"

paso() { echo; echo "## $1"; echo; }
cmd() { echo '```console'; echo "\$ $*"; eval "$@" 2>&1 | sed 's/\r$//'; echo '```'; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(eval('o'+process.argv[1]))})" "$1"; }
esperar() { for i in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' eventia-app 2>/dev/null)" = healthy ] && return; node -e "setTimeout(()=>{},2000)"; done; }

{
echo "# Actividad 27 — Evidencia de Docker y persistencia"
echo
echo "Generado el $(date '+%Y-%m-%d %H:%M:%S') en $(docker version --format 'Docker {{.Server.Version}}')."

paso "1. Contenedores en ejecución"
cmd docker compose ps --format "'table {{.Name}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"
cmd docker volume ls --filter name=eventia
cmd curl -s $BASE/salud

paso "2. Registrar información con funcionalidades reales"
echo "Se crea una cuenta nueva, Olga publica un evento y la cuenta nueva se inscribe en él."
cmd "curl -s -X POST $BASE/usuarios -H 'content-type: application/json' -d '{\"nombre\":\"Prueba Persistencia\",\"correo\":\"$CORREO\",\"password\":\"Persistente2026\"}'"
TOKEN_OLGA=$(curl -s -X POST $BASE/auth/login -H 'content-type: application/json' -d "{\"correo\":\"olga@eventia.test\",\"password\":\"$SEMILLA\"}" | json .token)
EVENTO=$(curl -s -X POST $BASE/eventos -H 'content-type: application/json' -H "authorization: Bearer $TOKEN_OLGA" \
  -d '{"titulo":"Evento persistente","descripcion":"Creado antes de reiniciar los contenedores","fecha":"2026-12-15T18:00:00Z","cupo":40,"precio":20}')
echo '```json'; echo "$EVENTO"; echo '```'
ID=$(echo "$EVENTO" | json .id)
TOKEN_NUEVO=$(curl -s -X POST $BASE/auth/login -H 'content-type: application/json' -d "{\"correo\":\"$CORREO\",\"password\":\"Persistente2026\"}" | json .token)
echo "Inscripción de la cuenta nueva en el evento $ID:"
echo '```json'; curl -s -X POST $BASE/eventos/$ID/inscripciones -H 'content-type: application/json' -H "authorization: Bearer $TOKEN_NUEVO" -d '{"cantidad":3}'; echo; echo '```'

paso "3. Cerrar la aplicación: eliminar los contenedores (el volumen se conserva)"
cmd docker compose down
cmd docker ps -a --filter name=eventia --format "'{{.Names}}'"
echo "No queda ningún contenedor de Eventia. El volumen sigue existiendo:"
cmd docker volume ls --filter name=eventia

paso "4. Volver a levantar Eventia"
cmd docker compose up -d
esperar
cmd docker compose ps --format "'table {{.Name}}\t{{.Status}}'"

paso "5. Consultar los datos registrados"
echo "La cuenta creada antes del reinicio sigue pudiendo iniciar sesión:"
TOKEN_NUEVO=$(curl -s -X POST $BASE/auth/login -H 'content-type: application/json' -d "{\"correo\":\"$CORREO\",\"password\":\"Persistente2026\"}" | json .token)
echo '```json'; curl -s $BASE/auth/me -H "authorization: Bearer $TOKEN_NUEVO"; echo; echo '```'
echo "Sus inscripciones:"
echo '```json'; curl -s $BASE/inscripciones/mias -H "authorization: Bearer $TOKEN_NUEVO"; echo; echo '```'
echo "El evento, con sus cupos ya descontados:"
echo '```json'; curl -s $BASE/eventos/$ID; echo; echo '```'
echo "Consulta directa en PostgreSQL:"
cmd "docker exec eventia-db psql -U eventia -d eventia -c \"SELECT e.id, e.titulo, e.cupo, e.disponibles, i.cantidad, u.correo FROM eventos e JOIN inscripciones i ON i.evento_id = e.id JOIN usuarios u ON u.id = i.usuario_id WHERE e.id = $ID\""

paso "6. Resultado"
echo "La cuenta, el evento y la inscripción creados en el paso 2 siguen disponibles después de eliminar y volver a crear los contenedores, porque PostgreSQL guarda sus archivos en el volumen \`eventia_eventia-pgdata\`."
} > "$OUT"
echo "Evidencia escrita en $OUT"
