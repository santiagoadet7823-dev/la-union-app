# Guía — GPS casi en vivo + jornada forzada + antigüedad de instalación

> Handoff para el **próximo APK** (se junta con la Tarea A del push nativo de
> `GUIA_PUSH_NATIVO_Y_VERSIONES.md`). Verificado contra el código y la base viva el 24/07/2026.
> **Leer entero antes de tocar.** Decisiones ya tomadas con el usuario están marcadas como ✔.

Tres pedidos del cliente, con una parte que **técnicamente no se puede garantizar** (ver §3, leer sí o sí):

- **1) GPS casi en vivo** — subir la ubicación cada ~10 s (hoy es por movimiento ≥10 m / keepalive 90 s).
- **2) Jornada forzada** — que la app quede rastreando 7:30–18:00 Lun–Sáb, "abierta en 2º plano y que
  no se pueda cerrar". ⚠️ Lo de "no se pueda cerrar" **no es garantizable** en teléfonos normales;
  se implementa el máximo realista (§3).
- **3) Antigüedad de instalación** — que superadmin/admin/encargado vean hace cuánto se instaló la app
  en cada dispositivo. ✔ **Forma elegida: nativa (precisa, retroactiva) → va en este APK.**

**Decisiones tomadas:** cadencia **10 s** ✔ · anti-cierre = **persistencia máxima + alertas** (NO kiosco) ✔ ·
install date = **nativo `firstInstallTime`** ✔.

---

## 0. Estado actual medido (no asumido)

- **Subida de posiciones:** el filtro/encolado/subida vive en `web/src/services/geolocation/tracker.js`
  → `procesarFix()`, invocado SÍNCRONO desde el callback nativo (sobrevive a Doze). Hoy:
  - Emite si `movió ≥ MIN_MOVE_M (10 m)` **o** `keepAlive ≥ KEEPALIVE_MS (90 s)` — [tracker.js:137-139](web/src/services/geolocation/tracker.js#L137).
  - `enqueue` nunca se throttlea; el **flush** se agrupa a `FLUSH_THROTTLE_MS (15 s)` — [tracker.js:163](web/src/services/geolocation/tracker.js#L163).
  - Constantes en [gpsConfig.js](web/src/services/gpsConfig.js).
- **Adquisición del chip:** el plugin adquiere a ~1 Hz en movimiento; la máquina de estados
  ([estados.js](web/src/services/geolocation/estados.js)) estira a **90 s cuando confirma "quieto"**
  (`PRESET_QUIETO.interval`). El piso de adquisición no se toca desde JS ([[bateria-plugin-gps-piso]]).
- **Ventana horaria: YA EXISTE.** `app_config` tiene `track_start`/`track_end`/`track_enabled`
  (hoy `track_start=00:30`, `track_end=00:00`, `track_enabled=true`). La consume
  [tracking.js](web/src/services/tracking.js) (`getTrackConfig`/`dentroDeHorario`) y la aplica
  [usePublishPosition.js:61-79](web/src/hooks/usePublishPosition.js#L61): **apaga/prende el sensor** por
  horario y se recalibra en el borde. La edita el superadmin en
  [EmpresasView.jsx](web/src/features/admin/EmpresasView.jsx). **NO tiene día-de-semana todavía.**
- **`pg_cron` disponible** (el cron `push-heartbeat-30min` ya corre) → sirve para la poda (§1.3).

---

## 1) GPS casi en vivo (cadencia 10 s)

### 1.1 El cambio es de constantes JS (se puede probar por OTA antes del APK)
La cadencia NO necesita código nativo. Es tocar el gate de tiempo en `procesarFix` y los presets:

- **`gpsConfig.js`:** agregar `NEAR_LIVE_MS = 10000` (o reusar `KEEPALIVE_MS` bajándolo). El punto es
  que `procesarFix` emita "al menos cada 10 s" aunque esté quieto:
  ```js
  // tracker.js:138 — hoy keepAlive = 90 s; para casi-en-vivo:
  const keepAlive = prev && Date.now() - prev.sentAt >= NEAR_LIVE_MS  // 10 s
  ```
- **`FLUSH_THROTTLE_MS`:** bajar de 15 s a ~10 s para que el punto llegue a la base "en vivo" y no
  espere al lote de 15 s. (No bajar mucho más: cada flush es una request HTTP+TLS; a 10 s con
  BATCH=200 se agrupa bien.)
- **Presets de `estados.js`:** para que "en vivo" valga también **detenido en un cliente**, el chip no
  puede caer a 90 s. Opciones: (a) subir `PRESET_QUIETO.interval` a ~10 s, o (b) no entrar a QUIETO
  durante la jornada. ⚠️ Esto es lo que más pega en batería.
  - Respetar regla 13 (updateWatcher NO mergea: spread completo) y regla 18 (no subir priority/no bajar
    ACCURACY).

> **Recomendación de rollout:** publicar **primero la cadencia por OTA** (reversible, sin rebuild) y
> medir batería EN DISPOSITIVO un día real. Recién si la autonomía es aceptable, cablear la persistencia
> nativa (§2/§3) en el APK. Así no se invierte en lo nativo sobre una cadencia que quizá haya que subir
> a 15 s por batería.

### 1.2 Impacto en Supabase (writes NO son el problema; el disco sí)
- A 10 s durante 10,5 h = **~3.780 filas/vendedor/día**. Con ~15 vendedores ≈ **1,7 M filas/mes**.
- Los INSERT son baratos y ya van **en lote** (BATCH=200, cola idempotente). El cuello es el **crecimiento
  de `posiciones`**: a ~100 B/fila, ~170 MB/mes → llena el disco del plan Free en pocos meses.
- **Realtime NO por punto:** el lado supervisor debe **pollear** la RPC de últimas posiciones cada
  ~10-15 s (como la burbuja de perfil actual), no suscribir Realtime por fila (los límites del Free se
  agotan). Confirmar la cadencia del hook de vivo (`useEquipoEnVivo`/`ultimas_posiciones`) y bajarla a
  ~10-15 s si hace falta.

### 1.3 Retención OBLIGATORIA (nueva, DB)
Sin poda, el disco se llena. Agregar un `pg_cron` nocturno que borre/archive `posiciones` viejas.
Antes de fijar el N de días, confirmar **qué lee histórico** (los recorridos del día usan el día; el
replay de jornadas viejas podría querer más). Propuesta: **retención 60-90 días**, configurable.
Migración nueva `db/13_retencion_posiciones.sql` (archivo nuevo, aplicar en vivo por MCP; regla 9).

---

## 2) Antigüedad de instalación (nativo, este APK) ✔

`@capacitor/app` NO expone la fecha de instalación. La fecha real sale de Android
`PackageManager.getPackageInfo(pkg, 0).firstInstallTime` (y `lastUpdateTime`).

- **Nativo:** un método chico en un plugin propio (o extender uno existente) que devuelva
  `firstInstallTime`. Es lectura pura, sin permisos. Retroactivo (sirve para los que ya tienen la app).
- **DB:** columna nueva `estado_dispositivo.instalado_ts timestamptz` (migración
  `db/14_instalado_ts.sql`, archivo nuevo). La reporta el latido, igual que `apk_version`:
  capturar una vez en `useEstadoDispositivo.js` (junto al `apkRef` ya agregado) y sumarla a `CAMPOS`
  y al objeto `estado`.
- **UI:** en [EstadoEquipo.jsx](web/src/features/supervision/components/EstadoEquipo.jsx) mostrar
  "instalada hace X" (formato relativo). Ya es el lugar que ven superadmin/admin/encargado.

> Si se quisiera algo por OTA sin esperar el APK: guardar el **primer arranque** en `persistence`
> (aprox, no retroactivo). Se descartó a favor de la fecha real. No implementar salvo pedido.

---

## 3) Jornada forzada — el techo honesto (LEER)

**Lo que el cliente pide como "que no se pueda cerrar" NO es alcanzable como garantía** en los
teléfonos personales de los vendedores. Fundado en la memoria del proyecto y en Android:

- **Ningún app impide el force-stop del usuario** ni vence a los OEM killers (Xiaomi/Oppo/Samsung con
  "optimización" dura) — [[push-watchdog-fcm]], regla 27.
- **Android 12+ bloquea abrir la Activity desde background** → no se puede "abrir sola".
- El único "no se puede cerrar" real es **kiosco/lock-task**, que exige **teléfonos dedicados
  provisionados como dispositivos administrados (MDM)**. ✔ **El usuario eligió NO ir por ahí.**

### 3.1 Lo máximo realista (elegido ✔) — todo nativo → APK
- **Servicio en primer plano pegajoso** con notificación fija, **gateado por la ventana 7:30–18:00
  Lun–Sáb**: arranca solo cuando el proceso vive y se mantiene mientras esté dentro de la ventana.
  (Hoy el foreground service existe para el GPS; el delta es hacerlo schedule-driven y más sticky.)
- **Boot receiver**: re-armar el rastreo tras reiniciar el teléfono (declarado en manifest, regla 17).
- **Watchdogs** ya existentes (AlarmManager + push FCM de la Tarea A) para revivir el proceso.
- **Prompts duros**: permiso de ubicación en **"Siempre"** + app **sin optimización de batería**
  (EstadoEquipo ya los diagnostica; reforzar el prompt).
- **La verdadera "obligación" es de gestión, no técnica:** EstadoEquipo ya marca **"sin señal desde X"**
  en rojo. Si un vendedor cierra la app, el supervisor lo ve al toque. Esa es la palanca real.

### 3.2 Ventana horaria con día-de-semana (parte JS)
Hoy `dentroDeHorario` solo mira hora. Sumar **Lun–Sáb**:
- Agregar día-de-semana a la config de rastreo. **Confirmar primero dónde vive** la ventana
  (`app_config` global vs por empresa — EmpresasView la edita) antes de agregar la columna/campo
  (ej. `track_days` = bitmask o CSV `1,2,3,4,5,6`).
- Extender `dentroDeHorario(cfg)` en [tracking.js](web/src/services/tracking.js) para chequear el día con
  hora **local** (regla 23: nunca UTC; el día de la semana también cambia con el offset).
- UI en EmpresasView para elegir los días.

---

## 4) Canales y secuencia

| Parte | Canal | Notas |
|---|---|---|
| Cadencia 10 s (constantes JS) | **OTA** (probar batería) | Reversible; medir 1 día antes del APK |
| Retención `posiciones` (pg_cron) | **DB** (aplicar en vivo) | Obligatoria si se sube la cadencia |
| Poll del lado supervisor a ~10-15 s | **OTA/PWA** | Confirmar `useEquipoEnVivo` |
| `firstInstallTime` (install date) | **APK** (nativo) + DB + JS | §2 |
| Persistencia/jornada sticky + boot | **APK** (nativo) | §3.1 |
| Día-de-semana en la ventana | **OTA/PWA** (+ posible columna DB) | §3.2 |

**Secuencia sugerida:**
1. **OTA de prueba**: cadencia 10 s + poll supervisor + retención DB. Medir batería y disco un día real.
2. Si la autonomía cierra: **APK** con install date (§2) + jornada sticky/boot (§3.1), junto a la
   Tarea A del push. Subir los 4 números de versión + `app_config` (§6 de CLAUDE.md).
3. Comunicar al cliente por escrito el **techo de §3** (no hay candado; la app puede cerrarse y por eso
   el tablero de supervisión es la herramienta de control).

## Checklist de gotchas (CLAUDE.md)
- Cadencia: regla 13 (updateWatcher no mergea), regla 18 (no priority 102 / no bajar ACCURACY), regla 15
  (persistencia no va en useEffect).
- Fechas locales con `hoyStr()`/hora local, nunca UTC (regla 23) — vale para día-de-semana.
- Migraciones = archivo nuevo numerado, aplicado en vivo (reglas 5, 9). No editar los existentes.
- APK nuevo = subir los 4 números + `app_config` (§6) y publicar la misma versión como OTA.
- `CAP_BUILD=1` en todo build de APK/OTA (regla 1). No `cap add android` (regla 3).
