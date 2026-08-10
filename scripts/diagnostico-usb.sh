#!/usr/bin/env bash
# ============================================================================
# Diagnóstico por USB de un teléfono del parque (Samsung A07 / A06).
#
# Contesta las preguntas que HANDOFF §7.7 dejó abiertas y que no se pueden
# responder desde la base: marca/modelo/API real, si `adb` puede poner la
# exención de batería, y si esa exención SOBREVIVE AL REBOOT — que es la
# medición más valiosa de toda la sesión (§7.9): si sobrevive, un cable deja
# los 9 teléfonos exentos sin depender de que nadie toque un diálogo.
#
# 🟢 NO ES DESTRUCTIVO. Solo lee, salvo la exención de batería (que es
#    justamente lo que se quiere poner, y es reversible con `-com.launion.app`).
#    NO resetea, NO desinstala, NO toca cuentas ni la cola de posiciones.
#
# Requisitos en el teléfono (One UI):
#   Ajustes → Información del teléfono → Información de software
#     → tocar "Número de compilación" 7 veces
#   Ajustes → Opciones de desarrollador → Depuración por USB  ✓
#   Al conectar el cable, aceptar "¿Permitir depuración USB?" en la pantalla.
#
# Uso:
#   bash scripts/diagnostico-usb.sh                 # solo lee
#   bash scripts/diagnostico-usb.sh --configurar    # 🟢 DEJA EL EQUIPO LISTO
#   bash scripts/diagnostico-usb.sh --exentar       # solo la exención
#   bash scripts/diagnostico-usb.sh --post-reboot   # verifica si sobrevivió
#
# 🟢 `--configurar` es el modo normal para preparar un teléfono: pone la
#    exención de batería + los 5 permisos + los 2 appops de una sola pasada,
#    en unos 30 segundos. MEDIDO el 07/08/2026 sobre un SM-A075M real
#    (Android 16 / API 36): funciona todo, incluido ACCESS_BACKGROUND_LOCATION
#    ("Permitir siempre"), que por diálogo Android 11+ ya no deja pedir.
#    La exención SOBREVIVE AL REBOOT (verificado). No requiere Device Owner,
#    ni factory reset, ni servidor de MDM.
#
# La salida se guarda en scripts/diagnostico-<modelo>-<fecha>.txt para poder
# comparar equipos entre sí. Anotar el nombre del vendedor al lado.
# ============================================================================
set -uo pipefail   # sin -e: un getprop que falle no debe cortar el diagnóstico

PKG="com.launion.app"
ADB="${ADB:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
[ -x "$ADB" ] || ADB="adb"   # si está en el PATH, alcanza

EXENTAR=0
POST_REBOOT=0
CONFIGURAR=0
for a in "$@"; do
  case "$a" in
    --exentar)     EXENTAR=1 ;;
    --post-reboot) POST_REBOOT=1 ;;
    --configurar)  CONFIGURAR=1; EXENTAR=1 ;;
    *) echo "Opción desconocida: $a"; exit 1 ;;
  esac
done

sh() { "$ADB" shell "$@" 2>/dev/null | tr -d '\r'; }

# --- El teléfono tiene que estar uno solo y autorizado -----------------------
echo "→ Buscando el teléfono…"
CONECTADOS=$("$ADB" devices | grep -c -E '\sdevice$' || true)
if [ "$CONECTADOS" -eq 0 ]; then
  echo "✗ No hay ningún teléfono autorizado."
  "$ADB" devices
  echo ""
  echo "  Si aparece como 'unauthorized': mirá la pantalla del teléfono y aceptá"
  echo "  el diálogo '¿Permitir depuración USB?' (marcá 'Siempre')."
  echo "  Si no aparece nada: revisá el cable (algunos son solo de carga) y que"
  echo "  Depuración por USB esté activada en Opciones de desarrollador."
  exit 1
fi
if [ "$CONECTADOS" -gt 1 ]; then
  echo "✗ Hay $CONECTADOS dispositivos conectados. Dejá UNO solo:"
  "$ADB" devices
  exit 1
fi

MODELO=$(sh getprop ro.product.model)
SALIDA="$(dirname "$0")/diagnostico-${MODELO:-desconocido}-$(date +%Y%m%d-%H%M).txt"

{
echo "==========================================================="
echo " DIAGNÓSTICO USB — $(date '+%Y-%m-%d %H:%M')"
echo " Vendedor: ______________________   (anotar a mano)"
echo "==========================================================="

# --- FASE 1 · Identidad (el dato que hoy NO se guarda en ningún lado) --------
echo ""
echo "--- FASE 1 · Identidad -------------------------------------"
echo "Marca            : $(sh getprop ro.product.manufacturer)"
echo "Modelo           : $MODELO"
echo "Nombre comercial : $(sh getprop ro.product.name)"
echo "Android          : $(sh getprop ro.build.version.release)  (API $(sh getprop ro.build.version.sdk))"
echo "One UI           : $(sh getprop ro.build.version.oneui)"
echo "Parche seguridad : $(sh getprop ro.build.version.security_patch)"
echo "Provisionado     : $(sh settings get global device_provisioned)  (1 = ya pasó el wizard)"

# --- FASE 2 · La app --------------------------------------------------------
echo ""
echo "--- FASE 2 · La app ----------------------------------------"
VER=$(sh dumpsys package "$PKG" | grep -m1 versionName | sed 's/.*versionName=//')
COD=$(sh dumpsys package "$PKG" | grep -m1 versionCode | sed 's/.*versionCode=\([0-9]*\).*/\1/')
if [ -z "$VER" ]; then
  echo "⚠️  La app NO está instalada en este teléfono."
else
  echo "Versión          : $VER  (versionCode $COD)"
  echo "Instalador       : $(sh pm list packages -i "$PKG" | sed 's/.*installer=//')"
  # 🔴 El gate de la regla 19-bis: por debajo de 1.8.0 NO hay fix multi-cuenta.
  MAJ=${VER%%.*}; REST=${VER#*.}; MIN=${REST%%.*}
  if [ -n "$MAJ" ] && [ -n "$MIN" ] && { [ "$MAJ" -lt 1 ] || { [ "$MAJ" -eq 1 ] && [ "$MIN" -lt 8 ]; }; }; then
    echo "🔴 RIESGO regla 19-bis: $VER < 1.8.0 — NO cambiar de usuario en este"
    echo "   equipo sin actualizar primero. Los puntos quedarían a nombre del"
    echo "   usuario anterior, en una tabla sin UPDATE ni DELETE. Incorregible."
  fi
fi
echo "Device Owner     : $(sh dumpsys device_policy | grep -i -m1 'device owner' || echo 'ninguno')"

# 🩸 Estado "stopped": una app recién instalada que NUNCA se abrió —o una a la
#    que le hicieron "Forzar detención"— NO recibe broadcasts, y eso incluye
#    BOOT_COMPLETED. O sea que BootReceiver y AlarmReceiver quedan INERTES: el
#    arranque al horario y el watchdog no existen hasta que alguien abra la app
#    una vez. Es el mismo agujero que el force-stop, por otra puerta.
EST=$(sh dumpsys package "$PKG" | grep -m1 'stopped=')
case "$EST" in
  *notLaunched=true*)
    echo "🔴 La app NUNCA fue abierta (stopped) → NO recibe BOOT_COMPLETED."
    echo "   BootReceiver y AlarmReceiver están inertes. HAY QUE ABRIRLA E"
    echo "   INICIAR SESIÓN una vez, o el arranque al horario no va a existir." ;;
  *stopped=true*)
    echo "🔴 La app está en estado 'stopped' (force-stop) → no recibe broadcasts."
    echo "   Abrirla a mano para rearmar las alarmas." ;;
  *) echo "Estado            : activa (recibe broadcasts)" ;;
esac

# --- FASE 3 · 🔴 Batería: LA medición que decide todo -----------------------
echo ""
echo "--- FASE 3 · Exención de batería (Doze) --------------------"
esta_exento() { sh dumpsys deviceidle whitelist | grep -q "$PKG" && echo "SÍ" || echo "NO"; }
echo "Exento ahora     : $(esta_exento)"

if [ "$EXENTAR" -eq 1 ]; then
  echo "→ Poniendo la exención…"
  sh cmd deviceidle whitelist "+$PKG" >/dev/null
  echo "Exento después   : $(esta_exento)"
  # La persistencia ya está medida (07/08, SM-A075M): no hace falta re-verificarla
  # en cada equipo. El recordatorio queda solo para el modo --exentar suelto.
  if [ "$CONFIGURAR" -eq 0 ]; then
    echo ""
    echo "Para comprobar que persiste en ESTE equipo:"
    echo "   adb reboot && bash scripts/diagnostico-usb.sh --post-reboot"
  fi
fi

if [ "$POST_REBOOT" -eq 1 ]; then
  echo ""
  echo ">>> VERIFICACIÓN POST-REBOOT: $(esta_exento)"
  echo "    SÍ → la exención por adb es persistente. Es la mejor noticia posible."
  echo "    NO → hay que ponerla a mano en cada equipo (PermisoSiemprePrompt)."
fi

# App Standby bucket: 10=active, 20=working_set, 30=frequent, 40=rare, 45=restricted
echo "Standby bucket   : $(sh am get-standby-bucket "$PKG")  (10 activo … 45 restringido)"

# --- FASE 4 · Permisos y alarmas -------------------------------------------
echo ""
echo "--- FASE 4 · Permisos --------------------------------------"

# 🟢 MEDIDO el 07/08/2026 en un SM-A075M (Android 16 / API 36): `adb` concede
#    TODOS estos, incluido ACCESS_BACKGROUND_LOCATION — el "Permitir siempre"
#    que Android 11+ NO deja pedir por diálogo. No hace falta Device Owner.
if [ "$CONFIGURAR" -eq 1 ]; then
  echo "→ Concediendo permisos por adb…"
  # COARSE va primero: BACKGROUND cuelga de tener ubicación concedida.
  for p in ACCESS_COARSE_LOCATION ACCESS_FINE_LOCATION ACCESS_BACKGROUND_LOCATION \
           POST_NOTIFICATIONS ACTIVITY_RECOGNITION; do
    sh pm grant "$PKG" "android.permission.$p" >/dev/null
  done
  # SCHEDULE_EXACT_ALARM sostiene el arranque al horario (1.11.0).
  # REQUEST_INSTALL_PACKAGES evita los 6-7 toques de la primera actualización.
  for o in SCHEDULE_EXACT_ALARM REQUEST_INSTALL_PACKAGES; do
    sh cmd appops set "$PKG" "$o" allow >/dev/null
  done
fi

# Se lee SIEMPRE del estado real: el "OK" de `pm grant` no prueba nada.
for p in ACCESS_FINE_LOCATION ACCESS_BACKGROUND_LOCATION POST_NOTIFICATIONS ACTIVITY_RECOGNITION; do
  v=$(sh dumpsys package "$PKG" | grep -m1 "android.permission.$p: granted=" | sed 's/.*granted=\([a-z]*\).*/\1/')
  printf '%-28s: %s\n' "$p" "${v:-?}"
done
echo ""
echo "Alarma exacta    : $(sh cmd appops get "$PKG" SCHEDULE_EXACT_ALARM | head -1 || echo '?')"
echo "Instalar APKs    : $(sh cmd appops get "$PKG" REQUEST_INSTALL_PACKAGES | head -1 || echo '?')"
echo "Alarmas vivas    :"
sh dumpsys alarm | grep -i "$PKG" | head -20 || echo "  (ninguna)"

# --- FASE 5 · Servicio y GPS ------------------------------------------------
echo ""
echo "--- FASE 5 · Servicio en curso -----------------------------"
sh dumpsys activity services "$PKG" | grep -E 'ServiceRecord|started=|foreground=' | head -12 || echo "  (no corre)"
echo ""
echo "Proveedores GPS  : $(sh settings get secure location_providers_allowed)"
echo "Modo ubicación   : $(sh settings get secure location_mode)  (3 = alta precisión)"

echo ""
echo "==========================================================="
echo " Guardado en: $SALIDA"
echo "==========================================================="
} 2>&1 | tee "$SALIDA"
