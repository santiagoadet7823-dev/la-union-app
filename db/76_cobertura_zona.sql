-- 76_cobertura_zona.sql — Cubrir la zona de otro por una jornada.
-- 18/09/2026.
--
-- 🩸 POR QUÉ EXISTE. Que un vendedor pueda hacer la zona de otro por una jornada: elige la zona
-- de una lista ("Cubrir otra zona", en Ruta), todos los clientes de esa zona entran a su Inicio y
-- a su mapa hasta que termine el día, y puede hacer check-in. Un reemplazo temporal cuando el
-- dueño de la zona falta.
--
-- (La primera versión, del mismo día, dibujaba en el mapa del vendedor los 729 comercios de la
-- empresa y la cobertura se pedía tocando un pin ajeno. El dueño lo objetó —teléfonos baratos,
-- gente poco técnica, ~650 pines que no son de uno— y se cambió por la lista. La base es la misma.)
--
-- Dos cosas lo impedían:
--
-- 1) `clientes_sel` dejaba al vendedor leer SÓLO sus clientes (`id_vendedor = auth.uid()`) y los
--    sin dueño. No podía ni ver los pines ajenos. Se abre la LECTURA a toda la empresa; editar y
--    borrar no cambian (`clientes_upd`/`clientes_del` siguen como estaban). Qué es "mío" lo decide
--    ahora la app con un solo criterio (`lib/carteraDe.js`): dueño directo, dueño de la zona, o
--    zona cubierta hoy. Los sin dueño ya no son "de todos": arrancan ocultos y se llegan a mano.
--
-- 2) No había dónde guardar "hoy Agustín cubre BURELA". Va en `coberturas_zona`, UNA fila por
--    (zona, persona, día). La ve toda la empresa: el supervisor (la capa de cartera del monitoreo
--    dibuja la zona cubierta como de Agustín) y el dueño de la zona. La escribe sólo el que cubre,
--    con su propio id. Vence sola: es por `fecha`, y mañana la consulta de hoy no la trae.
--
-- ⚠️ La `fecha` la manda la app con su `hoyStr()` (hora LOCAL del teléfono, regla 23). El default
-- de acá es sólo la red de seguridad para un insert a mano, y va en la zona de la distribuidora.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) LECTURA DE LA CARTERA: toda la empresa
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists clientes_sel on public.clientes;
create policy clientes_sel on public.clientes
  for select using (es_superadmin() or id_empresa = mi_empresa());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) COBERTURAS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.coberturas_zona (
  id         uuid primary key default gen_random_uuid(),
  id_empresa uuid not null references public.empresas(id) on delete cascade,
  id_zona    uuid not null references public.zonas(id) on delete cascade,
  id_usuario uuid not null references public.perfiles(id) on delete cascade,
  fecha      date not null default ((now() at time zone 'America/Argentina/Salta')::date),
  created_at timestamptz not null default now(),
  unique (id_zona, id_usuario, fecha)
);

create index if not exists coberturas_zona_empresa_fecha_idx
  on public.coberturas_zona (id_empresa, fecha);

comment on table public.coberturas_zona is
  'Quién cubre qué zona en qué día (reemplazo temporal). Una fila por (zona, persona, día); la escribe el que cubre desde su mapa.';

alter table public.coberturas_zona enable row level security;

drop policy if exists coberturas_zona_sel on public.coberturas_zona;
create policy coberturas_zona_sel on public.coberturas_zona
  for select using (es_superadmin() or id_empresa = mi_empresa());

drop policy if exists coberturas_zona_ins on public.coberturas_zona;
create policy coberturas_zona_ins on public.coberturas_zona
  for insert with check (id_usuario = auth.uid() and id_empresa = mi_empresa());

drop policy if exists coberturas_zona_del on public.coberturas_zona;
create policy coberturas_zona_del on public.coberturas_zona
  for delete using (id_usuario = auth.uid() or es_superadmin() or (id_empresa = mi_empresa() and es_admin()));

grant select, insert, delete on public.coberturas_zona to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (como un vendedor):
--   set role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<id>","role":"authenticated"}', true);
--   select count(*) from public.clientes;                      -- toda la empresa
--   insert into public.coberturas_zona (id_empresa, id_zona, id_usuario, fecha)
--     values ('<empresa>', '<zona>', '<id>', current_date);   -- ok con su id, rechazado con otro
--   reset role;
-- ─────────────────────────────────────────────────────────────────────────────
