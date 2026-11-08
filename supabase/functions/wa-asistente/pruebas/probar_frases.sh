#!/usr/bin/env bash
# Corre probar_frases.py contra el ollama del servidor (sin puertos publicados: se usa la IP del contenedor).
# Uso: bash probar_frases.sh [filtro]
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
IP=$(docker inspect supabase-ollama-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
[ -n "$IP" ] || { echo "No encuentro el contenedor supabase-ollama-1" >&2; exit 1; }
exec python3 -I "$AQUI/probar_frases.py" "http://$IP:11434" "${1:-}"
