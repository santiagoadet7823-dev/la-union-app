-- db/30 — Diagnóstico del ARRANQUE del rastreo al horario (05/08/2026).
--
-- ⚠️ Aplicado en la base viva el 05/08/2026 (migración `diagnostico_arranque_rastreo`). Este
-- archivo es el REGISTRO, no la fuente de verdad: regla 5.
--
-- 🩸 POR QUÉ: reportado desde la calle — "le asigno las 8 y a veces el rastreo no inicia". Medido
-- contra esta misma base sobre 29 días hábiles (primer punto del día vs. las 08:00 configuradas,
-- descartando los días con menos de 50 puntos porque la persona no salió):
--
--     retraso mediano del primer punto ... 51 min
--     días con más de 15 min tarde ....... 23 / 29  (79 %)
--     días con más de 30 min tarde ....... 19 / 29  (66 %)
--
-- Y el contraste que cierra el caso: el ÚLTIMO punto del día es 18:00 clavado casi siempre. El
-- borde de CIERRE funciona perfecto —lo ejecuta un servicio que ya está vivo mirando el reloj— y el
-- de APERTURA no tiene quién lo ejecute. La causa raíz es que nadie programaba una alarma para el
-- inicio de la ventana de cada persona: el watchdog pinguea "ahora + 30 min" a ciegas.
--
-- Había TRES causas candidatas para el caso peor ("no arrancó en todo el día"), y ninguna dejaba
-- rastro, así que desde SQL eran indistinguibles entre sí:
--   · el teléfono no está exento de la optimización de batería → Android 12+ bloquea arrancar el
--     foreground service desde background, y la excepción se tragaba en un `catch (Exception
--     ignored)` (AlarmReceiver.java);
--   · la alarma del watchdog es INEXACTA (setAndAllowWhileIdle) → en Doze / App Standby bucket
--     "rare" el disparo se difiere bastante más de 30 min;
--   · o el receiver directamente no corre (OEM agresivo), y ahí no hay alarma que valga.
--
-- Estas columnas convierten esa adivinanza en un select. `bateria_exenta` la llena el latido desde
-- 1.10.1 (JS puro, sale por OTA); las cinco restantes las llena el APK 1.11.0 y hasta entonces
-- quedan en null.
--
-- Sin cambios de RLS: viajan en el mismo upsert del latido, que ya tiene sus policies (db/29).

alter table public.estado_dispositivo
  add column if not exists bateria_exenta    boolean,
  add column if not exists alarma_ultima_ts  timestamptz,
  add column if not exists alarma_proxima_ts timestamptz,
  add column if not exists alarma_exacta     boolean,
  add column if not exists fgs_bloqueado     integer,
  add column if not exists fgs_bloqueado_ts  timestamptz;

comment on column public.estado_dispositivo.bateria_exenta is
  'El teléfono está en la allowlist de optimización de batería. Es la palanca clave: habilita arrancar el foreground service desde background (Android 12+) Y la alarma exacta sin pedir SCHEDULE_EXACT_ALARM a mano. La llena el latido en cada envío (services/battery.js → estaExento). null = web o APK sin el dato.';

comment on column public.estado_dispositivo.alarma_ultima_ts is
  'Última vez que disparó la alarma del watchdog (AlarmReceiver). Sin esto, "la alarma no dispara" y "la alarma dispara pero el arranque se bloquea" son indistinguibles. APK 1.11.0+.';

comment on column public.estado_dispositivo.alarma_proxima_ts is
  'Próximo disparo programado. Consultado de noche responde, ANTES de que amanezca, si el teléfono tiene armado el arranque de mañana al horario — la única forma de verificar sin esperar 12 horas. APK 1.11.0+.';

comment on column public.estado_dispositivo.alarma_exacta is
  'La próxima alarma se programó como EXACTA (setExactAndAllowWhileIdle). false = canScheduleExactAlarms() dijo que no y se cayó a la inexacta: ese teléfono va a seguir arrancando tarde y la palanca es la exención de batería, no más código. APK 1.11.0+.';

comment on column public.estado_dispositivo.fgs_bloqueado is
  'Veces que Android rechazó arrancar el servicio de ubicación desde background (ForegroundServiceStartNotAllowedException). Hasta 1.10.0 esto se tragaba en un catch vacío y era invisible. > 0 = el SO está bloqueando el arranque. APK 1.11.0+.';

comment on column public.estado_dispositivo.fgs_bloqueado_ts is
  'Cuándo fue el último rechazo de arranque del foreground service. APK 1.11.0+.';

-- ── Cómo se usa (el select que responde "por qué no arrancó") ────────────────────────────────
--
--   select p.nombre, d.app_version, d.bateria_exenta, d.alarma_exacta,
--          d.alarma_ultima_ts, d.alarma_proxima_ts, d.fgs_bloqueado
--   from estado_dispositivo d join perfiles p on p.id = d.id_usuario
--   where p.rol in ('vendedor','repartidor','encargado')
--   order by d.fgs_bloqueado desc nulls last;
--
--   alarma_exacta = false ................ ese teléfono no tiene la exención; la palanca es el
--                                          prompt de batería, no más código.
--   fgs_bloqueado > 0 .................... el SO está bloqueando el arranque.
--   alarma_proxima_ts a las 08:00 ........ consultado ANOCHE: el arreglo está armado.
--   alarma_ultima_ts viejo + fgs = 0 ..... el receiver ni corre (OEM duro).
