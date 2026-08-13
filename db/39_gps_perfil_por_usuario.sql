-- 39_gps_perfil_por_usuario.sql — Perfil de GPS por usuario + modelo del teléfono (13/08/2026).
--
-- EL PEDIDO: "veo los contadores de actualización y va 5s-5s-5s-1m-7m como si fuera aleatorio y se
-- muere. A esos que se le muere ponle gps 5s y hagamos pruebas: Javier, Luis Mendoza, Gabriel Tevez,
-- Eduardo Ruiz. No sé si se puede poner en el plugin esta nueva opción de forzar gps cada 5 s y que
-- la habilite yo desde el panel superadmin a usuarios específicos."
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE SE MIDIÓ ANTES DE ESCRIBIR ESTO (base viva, jornadas del 12 y 13/08).
-- ─────────────────────────────────────────────────────────────────────────────
-- Con Agustin y Orlando como CONTROL, que ese mismo día trabajaron bien:
--
--                    gps_intervalo_ms   mediana entre pts   huecos >60s   acc p50   fixes <5m (6 días)
--   Gabriel tevez        30.000              32,6 s              89        15,9 m     3 de 4.973
--   Eduardo ruiz         30.000              27,8 s              29        17,6 m   155 de   368
--   Luis Mendoza          4.000              24,0 s              77         4,6 m  1.053 de 2.065
--   Javier                4.000               6,6 s              74        20,1 m   174 de 2.353
--   Agustin (control)     4.000               2,0 s               3         1,4 m  5.555 de 5.642
--   Orlando (control)     2.000               4,0 s               6         1,7 m  3.851 de 4.880
--
-- Son DOS problemas distintos que el síntoma mezcla:
--
--   1. GABRIEL Y EDUARDO ESTÁN CLAVADOS EN LA CADENCIA LENTA DE 30 s (NEAR_LIVE_QUIETO_MS).
--      Activity Recognition los declara "quieto" y, caminando, nunca cruzan VEL_UMBRAL_MPS (3 m/s),
--      así que jamás entran en la cadencia rápida — ya estaba medido y anotado en gpsConfig.js
--      ("los huecos de Gabriel pasan a 0,5-1,5 m/s, o sea CAMINANDO"). Y con cadencia de 30 s **un
--      solo fix perdido ya son 60 s de hueco** (regla 49). De ahí sus 89 huecos contra los 3 de
--      Agustin. Acá el pedido del cliente da en el clavo: sacarlos de los 30 s cambia algo real.
--
--   2. JAVIER Y LUIS YA CORREN A 4 s. Su limitante es la PRECISIÓN, no el temporizador. El filtro de
--      confianza explica parte del contador que salta —el panel en vivo sale de `ultimas_posiciones`,
--      que filtra accuracy <= 30 (db/28)— pero solo un tercio: Javier pasa de 74 a 100 huecos >60 s
--      al aplicar el filtro, Luis de 77 a 112. El resto es silencio real del chip. Para ellos, forzar
--      el intervalo probablemente no mueva la aguja, y eso se dice ANTES de la prueba, no después.
--
-- ⚠️ NO usar `fix_desc_movimiento` como métrica de esta prueba: NO son descartes, son *diferidos* —
--    el mismo fix se cuenta en `cDescMovimiento` y después en `cGuardados` (UploaderGpsService.java
--    :746-762, hallazgo H5 de AUDITORIA_GPS_2026-08.md). Cualquier porcentaje sale inflado.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ ASÍ Y NO DE OTRA FORMA
-- ─────────────────────────────────────────────────────────────────────────────
-- · POR QUÉ NO ES SOLO "5 s". `NEAR_LIVE_MS` ya vale 4.000 ms desde el 12/08: el número pedido ya
--   está superado. Lo que falta no es bajar la cadencia base sino IMPEDIR QUE BAJE SOLA a 30 s. Eso
--   sale gratis por composición: igualando intervaloMs = intervaloRapidoMs = intervaloQuietoMs, ni
--   Activity Recognition ni la velocidad la pueden mover — `avisarActividad("quieto")` pide 30 s,
--   pero 30 s ES el número que ya está vigente.
--   BONUS no obvio: con las tres cadencias iguales, `aplicarCadencia` nunca vuelve a llamar a
--   `requestLocationUpdates`, así que el churn desaparece por completo. Es exactamente el mecanismo
--   señalado como culpable del fracaso de 1.8.1 (ver el 🩸 de NEAR_LIVE_MS en gpsConfig.js).
--
-- · POR QUÉ SIN APK NUEVO. Los ~24 parámetros del servicio nativo ya viajan JS → configurar() →
--   SharedPreferences → UploaderGpsService. No hay una sola cadencia hardcodeada en Java que no sea
--   un *default* de pref. Esto es base + OTA + PWA, y nada de android/.
--
-- · POR QUÉ jsonb Y NO UNA COLUMNA POR PERILLA. Mismo criterio que `perfiles.permisos` (db/23): son
--   6-8 valores del mismo tipo y una columna cada uno serían 8 migraciones. Es esparso a propósito:
--   solo lleva las claves que se pisan.
--
-- · 🩸 ESTO NO ROMPE LA REGLA 22-ter, Y LA LÍNEA ES FINA. `services/gpsConfig.js` SIGUE SIENDO LA
--   ÚNICA FUENTE de los umbrales: acá no se guardan valores de producción, se guardan DELTAS POR
--   PERSONA sobre esa base. `null` (el default de todo el mundo) = comportamiento idéntico al de hoy,
--   así que los teléfonos sanos no corren ningún riesgo. El ÚNICO lugar donde este JSON se valida y
--   se traduce a parámetros es `src/services/gpsPerfil.js`: whitelist de claves y clamps duros, para
--   que un JSON mal escrito acá no pueda romperle el GPS a nadie.
--
-- · 🔴 `ACCURACY_MAX_M` (30) NO ES OVERRIDE-ABLE, y no es un olvido. Reglas 18 y 18-bis: vive en
--   CINCO runtimes (gpsConfig.js, segmentar.ts, db/28, db/33, db/36-37) y pisarlo por usuario los
--   desincronizaría en silencio — se apagarían los avisos al supervisor de esa persona sin que nadie
--   lo note. Lo que sí se puede tocar por usuario es el techo de CAPTURA
--   (`ACCURACY_CAPTURA_MAX_M`), que es otra pregunta. Capturar no es confiar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SIN POLICIES NUEVAS — verificado contra la base viva el 13/08/2026
-- ─────────────────────────────────────────────────────────────────────────────
--   perfiles_upd  = es_superadmin() OR (mi_rol()='admin' AND id_empresa = mi_empresa())
--                   ↑ NO incluye `id = auth.uid()`, así que un vendedor NO puede auto-editarse el
--                     perfil de GPS. (La versión de historico/02_saas.sql sí lo incluía: otro motivo
--                     para no re-ejecutar esos archivos — regla 5.)
--   perfiles_sel  incluye `id = auth.uid()` → el teléfono lee su propio override gratis.
--   estado_disp_upd = (id_usuario = auth.uid()) → el latido puede escribir modelo/fabricante.
-- Mismo razonamiento con el que se agregó `color_trazo` (db/12). No hay funciones nuevas, así que no
-- aplica el bloque de grants/revokes de las reglas 7 / 7-bis.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El perfil de GPS por usuario
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.perfiles
  add column if not exists gps_perfil jsonb;

comment on column public.perfiles.gps_perfil is
  'Override de GPS por usuario. NULL = automatico (lo de hoy). Objeto ESPARSO: solo las claves que '
  'se pisan sobre services/gpsConfig.js, que sigue siendo la unica fuente de los valores base '
  '(regla 22-ter). Claves: modo (auto|intensivo|ahorro), intervalo_s, fijar_cadencia, min_move_m, '
  'nota, desde. Se valida y se traduce EXCLUSIVAMENTE en src/services/gpsPerfil.js (whitelist + '
  'clamps): cualquier clave desconocida se ignora. ACCURACY_MAX_M (30) NO es override-able, vive en '
  'cinco runtimes. Lo escribe el superadmin desde Usuarios; lo lee el telefono via getTrackConfig.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Qué teléfono es cada uno
-- ─────────────────────────────────────────────────────────────────────────────
-- 🩸 El parque NO registraba esto en ninguna tabla, así que la hipótesis del cliente —"creo que ellos
-- tienen samsung a07"— no se podía ni probar ni descartar. Y es una hipótesis que importa: la
-- diferencia entre los dos grupos es de HARDWARE hasta que se demuestre lo contrario (Gabriel tiene
-- 3 fixes sub-5 m en 4.973; Agustin tiene 5.555 en 5.642, el mismo día y la misma ciudad). Si los
-- cuatro que fallan comparten modelo y los dos sanos son otro, la respuesta no es una constante.
--
-- Lo escribe el latido JS parseando `navigator.userAgent` del WebView, que trae el modelo
-- (`Linux; Android 14; SM-A075M Build/…`). Se eligió eso y no `@capacitor/device` para no sumar una
-- dependencia, y sobre todo para que llegue por OTA: un APK nuevo tardaría días en estar en la calle.
-- `fabricante` queda para cuando el próximo APK lo llene con Build.MANUFACTURER — la UA no lo trae.
alter table public.estado_dispositivo
  add column if not exists modelo text,
  add column if not exists fabricante text;

comment on column public.estado_dispositivo.modelo is
  'Modelo del telefono (ej. SM-A075M). Lo sube el latido JS parseando navigator.userAgent; NULL en '
  'web/PWA y si el patron no matchea (parseo defensivo: nunca romper el latido). Existe para poder '
  'contrastar las fallas de GPS contra el hardware en vez de suponerlo.';
comment on column public.estado_dispositivo.fabricante is
  'Fabricante del telefono. La UA del WebView no lo trae, asi que hoy queda NULL: lo llenara el '
  'proximo APK con Build.MANUFACTURER desde UploaderGpsPlugin.estado().';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Verificación (no asumir — regla 5: consultar la base viva)
-- ─────────────────────────────────────────────────────────────────────────────
--   select id, nombre, gps_perfil from public.perfiles where gps_perfil is not null;
--
--   -- ¿El override ATERRIZÓ? `gps_intervalo_ms` lo reporta el propio servicio nativo: si Gabriel
--   -- sigue en 30000 después de una jornada, no llegó y no hay nada que medir.
--   select p.nombre, p.gps_perfil, e.gps_intervalo_ms, e.app_version, e.modelo, e.telemetria_ts
--   from public.perfiles p join public.estado_dispositivo e on e.id_usuario = p.id
--   where p.gps_perfil is not null;
--
-- ⚠️ Al comparar contadores entre personas, mirar `updated_at`/`telemetria_ts` de cada fila: son
--    acumulados del día y el latido JS se congela con el WebView (regla 18-bis).

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────────
-- alter table public.perfiles drop column if exists gps_perfil;
-- alter table public.estado_dispositivo drop column if exists modelo, drop column if exists fabricante;
