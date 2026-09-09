-- =============================================================================
--  db/60 — QUIEN manda la lista de precios, y con que encabezado (09/09/2026)
--
--  QUE RESUELVE
--  Dos preguntas que hoy no se pueden contestar con un `select`, y que costaron
--  una tarde de logs de Cloudflare:
--
--  1. **QUE COLUMNAS MANDA EL ERP.** `ingestas_precios` guarda los conteos, no
--     el archivo. Lo ultimo que se vio de verdad fue `ARTIK.csv` el 28/08, que
--     venia SIN encabezado y con 19 columnas — o sea que lo que mandan hoy ya es
--     otra cosa y nadie sabe cual. Cada vez que hay que decidir si un campo "no
--     viene" o "viene vacio", hay que pedirle el archivo al cliente.
--
--  2. **CUANTAS MAQUINAS ESTAN MANDANDO.** El 08/09 habia DOS con el mismo
--     token: una mandaba el catalogo entero (200) y otra 1.563 bytes fijos (400
--     cada hora, en punto). Eso NO se veia desde la base: se descubrio mirando
--     `function_edge_logs`, que caducan. La guia ya advertia el escenario —dos
--     emisores, gana el ultimo que llega— y aun asi paso desapercibido.
--
--  🔑 POR QUE UNA TABLA APARTE Y NO DOS COLUMNAS EN `ingestas_precios`.
--  La fila de `ingestas_precios` la escribe la RPC `importar_precios`, que NO
--  devuelve su id. Colgarle el encabezado obligaria a cambiarle la firma a una
--  funcion SECURITY DEFINER que reescribe el catalogo entero de una empresa, o a
--  adivinar cual fila actualizar con un UPDATE por timestamp — y hay dos
--  emisores disparando al mismo minuto :00, asi que "la mas reciente" puede ser
--  la del otro. El diagnostico del EMISOR es una pregunta distinta de "que
--  cambio en el catalogo": va en su propia tabla, escrita por el endpoint, y se
--  cruza por `ts` cuando hace falta.
--
--  ⚠️ SE ESCRIBE SIEMPRE, TAMBIEN CUANDO EL ENVIO SE RECHAZA. Es justamente el
--  caso que no dejaba rastro: un 400 se devuelve antes de la RPC (ver el
--  `registrarRechazo` de `index.ts`, 09/09), asi que el emisor que falla es el
--  que menos huella deja. Al reves de lo que conviene.
--
--  ⚠️ NO GUARDA EL ARCHIVO, solo su PRIMERA LINEA recortada a 500 caracteres.
--  Con 5.000 filas de precios por envio y 24 envios por dia, guardar el cuerpo
--  seria una copia del catalogo por hora. El encabezado alcanza para contestar
--  las dos preguntas de arriba.
-- =============================================================================

begin;

-- ── 1) La tabla ──────────────────────────────────────────────────────────────
create table if not exists public.ingestas_emisor (
  id                 uuid primary key default gen_random_uuid(),
  id_empresa         uuid not null references public.empresas(id) on delete cascade,
  id_usuario         uuid references public.perfiles(id) on delete set null,
  ts                 timestamptz not null default now(),
  -- Quien mando. Sale de los headers de la CDN, no del payload: el emisor no se
  -- puede renombrar a si mismo.
  ip                 text,
  agente             text,
  bytes              integer,
  -- Que mando.
  separador          text,
  encabezado         text,     -- la primera linea, cruda, recortada a 500
  columnas_ok        text[],   -- encabezados que el ALIAS reconocio
  columnas_ignoradas text[],   -- encabezados que llegaron y no se usan
  resultado          text      -- 'ok' o el codigo de rechazo
);

comment on table public.ingestas_emisor is
  'Diagnostico de QUIEN manda la lista de precios y con que encabezado. Una fila por request, incluidos los rechazados. db/60.';
comment on column public.ingestas_emisor.ip is
  'IP de origen segun la CDN. Sirve para distinguir dos maquinas mandando con el mismo token.';
comment on column public.ingestas_emisor.encabezado is
  'Primera linea del archivo, cruda y recortada. NO se guarda el cuerpo: serian 24 copias del catalogo por dia.';
comment on column public.ingestas_emisor.columnas_ignoradas is
  'Encabezados que llegaron y ningun ALIAS reconoce. Si aca aparece algo, o sobra en el ERP o falta un alias de nuestro lado.';

create index if not exists ingestas_emisor_empresa_ts_idx
  on public.ingestas_emisor (id_empresa, ts desc);

-- ── 2) RLS: se lee igual que `ingestas_precios`, y no lo escribe nadie ───────
-- Sin policy de INSERT a proposito: la unica escritura es la de la Edge Function
-- con `service_role`, que saltea RLS. Mismo criterio que `ingestas_precios`
-- (db/48): si el endpoint es la unica fuente, que la base lo garantice.
alter table public.ingestas_emisor enable row level security;

drop policy if exists ingestas_emisor_sel on public.ingestas_emisor;
-- Calcada de `ingestas_precios_sel`, verificada contra la base viva el
-- 09/09/2026: quien puede leer el resultado de una ingesta puede leer quien la
-- mando. Dos tablas del mismo tema con permisos distintos es una trampa.
create policy ingestas_emisor_sel on public.ingestas_emisor
  for select using (
    es_superadmin()
    or (
      id_empresa = mi_empresa()
      and (
        mi_rol() = any (array['admin','encargado','marketing'])
        or 'catalogo' = any (mis_permisos())
      )
    )
  );

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACION (correr despues de aplicar, contra la base viva)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ¿Cuantas maquinas estan mandando, y como les va a cada una?
--    select ip, agente, resultado, count(*) envios,
--           min(ts) primero, max(ts) ultimo
--      from public.ingestas_emisor
--     where ts > now() - interval '24 hours'
--     group by ip, agente, resultado
--     order by ultimo desc;
--    -- esperado: UNA sola ip con resultado 'ok'. Dos = el escenario de db/60 §2.
--
-- 2) ¿Que columnas manda el ERP, en que orden?
--    select ts, separador, encabezado, columnas_ignoradas
--      from public.ingestas_emisor
--     where resultado = 'ok'
--     order by ts desc limit 1;
--
-- 3) ¿Hay columnas que llegan y estamos tirando?
--    select distinct unnest(columnas_ignoradas) as sin_usar
--      from public.ingestas_emisor where ts > now() - interval '7 days';
--    -- si aparece algo, o sobra del lado del ERP o falta un alias del nuestro.
