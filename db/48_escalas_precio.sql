-- 48_escalas_precio.sql — PRECIOS POR CANTIDAD + el código único por empresa.
-- 27/08/2026. Pedido del cliente en la reunión de esa mañana.
--
-- QUÉ RESUELVE. Hasta hoy un producto tiene UN precio (`precio_unitario`) más un override de oferta,
-- y no existe ninguna tabla de listas ni de descuentos. El cliente vende con escala por volumen: a
-- partir de tantas unidades, el unitario baja. Hasta 5 escalones por producto.
--
-- 🩸 Y EL CATÁLOGO PASA A NIVEL UNIDAD. Hoy las 529 filas son BULTOS: `0011 · MANAOS 6X3LT COLA FDO`
-- es una fila que vale $11.000 el fardo. La lista nueva trae la botella a $1.850 y el fardo pasa a
-- ser el primer escalón (`desde 6`). Esa migración de DATOS no la hace este archivo: la hace el
-- cliente subiendo su lista con "lista completa vigente" desde la pantalla de marketing, a mano y
-- mirando el conteo de bajas. Acá sólo se prepara el esquema.
--
-- POR QUÉ jsonb Y NO UNA TABLA `producto_escalas`. Todo el pipeline del catálogo asume
-- **un producto = una fila**: `CatalogContext` carga el catálogo entero en memoria, `writeQueue`
-- hace `update ... where id = ?`, el espejo offline guarda filas y `snapshotCatalogo` arma el
-- payload de la vidriera campo por campo. Una tabla aparte suma un join a cada lectura, su propia
-- RLS, una op nueva en la cola offline y un segundo objeto en el espejo — cuatro lugares donde
-- desincronizarse, para 529 productos × ≤5 escalones. La actualización parcial de la planilla
-- ("celda vacía no borra") sale gratis con una columna: si no viene, no entra al patch.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LA ESCALA
-- ─────────────────────────────────────────────────────────────────────────────
-- Formato: array ORDENADO ascendente por `desde`, `[{"desde":6,"precio":1750}, ...]`.
-- `desde` se cuenta SIEMPRE en unidades sueltas (decisión del 27/08: nada de fardos ni cajas).
-- `precio` es el unitario a partir de esa cantidad, NO el total de un combo — así
-- `pedido_items.precio_unitario` sigue significando lo mismo y el export a facturar no cambia.
--
-- El `default '[]'` y el `not null` son a propósito: `escalas` nunca es NULL, así que el JS no
-- necesita distinguir "sin escala" de "no cargado" y ningún consumidor tiene que defenderse.
alter table public.productos
  add column if not exists escalas jsonb not null default '[]'::jsonb;

-- El tope de 5 es del acuerdo con el cliente (pidió 3, dejamos margen a 5). El CHECK ataja que un
-- import mal armado meta 40 escalones y reviente el snapshot que viaja por el hotspot a la tablet.
-- La forma de cada elemento NO se valida acá: la normaliza y la ordena `lib/precios.js`, que es la
-- fuente única. Dos validadores de la misma forma es la regla 36 esperando pasar.
alter table public.productos drop constraint if exists productos_escalas_chk;
alter table public.productos add constraint productos_escalas_chk
  check (jsonb_typeof(escalas) = 'array' and jsonb_array_length(escalas) <= 5);

comment on column public.productos.escalas is
  'Escalones de precio por cantidad: [{"desde":6,"precio":1750}], ordenado asc por `desde`, máx 5. '
  '`desde` en UNIDADES sueltas; `precio` es el unitario a partir de esa cantidad. '
  'La resolución vive en web/src/lib/precios.js — NO reimplementarla.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 🔴 EL CÓDIGO ÚNICO POR EMPRESA (no global)
-- ─────────────────────────────────────────────────────────────────────────────
-- `productos_codigo_key` era `UNIQUE (codigo)` GLOBAL, y `clientes_codigo_key` igual. O sea: la
-- SEGUNDA distribuidora no podía ni CREAR el producto `0011` si la primera ya lo tenía — el insert
-- moría con `duplicate key`. Estaba anotado como deuda en CLAUDE.md §8 desde el 04/08 y con una
-- sola empresa con catálogo nunca mordió. Se arregla ACÁ y no "en otro momento" porque este mismo
-- archivo habilita un endpoint que escribe sin humano mirando: ahí un `duplicate key` es invisible.
--
-- 🔑 Y la columna generada hace algo más: convierte la regla de `codigoKey()`
-- (web/src/lib/texto.js) en una RESTRICCIÓN DE LA BASE. Hasta hoy el pareo "0041 ≡ 41" se resolvía
-- comparando en memoria contra el catálogo cargado; con esto, el webhook puede hacer un upsert
-- ATÓMICO por `on conflict (id_empresa, codigo_norm)` y la regla existe en UN solo lugar. Sin esto
-- habría que reescribir `codigoKey` en Deno (la Edge Function no puede importar un módulo del
-- bundle), que es exactamente la regla 36: la misma regla en dos runtimes que nadie sincroniza.
--
-- Todas las funciones de la expresión son IMMUTABLE (verificado en pg_proc: btrim, lower, ltrim,
-- regexp_replace) — requisito de una columna generada.
--
-- El `coalesce(nullif(...))` replica el `|| s` de `codigoKey`: un código que es todo ceros (`0000`)
-- no puede colapsar a cadena vacía, o dos productos distintos quedarían pareados entre sí.
--
-- ⚠️ Medido contra la base viva ANTES de aplicar esto (27/08/2026):
--    productos: 529 filas · 0 códigos nulos · 0 vacíos · 0 con espacios · **0 colisiones**
--    clientes: 2.014 filas · 16 sin código · **0 colisiones**
--    Ningún FK apunta a `codigo` (los de pedidos/visitas/pedido_items van contra `id`).

alter table public.productos add column if not exists codigo_norm text
  generated always as (
    coalesce(
      nullif(ltrim(lower(regexp_replace(btrim(codigo), '\s', '', 'g')), '0'), ''),
      lower(regexp_replace(btrim(codigo), '\s', '', 'g'))
    )
  ) stored;

alter table public.clientes add column if not exists codigo_norm text
  generated always as (
    coalesce(
      nullif(ltrim(lower(regexp_replace(btrim(codigo), '\s', '', 'g')), '0'), ''),
      lower(regexp_replace(btrim(codigo), '\s', '', 'g'))
    )
  ) stored;

-- `codigo` es NULLABLE en las dos tablas y hay 16 clientes sin código: el índice es PARCIAL para no
-- pelearse con eso. Y excluye también la cadena vacía — un `''` normaliza a `''` y dos productos sin
-- código quedarían colisionando por un dato que no dice nada.
alter table public.productos drop constraint if exists productos_codigo_key;
alter table public.clientes  drop constraint if exists clientes_codigo_key;

create unique index if not exists productos_codigo_norm_uidx
  on public.productos (id_empresa, codigo_norm)
  where codigo is not null and btrim(codigo) <> '';

create unique index if not exists clientes_codigo_norm_uidx
  on public.clientes (id_empresa, codigo_norm)
  where codigo is not null and btrim(codigo) <> '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. `ingesta_tokens` — POR FIN VERSIONADA, y con propósito
-- ─────────────────────────────────────────────────────────────────────────────
-- 🩸 Esta tabla y su RPC EXISTÍAN EN VIVO Y NO ESTABAN EN NINGÚN .sql. Es el ítem #3 de HANDOFF y
-- lo peor de la lista de objetos sin versionar: son las dos piezas que autentican al uploader
-- nativo de GPS, así que **una base recreada desde db/ no podía recibir una sola posición**. Peor
-- todavía, el encabezado de `ingest-posiciones` cita un `db/16_ingesta_tokens.sql` QUE NO EXISTE
-- (db/16 es `visitas`). Se versiona acá porque este archivo agrega el segundo consumidor.
--
-- Lo de abajo es idempotente contra la base viva: `if not exists` en todo, así que correrlo sobre
-- la instalación actual no toca los tokens que ya están en la calle.
create table if not exists public.ingesta_tokens (
  token      uuid primary key default gen_random_uuid(),
  id_usuario uuid not null references public.perfiles(id) on delete cascade,
  id_empresa uuid not null,
  creado     timestamptz default now(),
  revocado   boolean not null default false
);
alter table public.ingesta_tokens enable row level security;

-- El dueño ve el suyo y nada más. No hay policy de INSERT/UPDATE/DELETE a propósito: los tokens se
-- crean por la RPC (SECURITY DEFINER) y se revocan con service_role. Un cliente no puede fabricarse
-- una identidad.
drop policy if exists ingesta_tokens_sel on public.ingesta_tokens;
create policy ingesta_tokens_sel on public.ingesta_tokens
  for select using (id_usuario = auth.uid());

-- 🔑 EL PROPÓSITO. Sin esto, el token del uploader de GPS de cualquier vendedor serviría también
-- para escribir la lista de precios de la empresa. Son dos superficies distintas y una de ellas
-- vive dentro de 9 teléfonos que andan por la calle.
alter table public.ingesta_tokens
  add column if not exists proposito text not null default 'gps';

alter table public.ingesta_tokens drop constraint if exists ingesta_tokens_proposito_chk;
alter table public.ingesta_tokens add constraint ingesta_tokens_proposito_chk
  check (proposito in ('gps', 'precios'));

-- ⚠️ EL ÚNICO PASA DE (id_usuario) A (id_usuario, proposito). Con el único viejo, pedir un token de
-- precios haría `on conflict (id_usuario) do update` sobre la fila del GPS y **le rotaría el token
-- al uploader de esa persona**: el servicio nativo seguiría posteando con el token viejo y sus
-- puntos empezarían a rebotar con 401, en silencio, hasta el próximo arranque en frío. Es la misma
-- familia de bug que la regla 19-bis.
alter table public.ingesta_tokens drop constraint if exists ingesta_tokens_id_usuario_key;
create unique index if not exists ingesta_tokens_usuario_proposito_uidx
  on public.ingesta_tokens (id_usuario, proposito);

-- La RPC que mintea. Se REEMPLAZA la versión sin argumentos por una con default, para que
-- `supabase.rpc('mi_token_ingesta')` (services/uploaderNativo.js) siga funcionando sin tocar el JS
-- ni requerir un APK nuevo. Un `drop` explícito primero: dejar conviviendo `mi_token_ingesta()` y
-- `mi_token_ingesta(text default 'gps')` haría la llamada sin argumentos AMBIGUA y Postgres la
-- rechazaría — o sea, se cae el GPS de los 9 teléfonos.
drop function if exists public.mi_token_ingesta();
drop function if exists public.mi_token_ingesta(text);

create function public.mi_token_ingesta(p_proposito text default 'gps')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token uuid;
  v_empresa uuid;
  v_rol text;
begin
  if p_proposito not in ('gps', 'precios') then
    raise exception 'proposito invalido: %', p_proposito;
  end if;

  select id_empresa, rol into v_empresa, v_rol from public.perfiles where id = auth.uid();
  if v_empresa is null then
    raise exception 'sin empresa';
  end if;

  -- 🔴 El token de PRECIOS escribe el catálogo entero de la empresa: sólo lo puede pedir quien ya
  -- puede editar el catálogo desde la app. El de GPS lo pide cualquiera, porque es su propio
  -- teléfono reportando su propia posición.
  if p_proposito = 'precios'
     and not (v_rol in ('admin', 'encargado', 'marketing', 'superadmin')
              or 'catalogo' = any(public.mis_permisos())) then
    raise exception 'sin permiso para un token de precios';
  end if;

  insert into public.ingesta_tokens (id_usuario, id_empresa, proposito)
  values (auth.uid(), v_empresa, p_proposito)
  on conflict (id_usuario, proposito)
    do update set id_empresa = excluded.id_empresa, revocado = false
  returning token into v_token;
  return v_token;
end;
$$;

-- 🚨 Regla 7-bis de CLAUDE.md: en una función NUEVA hay que revocar de los TRES. Supabase tiene un
-- ALTER DEFAULT PRIVILEGES que le da EXECUTE **explícito** a anon y authenticated sobre cada función
-- creada en `public`, y un grant explícito NO se va con un revoke a PUBLIC.
revoke execute on function public.mi_token_ingesta(text) from public;
revoke execute on function public.mi_token_ingesta(text) from anon;
revoke execute on function public.mi_token_ingesta(text) from authenticated;
-- Y se devuelve sólo a quien la necesita: la llama el JS del vendedor con su sesión.
grant execute on function public.mi_token_ingesta(text) to authenticated;
-- (`anon` queda afuera: sin sesión, `auth.uid()` es null y la función ya moría en 'sin empresa',
--  pero una función que mintea identidades no se deja colgando del rol anónimo.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. LA BITÁCORA DE INGESTA
-- ─────────────────────────────────────────────────────────────────────────────
-- 🩸 POR QUÉ EXISTE ANTES QUE EL ENDPOINT. La lección más cara del proyecto es que un canal que no
-- se puede observar falla en silencio: 1.19.0 se publicó con "12 enviados · 0 fallidos" y a los
-- nueve teléfonos no les llegó, porque no había forma de distinguir "no lo intentó" de "falló".
-- Un endpoint que actualiza precios de madrugada tiene exactamente el mismo modo de falla, y el
-- síntoma sería un vendedor cobrando mal frente a un comercio.
--
-- Se guarda el RESUMEN, no el archivo: 529 filas por corrida por día es basura acumulándose, y el
-- archivo original lo tiene el ERP del cliente.
create table if not exists public.ingestas_precios (
  id            uuid primary key default gen_random_uuid(),
  id_empresa    uuid not null,
  id_usuario    uuid,                       -- el dueño del token, para saber quién integró
  ts            timestamptz not null default now(),
  origen        text,                       -- 'endpoint' | 'planilla'
  recibidas     integer not null default 0,
  creados       integer not null default 0,
  actualizados  integer not null default 0,
  sin_cambio    integer not null default 0,
  descontinuados integer not null default 0,
  rechazadas    jsonb not null default '[]'::jsonb,   -- [{fila, codigo, motivo}]
  error         text
);
alter table public.ingestas_precios enable row level security;

create index if not exists ingestas_precios_empresa_ts_idx
  on public.ingestas_precios (id_empresa, ts desc);

-- Lectura para quien administra el catálogo: es la pantalla donde marketing va a mirar "¿entró la
-- lista de hoy?". Escritura sólo con service_role (la Edge Function) — por eso no hay policy de
-- INSERT: nadie puede fabricar una corrida que no pasó.
drop policy if exists ingestas_precios_sel on public.ingestas_precios;
create policy ingestas_precios_sel on public.ingestas_precios
  for select using (
    public.es_superadmin()
    or (id_empresa = public.mi_empresa()
        and (public.mi_rol() = any (array['admin', 'encargado', 'marketing'])
             or 'catalogo' = any (public.mis_permisos())))
  );

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ FALTA (va en db/49, junto con la Edge Function)
-- ─────────────────────────────────────────────────────────────────────────────
-- La RPC `importar_precios(p_filas jsonb, p_lista_completa boolean)`, que es la que hace el upsert
-- atómico contra `(id_empresa, codigo_norm)` y aplica el freno del 20 % de bajas. Va aparte a
-- propósito: este archivo es esquema y se verifica con un `select`; la RPC es lógica y se verifica
-- con datos. Una migración que hace las dos cosas no se puede revisar.
