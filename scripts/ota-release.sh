#!/usr/bin/env bash
# ============================================================================
# Publica una ACTUALIZACIÓN OTA (contenido web, sin reinstalar el APK).
# Requisitos: gh (GitHub CLI) logueado, y correrlo en Git Bash.
# Uso:   bash scripts/ota-release.sh 1.3.0
# Luego: actualizar app_config en Supabase con la URL que imprime al final.
# ============================================================================
set -euo pipefail

VER="${1:-}"
if [ -z "$VER" ]; then
  echo "Uso: bash scripts/ota-release.sh <version>   (ej: 1.3.0)"
  exit 1
fi

REPO="santiagoadet7823-dev/la-union-app"
TAG="ota-$VER"

echo "→ Compilando el contenido web (CAP_BUILD)…"
CAP_BUILD=1 npm run build

echo "→ Empaquetando dist → bundle.zip…"
rm -f bundle.zip
( cd dist && zip -qr ../bundle.zip . )

echo "→ Publicando release $TAG en GitHub…"
if gh release create "$TAG" bundle.zip --repo "$REPO" --title "OTA $VER" --notes "Actualización de contenido $VER" 2>/dev/null; then
  :
else
  gh release upload "$TAG" bundle.zip --repo "$REPO" --clobber
fi

URL="https://github.com/$REPO/releases/download/$TAG/bundle.zip"
echo ""
echo "✅ Bundle publicado:"
echo "   $URL"
echo ""
echo "ÚLTIMO PASO — pegá esto en Supabase (SQL editor) para avisar a los celulares:"
echo "   update public.app_config set bundle_version='$VER', bundle_url='$URL', updated_at=now();"
echo ""
echo "Los usuarios verán el aviso 'Actualización disponible' al abrir la app y se"
echo "actualizará sola (sin reinstalar)."
