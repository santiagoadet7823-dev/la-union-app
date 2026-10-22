-- db/88 — Situación fiscal y CUIT/CUIL de los clientes, en una tabla aparte (22/10/2026, plan 20).
--
-- CONTEXTO. La Unión pidió cargar la condición frente al IVA y el CUIT/CUIL de cada comercio para
-- que el ERP pueda facturar sin pedirlos de nuevo. Los carga el vendedor (parado en el mostrador) y
-- gestión. Por ahora se GUARDAN; mandarlos al ERP queda para el plan 07 (`Clientes.txt`), cuando el
-- programador del ERP confirme el formato.
--
-- 🔑 POR QUÉ UNA TABLA APARTE Y NO DOS COLUMNAS EN `clientes`. La tabla `clientes` baja ENTERA a
-- cada teléfono (`services/data/catalogo.js`, `select('*')`, ~2.100 filas) y queda guardada en el
-- dispositivo. Un CUIT es un dato fiscal de una persona: no tiene por qué viajar a los 9 teléfonos
-- de la calle, todos los días. Acá se lee de a UNA fila, cuando se abre la ficha de ese cliente
-- (lo pide el informe `_interno/informes/05_sync_erp_clientes.md`).
--
-- 🔑 `cuit_valido` TIENE UN GEMELO EN JS: `web/src/lib/cuit.js` (`cuitValido`). El front frena el
-- CUIT inválido antes de encolarlo (si llegara acá, el CHECK lo rechazaría con 23514 y la cola lo
-- mandaría a cuarentena). Si cambia la regla, se cambia en los dos lados.
--
-- Volver atrás:
--   drop table if exists public.clientes_fiscal;            -- ⚠️ borra lo cargado: respaldar antes
--   drop function if exists public.clientes_fiscal_sellar();
--   drop function if exists public.cuit_valido(text);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Dígito verificador del CUIT/CUIL (módulo 11)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 11 dígitos sin guiones. Prefijos que emite ARCA (ex AFIP): 20/23/24/25/26/27 personas, 30/33/34
-- empresas. Pesos 5-4-3-2-7-6-5-4-3-2 sobre los 10 primeros; dígito = 11 − (suma mod 11), con
-- 11 → 0. Si da 10 el número no existe (ARCA cambia el prefijo a 23/33 en ese caso).
-- STRICT: con NULL devuelve NULL, y un CHECK con NULL pasa (el CUIT es opcional).
create or replace function public.cuit_valido(p_cuit text)
returns boolean
language plpgsql
immutable strict
set search_path = ''
as $$
declare
  pesos int[] := array[5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  suma  int := 0;
  dv    int;
begin
  if p_cuit !~ '^(20|23|24|25|26|27|30|33|34)[0-9]{9}$' then
    return false;
  end if;
  for i in 1..10 loop
    suma := suma + substr(p_cuit, i, 1)::int * pesos[i];
  end loop;
  dv := 11 - suma % 11;
  if dv = 11 then dv := 0; end if;
  if dv = 10 then return false; end if;
  return dv = substr(p_cuit, 11, 1)::int;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. La tabla
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.clientes_fiscal (
  id_cliente      uuid primary key references public.clientes(id) on delete cascade,
  id_empresa      uuid not null references public.empresas(id),
  condicion_iva   text check (condicion_iva in ('RI', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_ALCANZADO')),
  cuit            text check (cuit ~ '^[0-9]{11}$' and public.cuit_valido(cuit)),
  actualizado_ts  timestamptz not null default now(),
  actualizado_por uuid default auth.uid() references public.perfiles(id) on delete set null
);
create index if not exists clientes_fiscal_empresa_idx on public.clientes_fiscal (id_empresa);

-- Quién y cuándo, en CADA escritura (el default de la columna sólo cubre el insert; el upsert de la
-- cola pisa una fila existente). `id_empresa` se toma SIEMPRE del cliente: no se le cree al
-- teléfono. La lectura de `clientes` corre con los permisos de quien escribe, así que un cliente de
-- otra empresa (o un usuario marketing) no lo encuentra y la escritura falla.
create or replace function public.clientes_fiscal_sellar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select c.id_empresa into new.id_empresa from public.clientes c where c.id = new.id_cliente;
  if new.id_empresa is null then
    raise exception 'clientes_fiscal: el cliente % no existe o no es visible', new.id_cliente
      using errcode = '42501';
  end if;
  new.actualizado_ts := now();
  new.actualizado_por := coalesce(auth.uid(), new.actualizado_por);
  return new;
end;
$$;

drop trigger if exists clientes_fiscal_sellar on public.clientes_fiscal;
create trigger clientes_fiscal_sellar
  before insert or update on public.clientes_fiscal
  for each row execute function public.clientes_fiscal_sellar();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Permisos
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Leer y escribir: todos los roles de la empresa que trabajan la cartera (lista blanca, como db/82:
-- un rol nuevo entra cerrado). Borrar: sólo gestión. Marketing, afuera de todo con la RESTRICTIVE.
alter table public.clientes_fiscal enable row level security;

drop policy if exists clientes_fiscal_sel on public.clientes_fiscal;
create policy clientes_fiscal_sel on public.clientes_fiscal for select to authenticated
  using ((select public.es_superadmin())
         or (id_empresa = (select public.mi_empresa())
             and (select public.mi_rol()) in ('superadmin', 'admin', 'encargado', 'vendedor', 'repartidor')));

drop policy if exists clientes_fiscal_ins on public.clientes_fiscal;
create policy clientes_fiscal_ins on public.clientes_fiscal for insert to authenticated
  with check ((select public.es_superadmin())
              or (id_empresa = (select public.mi_empresa())
                  and (select public.mi_rol()) in ('superadmin', 'admin', 'encargado', 'vendedor', 'repartidor')));

drop policy if exists clientes_fiscal_upd on public.clientes_fiscal;
create policy clientes_fiscal_upd on public.clientes_fiscal for update to authenticated
  using ((select public.es_superadmin())
         or (id_empresa = (select public.mi_empresa())
             and (select public.mi_rol()) in ('superadmin', 'admin', 'encargado', 'vendedor', 'repartidor')))
  with check ((select public.es_superadmin())
              or (id_empresa = (select public.mi_empresa())
                  and (select public.mi_rol()) in ('superadmin', 'admin', 'encargado', 'vendedor', 'repartidor')));

drop policy if exists clientes_fiscal_del on public.clientes_fiscal;
create policy clientes_fiscal_del on public.clientes_fiscal for delete to authenticated
  using ((select public.es_superadmin())
         or (id_empresa = (select public.mi_empresa())
             and (select public.mi_rol()) in ('superadmin', 'admin', 'encargado')));

drop policy if exists clientes_fiscal_no_marketing on public.clientes_fiscal;
create policy clientes_fiscal_no_marketing on public.clientes_fiscal as restrictive for all to authenticated
  using ((select public.mi_rol()) is distinct from 'marketing')
  with check ((select public.mi_rol()) is distinct from 'marketing');

revoke all on public.clientes_fiscal from public, anon;
grant select, insert, update, delete on public.clientes_fiscal to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Autochequeo: si algo de arriba no quedó, la migración FALLA en vez de decir que anduvo.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- La misma lista de CUITs que prueba `cuitValido` en JS (scratchpad del plan 20): tienen que dar igual.
do $$
declare
  malos text;
  n int;
begin
  select string_agg(x.cuit || '→' || coalesce(public.cuit_valido(x.cuit)::text, 'null'), ', ') into malos
  from (values
    ('33693450239', true),   -- ARCA (ex AFIP)
    ('30500010912', true),   -- Banco de la Nación Argentina
    ('20123456786', true),
    ('27123456780', true),
    ('20000000001', true),
    ('33693450238', false),  -- último dígito cambiado
    ('3369345023',  false),  -- 10 dígitos
    ('21123456789', false),  -- prefijo que no existe
    ('20000000010', false),  -- el dígito daría 10: ese número no existe
    ('20-12345678-6', false) -- con guiones: se guarda sin ellos
  ) as x(cuit, esperado)
  where public.cuit_valido(x.cuit) is distinct from x.esperado;
  if malos is not null then
    raise exception 'db/88: cuit_valido no da lo esperado en: %', malos;
  end if;

  if not exists (select 1 from pg_class where oid = 'public.clientes_fiscal'::regclass and relrowsecurity) then
    raise exception 'db/88: RLS apagado en clientes_fiscal';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'clientes_fiscal';
  if n <> 5 then
    raise exception 'db/88: se esperaban 5 policies en clientes_fiscal y hay %', n;
  end if;
  if has_table_privilege('anon', 'public.clientes_fiscal', 'select') then
    raise exception 'db/88: anon puede leer clientes_fiscal';
  end if;
end $$;

-- Que PostgREST vea la tabla nueva sin esperar.
notify pgrst, 'reload schema';

-- Verificación (no modifica nada):
--   select count(*), count(cuit), count(condicion_iva) from public.clientes_fiscal;
--   select policyname, cmd, permissive from pg_policies where tablename = 'clientes_fiscal' order by 1;
