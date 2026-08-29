#!/usr/bin/env bash
# enviar-precios.sh — envía la lista de precios a DisT-At. Linux / macOS.
#
# Mismo contrato que `enviar-precios.ps1`: manda el archivo, guarda la respuesta en un registro
# diario y reintenta sólo los errores de RED.
#
# A mano:
#   ./enviar-precios.sh /srv/erp/export/lista-precios.txt
#
# En cron (todos los días a las 06:00, de lunes a sábado):
#   0 6 * * 1-6 /opt/distat/enviar-precios.sh /srv/erp/export/lista-precios.txt
#
# 🔴 EL TOKEN NO VA ESCRITO ACÁ. Sale de la variable de entorno DISTAT_TOKEN o del archivo
#    `token.txt` que está al lado de este script (poner `chmod 600 token.txt`). Identifica a la
#    distribuidora: quien lo tenga puede escribir el catálogo.
#
# ⚠️ Ojo con cron: NO hereda el entorno de la sesión, así que `DISTAT_TOKEN` exportada en el
#    `.bashrc` no existe cuando la tarea corre. Por eso conviene el `token.txt`.

set -u

URL='https://lqhtxivednffpiicnbog.supabase.co/functions/v1/ingest-precios'
REINTENTOS=2
ESPERA=900          # 15 min entre reintentos → 06:00, 06:15, 06:30

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVO="${1:-}"
LISTA_COMPLETA="${2:-}"   # pasar `--lista-completa` SOLO a mano, nunca desde cron

if [ -z "$ARCHIVO" ]; then
  echo "uso: $0 <archivo-exportado> [--lista-completa]" >&2
  exit 2
fi

TOKEN="${DISTAT_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$BASE/token.txt" ]; then
  TOKEN="$(tr -d '[:space:]' < "$BASE/token.txt")"
fi
if [ -z "$TOKEN" ]; then
  echo "Falta el token: poner DISTAT_TOKEN o $BASE/token.txt" >&2
  exit 2
fi

mkdir -p "$BASE/registros"
LOG="$BASE/registros/precios-$(date +%F).log"
escribir() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

[ -f "$ARCHIVO" ] || { escribir "ERROR: no existe el archivo $ARCHIVO"; exit 2; }
[ -s "$ARCHIVO" ] || { escribir "ERROR: el archivo esta vacio ($ARCHIVO)"; exit 2; }

# Que el export sea de hoy. Un ERP que falló y dejó el archivo de ayer haría que mandemos la misma
# lista todos los días con un 200 de respuesta, y nadie se enteraría. No frena el envío: lo anota.
if [ -n "$(find "$ARCHIVO" -mmin +1200 2>/dev/null)" ]; then
  escribir "AVISO: el archivo tiene mas de 20 horas. Puede que el export no haya corrido."
fi

DESTINO="$URL"
if [ "$LISTA_COMPLETA" = "--lista-completa" ]; then
  DESTINO="$URL?lista_completa=1"
  escribir "AVISO: modo LISTA COMPLETA. Se dan de baja los productos que no vengan en el archivo."
fi

escribir "Enviando $ARCHIVO ($(wc -c < "$ARCHIVO") bytes) a $DESTINO"

intento=0
while :; do
  # `-w` separa el código HTTP del cuerpo; `--fail` NO se usa a propósito: con él curl esconde el
  # cuerpo del error, y el cuerpo es justamente donde el endpoint explica qué fila está mal.
  salida="$(curl -sS -m 300 -w $'\n%{http_code}' \
      -X POST "$DESTINO" \
      -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: text/csv; charset=utf-8' \
      --data-binary "@$ARCHIVO" 2>&1)"
  curl_rc=$?
  codigo="$(printf '%s' "$salida" | tail -n1)"
  cuerpo="$(printf '%s' "$salida" | sed '$d')"

  if [ $curl_rc -eq 0 ] && [ -n "$codigo" ]; then
    escribir "HTTP $codigo $cuerpo"
    case "$codigo" in
      200) exit 0 ;;
      409) escribir "El servidor freno el envio: la lista daria de baja mas del 20% del catalogo. No se escribio nada."; exit 1 ;;
      401) escribir "Token invalido o revocado. Pedir uno nuevo."; exit 1 ;;
      # Un 5xx es del servidor y puede ser pasajero: se reintenta como si fuera red.
      5*)  escribir "Error del servidor, se reintenta." ;;
      *)   exit 1 ;;
    esac
  else
    escribir "Error de red: $salida"
  fi

  intento=$((intento + 1))
  if [ $intento -gt $REINTENTOS ]; then
    escribir "Sin reintentos restantes. No se envio la lista de hoy."
    exit 3
  fi
  escribir "Reintento $intento de $REINTENTOS en $ESPERA segundos."
  sleep $ESPERA
done
