# Actualización automática (OTA) — LA UNIÓN

La app se actualiza **sola, sin reinstalar el APK**, para casi todos los cambios
(pantallas, features, arreglos, textos). Solo cuando agregamos algo **nativo nuevo**
(un plugin) hace falta un APK nuevo.

## Cómo funciona
1. Compilás el contenido nuevo y se publica un "bundle" en GitHub Releases.
2. Se anota la versión + URL del bundle en la tabla `app_config` (Supabase).
3. Cada celular, al abrir la app, compara su versión con la de `app_config`. Si hay
   una nueva, muestra **"Actualización disponible → Actualizar"**; al tocar, la app
   **descarga y aplica** el bundle y se recarga con lo nuevo. Sin reinstalar.

Motor: `@capgo/capacitor-updater` (modo self-hosted, `autoUpdate:false`). Código en
`src/services/ota.js` y `src/components/UpdatePrompt.jsx`.

## Publicar una actualización (2 pasos)

### 1) Generar y subir el bundle
En **Git Bash**, dentro de `la-union-app`:
```bash
bash scripts/ota-release.sh 1.3.0
```
(usá el número de versión que corresponda). El script compila, empaqueta `dist` y
crea el release en GitHub. Al final imprime la **URL del bundle** y el SQL a correr.

> Requisito: tener `gh` (GitHub CLI) instalado y logueado (`gh auth login`).

### 2) Avisar a los celulares
Pegá en **Supabase → SQL editor** lo que imprimió el script, por ejemplo:
```sql
update public.app_config
set bundle_version = '1.3.0',
    bundle_url = 'https://github.com/santiagoadet7823-dev/la-union-app/releases/download/ota-1.3.0/bundle.zip',
    updated_at = now();
```
Listo. Los usuarios verán el aviso al abrir y se actualizará solo.

## Cuándo sí hace falta un APK nuevo
- Se agrega/actualiza un **plugin nativo** (GPS, login, cámara, etc.).
- Cambian permisos de Android o config nativa.
En esos casos: `CAP_BUILD=1 npm run build && npx cap sync android && (cd android && ./gradlew assembleRelease -Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr")`, y repartir el APK. Después de eso, subí también su versión como OTA para los que ya lo tengan.
