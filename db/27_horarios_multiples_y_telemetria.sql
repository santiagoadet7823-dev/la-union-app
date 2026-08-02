-- 27 — Categorías de horario MÚLTIPLES + telemetría de captura GPS (1.8.0, 02/08/2026)
--
-- ⚠️ REGLA 5: este archivo NO es la fuente de verdad. Ya está APLICADO en la base viva vía MCP;
-- queda acá como registro de lo que se hizo y por qué. Para saber cómo está la base, consultarla.
--
-- ============================================================================================
-- §1 — Varias categorías de horario por persona
-- ============================================================================================
--
-- Hasta 1.7.0 cada persona tenía UNA sola categoría (`perfiles.id_categoria_rastreo`), así que una
-- jornada partida obligaba a elegir entre rastrear el hueco del mediodía o perder la tarde.
--
-- La columna vieja SE MANTIENE y se sigue escribiendo con la primera categoría: hay lecturas que
-- todavía la miran y romperlas para ganar una tabla más prolija no valía la pena. La fuente de
-- verdad es la tabla puente.

create table if not exists public.perfiles_categorias_rastreo (
  id_usuario   uuid not null references public.perfiles(id) on delete cascade,
  id_categoria uuid not null references public.categorias_rastreo(id) on delete cascade,
  creado       timestamptz not null default now(),
  primary key (id_usuario, id_categoria)
);

insert into public.perfiles_categorias_rastreo (id_usuario, id_categoria)
select id, id_categoria_rastreo from public.perfiles
where id_categoria_rastreo is not null
on conflict do nothing;

create index if not exists perfiles_categorias_rastreo_usuario_idx
  on public.perfiles_categorias_rastreo (id_usuario);

alter table public.perfiles_categorias_rastreo enable row level security;

-- Lectura: la propia persona (su teléfono necesita saber su horario) y quien ya puede ver ese
-- perfil dentro de su empresa. Escritura: solo admin/superadmin. Mismo criterio que db/18.
drop policy if exists pcr_sel on public.perfiles_categorias_rastreo;
create policy pcr_sel on public.perfiles_categorias_rastreo for select to authenticated
using (
  id_usuario = auth.uid()
  or es_superadmin()
  or id_usuario in (select id from public.perfiles where id_empresa = mi_empresa())
);

drop policy if exists pcr_ins on public.perfiles_categorias_rastreo;
create policy pcr_ins on public.perfiles_categorias_rastreo for insert to authenticated
with check (
  es_superadmin()
  or (es_admin() and id_usuario in (select id from public.perfiles where id_empresa = mi_empresa()))
);

drop policy if exists pcr_del on public.perfiles_categorias_rastreo;
create policy pcr_del on public.perfiles_categorias_rastreo for delete to authenticated
using (
  es_superadmin()
  or (es_admin() and id_usuario in (select id from public.perfiles where id_empresa = mi_empresa()))
);

-- ============================================================================================
-- §2 — `vigilancia_equipo`: unión de ventanas
-- ============================================================================================
--
-- La función se recreó para evaluar TODAS las ventanas de la persona con OR (ver la base viva para
-- el cuerpo actual). Dos notas que valen más que el SQL:
--
--  · Es el espejo EXACTO de `dentroDeHorario()` (src/services/tracking.js). Si una de las dos se
--    mueve sin la otra, los avisos al supervisor empiezan a mentir EN SILENCIO: se avisaría de
--    alguien que está fuera de su ventana de tarde, o no se avisaría de alguien que sí debería
--    estar en la calle. No hay nada que las mantenga sincronizadas salvo acordarse.
--    La TERCERA implementación del mismo contrato es Java: UploaderGpsService.dentroDeVentana().
--
--  · 🩸 Se corrigió una divergencia que YA existía desde db/26: una categoría con `dias` vacío
--    significaba "todos los días" en el teléfono pero "heredá los días del global" acá. Con
--    `track_days` global Lun-Sáb, alguien con categoría sin días marcados era rastreado el domingo
--    por su teléfono y esta función lo daba fuera de ventana — no se lo iba a avisar nunca.
--    Ahora vacío = todos los días, igual que el JS.
--
--  · `abrio_ts` pasó a ser la apertura de la ventana VIGENTE (la última que abrió), no la primera
--    del día: con jornada partida, el silencio de la tarde se mide desde que abrió la tarde.
--
-- Regla 7-bis: los TRES revokes + verificar `proacl`. Verificado: {postgres=X, service_role=X}.

-- ============================================================================================
-- §3 — Telemetría de captura del uploader nativo
-- ============================================================================================
--
-- `posiciones` solo guarda los puntos que SOBREVIVIERON a los filtros, así que desde SQL era
-- imposible distinguir dos causas OPUESTAS de los huecos del trazo: el filtro de movimiento
-- descartando fixes, o el sistema operativo estrangulando la entrega. Medido el 02/08/2026 sobre
-- 23.578 tramos de 7 días: solo el 26,6 % de los puntos consecutivos respeta la cadencia nominal
-- (≤ 12 s) y el 44,4 % cae en la franja de 13-35 s, con 84 m de separación promedio. Sin estos
-- contadores, afinar cualquier umbral es adivinar.

alter table public.estado_dispositivo
  add column if not exists fix_total            int,
  add column if not exists fix_guardados        int,
  add column if not exists fix_desc_precision   int,
  add column if not exists fix_desc_salto       int,
  add column if not exists fix_desc_movimiento  int,
  add column if not exists fix_ultimo_ts        timestamptz;

-- 🔴 `fix_dueno`: a nombre de QUIÉN está capturando este teléfono. Si no coincide con `id_usuario`,
-- el servicio nativo quedó corriendo con el token de la cuenta ANTERIOR y sus puntos se están
-- atribuyendo a otra persona, en una tabla sin policy de UPDATE ni de DELETE. Hasta 1.7.0 eso solo
-- se podía descubrir mirando un recorrido raro en el mapa de alguien.
alter table public.estado_dispositivo
  add column if not exists fix_dueno         uuid,
  add column if not exists cuarentena_nativa int;

comment on column public.estado_dispositivo.fix_dueno is
  'id_usuario con el que el uploader NATIVO está capturando. Distinto de id_usuario = desfase de sesión.';
comment on column public.estado_dispositivo.cuarentena_nativa is
  'Puntos apartados en el teléfono por ser de otra cuenta. No se borran: vuelven si esa cuenta reingresa.';
