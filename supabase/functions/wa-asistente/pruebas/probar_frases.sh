#!/usr/bin/env bash
# Corre probar_frases.py contra el ollama del servidor (sin puertos publicados: se usa la IP del contenedor).
# Uso: bash probar_frases.sh [--con-aprendidos] [filtro]
#   --con-aprendidos  suma los atajos aprendidos y las frases reales que aprobó Santiago (plan 44).
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
IP=$(docker inspect supabase-ollama-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
[ -n "$IP" ] || { echo "No encuentro el contenedor supabase-ollama-1" >&2; exit 1; }
if [ "${1:-}" = "--con-aprendidos" ]; then
  shift
  APRENDIDOS=$(mktemp)
  trap 'rm -f "$APRENDIDOS"' EXIT
  docker exec -i supabase-db psql -U postgres -tA -c "select json_build_object(
    'atajos', coalesce((select json_agg(json_build_object('patron', patron, 'consulta', consulta, 'argumentos', argumentos) order by id)
                          from wa_atajos_aprendidos where activo), '[]'),
    'frases', coalesce((select json_agg(json_build_object('frase', frase, 'consulta', consulta) order by id)
                          from wa_frases_reales where activo), '[]'))" > "$APRENDIDOS"
  export APRENDIDOS
fi
# Sin `exec`: así el trap borra el archivo temporal al terminar.
python3 -I "$AQUI/probar_frases.py" "http://$IP:11434" "${1:-}"
