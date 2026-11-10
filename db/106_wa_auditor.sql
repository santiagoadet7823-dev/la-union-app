-- 106_wa_auditor.sql — auditor nocturno del asistente de CONSULTAS (09/11/2026, plan 44).
--
-- Solo el número de consultas (`wa-asistente`: dueño, admin y encargado). No toca ventas ni el CRM.
--
-- 1. `wa_mensajes` guarda cómo se eligió la respuesta (origen, resultado, llamadas crudas del modelo y
--    tiempos por etapa): sin eso no se puede saber por qué falló un mensaje.
-- 2. Lo aprendido (atajos, alias y frases reales) vive en tablas: aplicarlo o deshacerlo no pide desplegar.
-- 3. El auditor: hallazgos (mensajes con señales de falla), propuestas (lo que Santiago aprueba por
--    WhatsApp) y resúmenes diarios.
-- 4. `wa_auditor_senales`: las señales sin IA, en SQL puro.
-- 5. pg_cron llama a `wa-auditor` con un token de Vault: la clave anon es pública (está en la app), así
--    que sola no alcanza para que alguien de afuera dispare resúmenes por WhatsApp.
--
-- 🔑 Todo solo `service_role` (regla 7-bis). Sin begin/commit: probar con `begin; \i ...; rollback;` y
-- aplicar con `psql -1 -f`.

-- ── 1. Más detalle en cada mensaje ───────────────────────────────────────────────────────────────
alter table public.wa_mensajes
  add column origen      text check (origen in ('atajo', 'aprendido', 'modelo', 'pide_cambio', 'comando', 'fijo', 'auditor')),
  add column resultado   text check (resultado in ('ok', 'fuera_de_tema', 'pide_cambio', 'ia_caida', 'error_consulta',
                                                  'repregunta', 'no_encontrado', 'dato_no_disponible', 'audio_fallido',
                                                  'no_soportado', 'comando', 'auditor')),
  add column tool_calls  jsonb,
  add column ms_ia       int,
  add column ms_consulta int,
  add column ms_voz      int,
  add column modelo      text;

-- ── 2. Lo aprendido ──────────────────────────────────────────────────────────────────────────────
-- `patron`: expresión regular sobre el texto en minúsculas y sin acentos. La arma el código, nunca el
-- modelo (ver `_compartido/auditor.ts`).
create table public.wa_atajos_aprendidos (
  id             bigint generated always as identity primary key,
  id_empresa     uuid not null references public.empresas (id),
  patron         text not null check (length(patron) between 3 and 300),
  consulta       text not null,
  argumentos     jsonb not null default '{}'::jsonb,
  activo         boolean not null default true,
  id_propuesta   bigint,
  created_at     timestamptz not null default now(),
  desactivado_ts timestamptz
);
create index wa_atajos_aprendidos_activos_idx on public.wa_atajos_aprendidos (id_empresa) where activo;

-- "Gabi" → "Gabriel". Se compara el texto entero, sin acentos ni mayúsculas.
create table public.wa_alias (
  id             bigint generated always as identity primary key,
  id_empresa     uuid not null references public.empresas (id),
  tipo           text not null check (tipo in ('persona', 'cliente', 'producto', 'zona')),
  dice           text not null check (length(dice) between 2 and 80),
  es             text not null check (length(es) between 2 and 80),
  activo         boolean not null default true,
  id_propuesta   bigint,
  created_at     timestamptz not null default now(),
  desactivado_ts timestamptz
);
create unique index wa_alias_unico_idx on public.wa_alias (id_empresa, tipo, public.wa_norm(dice)) where activo;

-- Frases reales con la consulta que correspondía: se suman a la prueba automática (`probar_frases`).
-- `consulta` null = no debía elegir ninguna.
create table public.wa_frases_reales (
  id             bigint generated always as identity primary key,
  id_empresa     uuid not null references public.empresas (id),
  frase          text not null check (length(frase) between 2 and 300),
  consulta       text,
  argumentos     jsonb not null default '{}'::jsonb,
  activo         boolean not null default true,
  id_propuesta   bigint,
  created_at     timestamptz not null default now(),
  desactivado_ts timestamptz
);

-- ── 3. Auditor ───────────────────────────────────────────────────────────────────────────────────
create table public.wa_auditor_hallazgos (
  id           bigint generated always as identity primary key,
  id_mensaje   bigint not null unique references public.wa_mensajes (id) on delete cascade,
  id_empresa   uuid not null references public.empresas (id),
  motivos      text[] not null,
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'analizando', 'analizado', 'error')),
  intentos     int not null default 0,
  causa        text,
  sugerencia   jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  tomado_ts    timestamptz,
  analizado_ts timestamptz
);
create index wa_auditor_hallazgos_pend_idx on public.wa_auditor_hallazgos (created_at) where estado in ('pendiente', 'analizando');

-- `id` es el número que ve Santiago ("aplicar 12").
-- peso 'liviano': lo aplica el auditor (atajo, alias, frase de prueba). 'complejo': queda para Claude Code.
create table public.wa_auditor_propuestas (
  id             bigint generated always as identity primary key,
  id_empresa     uuid not null references public.empresas (id),
  tipo           text not null check (tipo in ('atajo', 'alias', 'frase_prueba', 'claude')),
  peso           text not null check (peso in ('liviano', 'complejo')),
  clave          text not null,
  titulo         text not null,
  detalle        jsonb not null default '{}'::jsonb,
  pedido_claude  text,
  ejemplos       bigint[] not null default '{}',
  veces          int not null default 1,
  estado         text not null default 'nueva'
                 check (estado in ('nueva', 'enviada', 'aplicada', 'descartada', 'deshecha', 'para_claude', 'hecha')),
  decidido_por   uuid references public.perfiles (id),
  decidido_ts    timestamptz,
  created_at     timestamptz not null default now(),
  actualizado_ts timestamptz not null default now()
);
-- Una sola propuesta abierta por clave: si el mismo problema vuelve, suma `veces`.
create unique index wa_auditor_propuestas_abierta_idx on public.wa_auditor_propuestas (id_empresa, clave)
  where estado in ('nueva', 'enviada');

-- Un resumen por día y empresa (fecha de Salta). 'pendiente' = la ventana de 24 h de Santiago estaba
-- cerrada: sale con su próximo mensaje.
create table public.wa_auditor_resumenes (
  id_empresa uuid not null references public.empresas (id),
  fecha      date not null,
  texto      text not null,
  estado     text not null check (estado in ('pendiente', 'enviado', 'sin_novedad')),
  creado_ts  timestamptz not null default now(),
  enviado_ts timestamptz,
  primary key (id_empresa, fecha)
);

alter table public.wa_atajos_aprendidos  enable row level security;
alter table public.wa_alias              enable row level security;
alter table public.wa_frases_reales      enable row level security;
alter table public.wa_auditor_hallazgos  enable row level security;
alter table public.wa_auditor_propuestas enable row level security;
alter table public.wa_auditor_resumenes  enable row level security;
revoke all on public.wa_atajos_aprendidos, public.wa_alias, public.wa_frases_reales, public.wa_auditor_hallazgos,
              public.wa_auditor_propuestas, public.wa_auditor_resumenes from public, anon, authenticated;
grant select, insert, update on public.wa_atajos_aprendidos, public.wa_alias, public.wa_frases_reales,
              public.wa_auditor_hallazgos, public.wa_auditor_propuestas, public.wa_auditor_resumenes to service_role;

-- ── 4. Señales sin IA ────────────────────────────────────────────────────────────────────────────
-- Marca los mensajes respondidos entre p_desde y p_hasta que muestran una falla. Idempotente
-- (`id_mensaje` único). Además toma hasta 5 mensajes sin señales al azar ('muestra'), para que el
-- auditor también vea respuestas que parecían bien. Las filas viejas (antes de esta migración) no
-- tienen `resultado`: se deduce del texto de la respuesta.
create function public.wa_auditor_senales(p_desde timestamptz, p_hasta timestamptz) returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  with base as (
    select m.*,
           coalesce(m.resultado, case
             when m.respuesta like 'No puedo procesar consultas%' then 'ia_caida'
             when m.respuesta like 'No pude leer ese dato%' then 'error_consulta'
             when m.respuesta like 'Solo puedo consultar datos%' then 'fuera_de_tema'
             when m.respuesta like 'No pude entender el audio%' then 'audio_fallido'
             else 'ok' end) as res
      from wa_mensajes m
     where m.autorizado and m.id_empresa is not null
       and m.estado in ('respondido', 'error')
       and coalesce(m.origen, '') not in ('comando', 'auditor')
       and m.recibido_ts >= p_desde and m.recibido_ts < p_hasta
  ),
  sig as (  -- el mensaje siguiente de la misma persona
    select b.id, s.texto as sig_texto, s.recibido_ts - coalesce(b.respondido_ts, b.recibido_ts) as espera
      from base b
      left join lateral (
        select x.texto, x.recibido_ts from wa_mensajes x
         where x.wa_id = b.wa_id and x.recibido_ts > b.recibido_ts and x.texto is not null
           and coalesce(x.origen, '') not in ('comando', 'auditor')
         order by x.recibido_ts limit 1
      ) s on true
  ),
  marcados as (
    select b.id, b.id_empresa, array_remove(array[
      case when b.estado = 'error' or b.res in ('ia_caida', 'error_consulta') then 'error' end,
      case when b.res = 'fuera_de_tema' then 'fuera_de_tema' end,
      case when b.res = 'pide_cambio' then 'pide_cambio' end,
      case when b.res = 'repregunta' then 'repregunta' end,
      case when b.res = 'no_encontrado' then 'no_encontrado' end,
      case when b.res = 'dato_no_disponible' or b.consulta like '%dato_no_disponible%' then 'dato_no_disponible' end,
      case when b.res = 'audio_fallido' then 'audio' end,
      case when b.ms_total > 30000 then 'lento' end,
      -- "no", "eso no", "no te pregunté eso", "no entendiste", "¿qué?": la respuesta anterior no sirvió.
      case when s.espera < interval '5 minutes'
            and (wa_norm(s.sig_texto) ~ '^\W*(no|nop|mal|eso no|no es eso|nada que ver|esta mal|cualquiera|pero yo)\y'
                 or wa_norm(s.sig_texto) ~ '^\W*(no te pregunt|te pregunt|no entend|no me entend)'
                 or wa_norm(s.sig_texto) ~ '^\W*que\W*$')
           then 'queja'
           when s.espera < interval '3 minutes' then 'reformula' end
    ], null) as motivos
      from base b join sig s on s.id = b.id
  ),
  elegidos as (
    select id, id_empresa, motivos from marcados where cardinality(motivos) > 0
    union all
    -- La muestra se toma una sola vez por ventana (la función corre varias veces por noche).
    (select id, id_empresa, array['muestra'] from marcados
      where cardinality(motivos) = 0
        and not exists (select 1 from wa_auditor_hallazgos h join wa_mensajes x on x.id = h.id_mensaje
                         where 'muestra' = any (h.motivos) and x.recibido_ts >= p_desde and x.recibido_ts < p_hasta)
      order by random() limit 5)
  )
  insert into wa_auditor_hallazgos (id_mensaje, id_empresa, motivos)
  select id, id_empresa, motivos from elegidos
  on conflict (id_mensaje) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 5. Token del cron ────────────────────────────────────────────────────────────────────────────
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'wa_auditor_token',
                           'Token con que pg_cron llama a wa-auditor (plan 44)');

create function public.wa_auditor_token_valido(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_token, '') <> ''
     and exists (select 1 from vault.decrypted_secrets where name = 'wa_auditor_token' and decrypted_secret = p_token)
$$;

-- Como `_cron_llamar_funcion` (infra/selfhost/cron_jobs.sql), más el token del auditor.
create function public._cron_llamar_auditor(p_paso text) returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'http://api-gw:8000/functions/v1/wa-auditor?paso=' || p_paso,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_anon_key'),
      'x-auditor-token', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_auditor_token')
    ),
    timeout_milliseconds := 60000
  );
$$;

revoke all on function public.wa_auditor_senales(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.wa_auditor_token_valido(text) from public, anon, authenticated;
revoke all on function public._cron_llamar_auditor(text) from public, anon, authenticated;
grant execute on function public.wa_auditor_senales(timestamptz, timestamptz) to service_role;
grant execute on function public.wa_auditor_token_valido(text) to service_role;

-- ── 6. Horarios (UTC) ────────────────────────────────────────────────────────────────────────────
-- Análisis: 01:00 a 03:50 de Salta, cada 10 min, en lotes chicos (Ollama atiende de a uno y el
-- asistente tiene que seguir contestando). Resumen: 08:00 de Salta.
select cron.schedule('wa-auditor-analizar', '*/10 4-6 * * *', $$ select public._cron_llamar_auditor('analizar'); $$);
select cron.schedule('wa-auditor-resumen',  '0 11 * * *',     $$ select public._cron_llamar_auditor('resumen'); $$);

notify pgrst, 'reload schema';
