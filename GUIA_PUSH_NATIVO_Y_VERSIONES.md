# Guía de tarea — Wake nativo por FCM + versiones OTA/APK + color de trazo por usuario

> Handoff para arrancar en una sesión nueva. Todo lo de acá está **verificado contra la base
> viva y el código real** el 24/07/2026, no asumido. Leer entero antes de tocar.

Son **tres tareas independientes**:

- **A) Wake nativo por FCM** — que el push despierte la app estando en *segundo plano*, no solo
  con la app abierta. Requiere **APK nuevo**.
- **B) Versiones en el panel** — que el superadmin vea qué versión de **OTA** y de **APK** tiene
  cada usuario. Es **JS + DB**, sale por **OTA + PWA** (sin APK).
- **C) Color de trazo por usuario** — que el **superadmin** pueda elegir a mano el color de cada
  usuario en el mapa. Es **JS + DB**, sale por **OTA + PWA** (sin APK).

**Orden recomendado:** **B y C primero** (baratas, sin rebuild), y meter **A** en el próximo APK.
La razón está en "Secuencia" al final.

---

## 0. Estado actual (medido, no asumido)

**El backend de push funciona de punta a punta.** Se invocó la función a mano y devolvió
`{"enviados":5,"fallidos":0,"total":5}`: FCM aceptó los 5 tokens. La cadena está toda verde:

| Eslabón | Estado |
|---|---|
| Token FCM en `estado_dispositivo.fcm_token` | ✅ varios equipos en 1.5.43, token de 142 chars |
| Cron `push-heartbeat-30min` (`*/30 * * * *`) | ✅ activo (`cron.job` jobid 4) |
| Edge Function `push-heartbeat` v3 | ✅ OAuth con service-account, manda data-only HIGH prio |
| FCM acepta | ✅ 5/5, 0 fallidos |

**Teléfono de prueba:** `cardixteam@gmail.com` — `id_usuario = ad393a7e-738f-42e0-b48d-ff68ebfc3993`,
rol **vendedor**, app **1.5.43**, **con token FCM**. O sea: FCM *sí* llega a este equipo. Lo que
falla es lo de después (ver diagnóstico A).

**Empresa única (tenant):** LA UNIÓN `645aa685-2949-484c-bfe8-9eca57abc8b1`.
**Proyecto Supabase:** `lqhtxivednffpiicnbog` (la-union-pwa).

---

## A) Wake nativo por FCM

### A.1 Por qué hoy NO despierta en segundo plano (la causa raíz)

El plugin de Capacitor trae su propio servicio de FCM:
`node_modules/@capacitor/push-notifications/android/.../MessagingService.java`

```java
public class MessagingService extends FirebaseMessagingService {
  @Override public void onMessageReceived(RemoteMessage m) {
    super.onMessageReceived(m);
    PushNotificationsPlugin.sendRemoteMessage(m);   // ← solo llega al JS si el bridge está vivo
  }
  @Override public void onNewToken(String s) { super.onNewToken(s); PushNotificationsPlugin.onNewToken(s); }
}
```

`sendRemoteMessage` empuja el evento `pushNotificationReceived` **al WebView**. Con la app en
**primer plano** el bridge existe y el JS (`services/push.js` → `onWake`) corre. Con la app
**minimizada / en Doze**, el WebView está congelado o el proceso reducido: el evento se pierde y
**no pasa nada**. Por eso el latido no se refresca con el teléfono guardado — que es justo el caso
que importa.

Es exactamente el mismo techo que ya tiene el canal offline (`AlarmWatchdogPlugin.despertar()`):
si no hay WebView vivo, `instancia == null` y el despertar se descarta.

### A.2 El gotcha de Capacitor (leer antes de escribir código)

FCM entrega a **un solo** `FirebaseMessagingService`. El plugin declara el suyo en su manifest con
`intent-filter` de `com.google.firebase.MESSAGING_EVENT`. En el *manifest merge*, **el del `app`
gana sobre el de la librería**. Entonces:

- Si declaramos **nuestro** servicio con ese intent-filter, **el del plugin deja de recibir**.
- Por lo tanto nuestro servicio **tiene que reenviar al plugin**, o se rompe el push en primer
  plano y el `onNewToken` (captura de token).

La forma limpia: **extender** el servicio del plugin y llamar a `super`, así conservamos gratis el
reenvío al JS y el manejo de token, y le sumamos el trabajo nativo.

### A.3 Diseño propuesto — y la decisión que hay que tomar

Crear `android/app/src/main/java/com/launion/app/LaUnionMessagingService.java`:

```java
package com.launion.app;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.RemoteMessage;
import com.capacitorjs.plugins.pushnotifications.MessagingService;

/**
 * Servicio FCM propio: reemplaza al del plugin (gana en el manifest merge) PERO extiende de él y
 * llama a super, así el push en primer plano y el onNewToken siguen funcionando igual. Lo que suma
 * es el trabajo NATIVO al recibir el ping del watchdog, que corre AUNQUE el WebView esté congelado
 * (que es cuando el reenvío al JS no alcanza). Ver GUIA_PUSH_NATIVO_Y_VERSIONES.md.
 */
public class LaUnionMessagingService extends MessagingService {
  @Override
  public void onMessageReceived(@NonNull RemoteMessage msg) {
    super.onMessageReceived(msg);           // reenvía al JS si el bridge está vivo (primer plano)
    String tipo = msg.getData().get("tipo");
    if ("watchdog".equals(tipo)) {
      // TODO: trabajo nativo (ver "opciones" abajo). Corre en background, sin depender del WebView.
    }
  }
}
```

Y en `AndroidManifest.xml`, **dentro de `<application>`**:

```xml
<service
    android:name=".LaUnionMessagingService"
    android:exported="false">
  <intent-filter>
    <action android:name="com.google.firebase.MESSAGING_EVENT" />
  </intent-filter>
</service>
```

> Si en la prueba se ve que **los dos** servicios reciben (doble), agregar `tools:node="remove"`
> sobre el servicio del plugin, o subir la `android:priority` del intent-filter. En la práctica,
> con el servicio del `app` declarado, Firebase resuelve al nuestro.

**La decisión abierta — qué hace el "trabajo nativo".** El objetivo del watchdog es refrescar el
latido y destapar colas, pero eso es JS/Supabase y necesita el WebView. Con el WebView muerto hay
tres caminos, de más a menos realista:

- **Opción 1 (recomendada) — re-armar el GPS nativo.** Que el servicio se asegure de que el
  *foreground service* de ubicación siga vivo (el tracker). Es lo de mayor valor real: mantener el
  GPS capturando cuando el SO lo mató "suave". **Verificar primero** si el plugin de
  background-geolocation (ver `patches/` y `src/services/geolocation/`) expone forma de re-arrancar
  la captura desde nativo sin abrir la Activity. Si exige abrir `MainActivity`, ojo: Android 12+
  **bloquea** el arranque de Activity desde background salvo excepciones.
- **Opción 2 — latido nativo directo a Supabase.** POST HTTPS (OkHttp) a `estado_dispositivo`
  desde el servicio, para refrescar `ts` aun con el WebView muerto. Problema: necesita el **JWT del
  usuario** guardado de forma accesible desde nativo (hoy la sesión vive en el WebView/Preferences,
  no es trivial leerla). Complejo; probablemente no vale el esfuerzo ahora.
- **Opción 3 — aceptar el techo.** Dejar el reenvío al JS y documentar que el push solo ayuda con
  la app viva-pero-dormida cuando el bridge alcanza a despertar. Es lo que hay hoy.

**Recomendación:** Opción 1 si el plugin de GPS se deja tocar desde nativo; si no, quedarse en
Opción 3 y apoyarse en que el canal de `AlarmManager` ya cubre el disparo offline (con el mismo
techo).

### A.4 Techo honesto (repetirlo en el commit, no venderlo de más)

**Nada de esto revive un `force-stop` manual ni vence a los killers agresivos de ciertos OEM**
(Xiaomi/Oppo/Vivo/Samsung con "optimización" dura). El wake nativo mejora **solo** el caso "kill
suave / Doze" al no depender de que el bridge JS esté caliente. Para el resto siguen mandando el
permiso de ubicación en **"Siempre"** + la app **sin optimización de batería** (que
`EstadoEquipo.jsx` ya diagnostica).

### A.5 Diagnóstico previo OBLIGATORIO (antes de escribir Java)

Confirmar que FCM **entrega al device** de prueba, para no perseguir un fantasma nativo si el
problema fuese entrega. Mandar **un push VISIBLE de una sola vez** al token de cardixteam:
agregar temporalmente un bloque `notification` al mensaje de la Edge Function (o un script suelto)
apuntando solo a ese token. Si en el teléfono aparece el cartel → FCM entrega, el problema es el
wake silencioso (todo lo de A). Si no aparece → es bloqueo del OEM/batería y hay que atacar eso
primero. **No** dejar el `notification` en la función: el watchdog es data-only a propósito.

### A.6 Archivos y build (Tarea A)

- **Nuevo:** `android/app/src/main/java/com/launion/app/LaUnionMessagingService.java`
- **Editar:** `android/app/src/main/AndroidManifest.xml` (el `<service>` de arriba)
- `MainActivity.java` **no** se toca (un `FirebaseMessagingService` no se registra como plugin).
- **Es cambio NATIVO → APK nuevo** (regla §6 de CLAUDE.md). Publicar **APK + la misma versión como
  OTA**. Subir `versionCode`, `versionName`, `APP_VERSION` y `app_config` (hoy están desfasados:
  versionName 1.5.42 / versionCode 13 / APP_VERSION 1.5.43).
- Build del APK **con `CAP_BUILD=1`** (regla 1). **No** correr `cap add android` (regla 3): editar
  el manifest a mano. `cap sync` sí es seguro.

### A.7 Verificación (Tarea A)

1. Logcat filtrando por la clase del servicio, con la app **minimizada**, y disparar la función
   (`select net.http_post(...)` como el cron). Debe entrar `onMessageReceived` con el proceso en
   background.
2. Si se cableó al latido (Opción 1/2): confirmar que `estado_dispositivo.ts` de cardixteam se
   refresca a los pocos segundos del push **con la app cerrada**.

---

## B) Versiones OTA/APK por usuario en el panel

### B.1 Estado actual

- `estado_dispositivo.app_version` = la versión **JS/OTA** (`APP_VERSION` de `src/version.js`), la
  sube el latido en cada envío (`useEstadoDispositivo.js`). **Esta es la versión OTA.**
- La versión **nativa del APK** (`versionName`) **NO** se reporta a la base, pero es obtenible en el
  cliente con `@capacitor/app`: `CapApp.getInfo().then(i => i.version)`. Ya se usa así en
  `SupervisionMovil.jsx:159` (solo para mostrarla en el menú móvil).

O sea: la OTA ya está en la base; falta capturar y guardar la del **APK**, y mostrar las dos.

> Por qué importa la distinción: la OTA puede ir **más adelante** que el APK sin problema (actualiza
> el JS). Lo que hay que cazar es un **APK viejo** que no tenga un plugin nativo necesario — p.ej.
> **APK < 1.5.42 no tiene el plugin de push**, así que en ese equipo el watchdog no funciona por más
> OTA que tenga. Ese es el mismatch que conviene resaltar en el panel.

### B.2 Cambios

**1. Migración DB** — archivo **nuevo** `db/11_apk_version.sql` (no editar los existentes, regla 9),
aplicar contra la base viva por el MCP (`apply_migration`), no asumir desde el `.sql` (regla 5):

```sql
-- La versión NATIVA del APK (versionName), distinta de app_version que es la del bundle OTA (JS).
-- Sirve para detectar equipos con APK viejo sin los plugins nativos nuevos (ej. <1.5.42 sin push).
alter table public.estado_dispositivo add column if not exists apk_version text;
```

**2. `src/hooks/useEstadoDispositivo.js`:**
- Capturar la versión nativa una vez (guardada en un `ref`), guarda con `isNative()`:
  `import { App as CapApp } from '@capacitor/app'` → `CapApp.getInfo().then(i => apkRef.current = i?.version)`.
  En web/PWA `getInfo` no aplica → queda `null` (correcto, la PWA no tiene APK).
- Agregar `'apk_version'` al array `CAMPOS` (línea ~27) y meterlo en el objeto `estado` (línea ~112):
  `const estado = { app_version: APP_VERSION, apk_version: apkRef.current || null, ... }`.

**3. Mostrarlo en el panel** — `src/features/supervision/components/EstadoEquipo.jsx`:
- Agregar `app_version, apk_version` al `.select(...)` (línea ~41).
- Renderizar una línea chica por usuario: `OTA 1.5.43 · APK 1.5.42`. Resaltar en ámbar si
  `apk_version < 1.5.42` (sin push) o si `app_version` está por debajo de
  `app_config.latest_version`.
- Este componente ya es el lugar de "salud del equipo" y lo consume tanto la supervisión móvil como
  la web, así que la info aparece sola en los dos. Si se quiere una tabla dedicada solo-superadmin,
  agregarla como vista aparte, pero con esto alcanza para el pedido.

### B.3 Archivos y despliegue (Tarea B)

- `db/11_apk_version.sql` (nuevo) + aplicar en vivo.
- `src/hooks/useEstadoDispositivo.js`
- `src/features/supervision/components/EstadoEquipo.jsx`
- **Es JS + DB → sale por OTA + PWA, SIN APK nuevo.** (Para que un equipo reporte su `apk_version`
  necesita correr el JS nuevo, que la OTA le entrega.)

---

## C) Color de trazo por usuario, editable solo por el superadmin

### C.1 Estado actual

El color de cada usuario en el mapa (marcador en vivo, etiqueta y reproducción de jornada) sale de
**un solo punto**: `colorPorId(id)` en `src/lib/colors.js`. Es determinístico — hashea el `id` y lo
mapea a una paleta fija de 10 colores. Se llama desde 7 lugares (MapaOperativo, RecorridosView,
ReplayJornada, EstadoEquipo, dwells, SupervisionDesktop/Movil, PropietarioView). Hoy **no se puede
elegir**: dos usuarios pueden caer en el mismo color y no hay forma de diferenciarlos a mano.

`perfiles` **no tiene** columna de color (verificado: `id, nombre, rol, vehiculo, activo,
created_at, id_empresa, email, id_zona, numero, telefono, foto_url`).

### C.2 Diseño propuesto (toca 1 punto, respeta los 7 usos gratis)

La clave: hacer que `colorPorId` **consulte primero un override** y caiga al hash si no hay. Así los
7 call sites siguen igual, sin tocarlos.

**1. Migración DB** — `db/12_color_trazo.sql` (nuevo, aplicar en vivo por MCP):

```sql
-- Color del trazo/marcador del usuario en el mapa. NULL = usar el color automático por hash.
-- Lo edita SOLO el superadmin (ver policy). Hex '#RRGGBB'.
alter table public.perfiles add column if not exists color_trazo text;
```

**RLS:** revisar en la base viva cómo se actualiza `perfiles` hoy y **confirmar/crear** una policy
de UPDATE que permita a `es_superadmin()` tocar `color_trazo`. No aflojar el resto de columnas.
Consultar la base viva, no los `.sql` (regla 5).

**2. `src/lib/colors.js`** — override en memoria + resolver:

```js
const overrides = new Map()   // id -> '#RRGGBB' elegido a mano
export function hydrateColores(perfiles) {
  for (const p of perfiles || []) {
    if (p.color_trazo) overrides.set(p.id, p.color_trazo)
    else overrides.delete(p.id)
  }
}
export function colorPorId(id) {
  if (!id) return PALETA[0]
  const manual = overrides.get(String(id))
  if (manual) return manual            // ← elegido por el superadmin, gana sobre el hash
  let h = 0; const s = String(id)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETA[h % PALETA.length]
}
```

**3. `src/hooks/usePerfilesEquipo.js`** — traer la columna e hidratar el override:
- Agregar `color_trazo` al `.select('id, nombre, rol, color_trazo')`.
- Al resolver, llamar `hydrateColores(data)` (import de `lib/colors`), así el override queda
  disponible para todos los call sites que hoy solo pasan `id`.

**4. UI (solo superadmin)** — un selector de color por usuario. Lugar recomendado:
`src/features/admin/UsuariosView.jsx` (el ABM de usuarios), una muestra de color + popover con la
PALETA de 10 + opción "auto" (setea `color_trazo = null`). Gatear con `rol === 'superadmin'` de
`useAuth()` — el control **no se renderiza** para nadie más.
- Guardar: `update perfiles set color_trazo = ... where id = <usuario>`. Ver cómo hace UsuariosView
  las otras ediciones (si van por write queue o update directo) y seguir ese patrón.
- Tras guardar, invalidar la caché: `invalidarPerfilesEquipo()` (ya exportada) para que el mapa
  tome el color nuevo sin recargar.

> Alternativa a la paleta cerrada: `<input type="color">` para color libre. Recomiendo la paleta de
> 10 (consistencia visual con el resto) + "auto"; si piden libre, es un cambio menor.

### C.3 Archivos y despliegue (Tarea C)

- `db/12_color_trazo.sql` (nuevo) + policy de UPDATE para superadmin, aplicar en vivo.
- `src/lib/colors.js`, `src/hooks/usePerfilesEquipo.js`, `src/features/admin/UsuariosView.jsx`.
- **JS + DB → OTA + PWA, sin APK.** Se puede juntar con la Tarea B en el mismo release.

---

## Secuencia sugerida

1. **Tareas B y C primero** (JS+DB): se publican por OTA+PWA sin rebuild. B da visibilidad de
   versiones; C es independiente y chica. Pueden ir en el mismo release.
2. **Tarea A después**, junto al próximo APK (ya requiere rebuild igual). Al publicar el APK, subir
   la misma versión como OTA (regla §6).
3. Antes de cerrar A, correr el **diagnóstico A.5** (ping visible a cardixteam) para separar
   "no entrega" de "no despierta".

## Checklist de gotchas (de CLAUDE.md)

- `CAP_BUILD=1` en **todo** build de APK/OTA (regla 1); si no, pantalla blanca.
- **No** `cap add android` (regla 3): editar el manifest a mano.
- Migración DB = archivo **nuevo** numerado, aplicada en vivo; no editar los existentes (reglas 5, 9).
- Subir los **cuatro** números de versión + `app_config` (§6): hoy están desfasados.
- Bucket/policies de Storage: no aplica acá.
```
