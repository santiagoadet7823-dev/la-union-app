#!/usr/bin/env bash
# ============================================================================
# Publica un APK NUEVO (reinstalación nativa) en un GitHub Release y deja lista
# la URL + el SQL para que los teléfonos lo bajen e instalen solos (1 toque).
#
# Usar SOLO cuando cambió algo NATIVO (plugin, permiso del manifest, código Java):
# para JS/CSS/React alcanza con la OTA (scripts/ota-release.sh).
#
# Requisitos: gh (GitHub CLI) logueado, Git Bash, y el .apk YA compilado y FIRMADO
# con el keystore de release. Compilarlo antes con (ver CLAUDE.md §3):
#   CAP_BUILD=1 npm run build && npx cap sync android
#   cd android && ./gradlew assembleRelease -Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr"
#
# Uso:   bash scripts/apk-release.sh 1.6.0
# ============================================================================
set -euo pipefail

# Ver la nota de ota-release.sh: el cliente React vive en `web/` desde el 17/08/2026 y este
# script sigue en `scripts/` de la raíz. Sin este `cd`, la ruta del APK de abajo no resuelve
# y el script aborta con "No encuentro el APK firmado" aunque el APK esté compilado.
cd "$(dirname "${BASH_SOURCE[0]}")/../web"

VER="${1:-}"
if [ -z "$VER" ]; then
  echo "Uso: bash scripts/apk-release.sh <version>   (ej: 1.6.0)"
  exit 1
fi

REPO="santiagoadet7823-dev/la-union-app"
TAG="apk-$VER"
APK="android/app/build/outputs/apk/release/app-release.apk"

if [ ! -f "$APK" ]; then
  echo "✗ No encuentro el APK firmado en:"
  echo "    $APK"
  echo "  Compilalo primero (ver el encabezado de este script / CLAUDE.md §3)."
  exit 1
fi

echo "→ Publicando release $TAG en GitHub…"
if gh release create "$TAG" "$APK" --repo "$REPO" --title "APK $VER" --notes "Reinstalación nativa $VER" 2>/dev/null; then
  :
else
  gh release upload "$TAG" "$APK" --repo "$REPO" --clobber
fi

URL="https://github.com/$REPO/releases/download/$TAG/app-release.apk"
echo ""
echo "✅ APK publicado:"
echo "   $URL"
echo ""
echo "ÚLTIMO PASO — pegá esto en Supabase (SQL editor) para avisar a los celulares:"
echo "   update public.app_config set min_version='$VER', apk_url='$URL', updated_at=now();"
echo ""
echo "IMPORTANTE:"
echo " - 'min_version' es el PISO: los equipos con versión < $VER verán el aviso de reinstalar."
echo "   Ponelo en la version de este APK (la que trae el cambio nativo)."
echo " - Publicá TAMBIÉN el mismo cambio como OTA (bash scripts/ota-release.sh $VER), para los"
echo "   que ya lo tengan instalado o para el contenido web. Ver CLAUDE.md §6."
echo " - El .apk debe estar firmado con el MISMO keystore que el instalado, o Android rechaza la"
echo "   actualización."
