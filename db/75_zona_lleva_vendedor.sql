-- 75_zona_lleva_vendedor.sql — "La zona lleva el vendedor", garantizado en la base.
-- 18/09/2026.
--
-- 🔴 QUÉ PASÓ. El cliente armó sus zonas hoy (28, cada una con su vendedor dueño) y empezó a
-- asignar comercios desde Menú → Zonas. BURELA (dueña: Eduardo Ruiz) quedó con 29 comercios, 25 de
-- ellos SIN vendedor. La regla "los clientes de una zona son del vendedor dueño de la zona" existía
-- en tres lugares de la app (importar, borrar zona, ficha del cliente) y faltaba en el cuarto —el
-- select de zona de la pantalla de Zonas— y en el quinto —cambiar el dueño de una zona, que
-- preguntaba "¿pasar los clientes?" y con "Sólo la zona" los dejaba con el dueño viejo.
--
-- Cuatro copias de una regla en la app son cuatro oportunidades de olvidarla (regla 31/36). Acá va
-- UNA vez, en triggers, y la app la repite sólo para que la vista y el modo offline digan lo mismo
-- que va a decir la base:
--
--   · clientes: al ENTRAR a una zona (insert o cambio de `id_zona`), si la zona tiene dueño, el
--     cliente lo hereda. Si la zona no tiene dueño, conserva el suyo: una zona sin vendedor no
--     desasigna a nadie.
--   · zonas: al cambiar `id_vendedor`, todos sus clientes (vigentes y archivados, para que uno que
--     vuelva no quede con dueño viejo) pasan al dueño nuevo. Dejar la zona sin dueño NO desasigna:
--     mismo criterio.
--
-- ⚠️ El trigger de clientes es BEFORE y modifica NEW: no dispara otra escritura. El de zonas es
-- AFTER y hace un update sobre clientes que sí dispara el de clientes, pero ése sólo actúa cuando
-- cambia `id_zona`, y acá no cambia. Sin recursión.
--
-- Corre con los permisos del que escribe: un admin/encargado que edita una zona ya puede editar sus
-- clientes por RLS (`clientes_wr`), así que el update en cascada no necesita SECURITY DEFINER.

create or replace function public.cliente_hereda_vendedor_de_zona()
returns trigger
language plpgsql
as $$
declare
  v_vendedor uuid;
begin
  if new.id_zona is null then return new; end if;
  if tg_op = 'UPDATE' and new.id_zona is not distinct from old.id_zona then return new; end if;
  select z.id_vendedor into v_vendedor from public.zonas z where z.id = new.id_zona;
  if v_vendedor is not null then new.id_vendedor := v_vendedor; end if;
  return new;
end $$;

drop trigger if exists clientes_hereda_vendedor_de_zona on public.clientes;
create trigger clientes_hereda_vendedor_de_zona
  before insert or update of id_zona on public.clientes
  for each row execute function public.cliente_hereda_vendedor_de_zona();

create or replace function public.zona_pasa_vendedor_a_clientes()
returns trigger
language plpgsql
as $$
begin
  if new.id_vendedor is null or new.id_vendedor is not distinct from old.id_vendedor then return new; end if;
  update public.clientes c
     set id_vendedor = new.id_vendedor
   where c.id_zona = new.id
     and c.id_vendedor is distinct from new.id_vendedor;
  return new;
end $$;

drop trigger if exists zonas_pasa_vendedor_a_clientes on public.zonas;
create trigger zonas_pasa_vendedor_a_clientes
  after update of id_vendedor on public.zonas
  for each row execute function public.zona_pasa_vendedor_a_clientes();

-- Backfill de una vez: los que ya estaban en una zona con dueño y no lo tenían (hoy: 25 de BURELA,
-- 1 con otro dueño). Es la misma regla aplicada a lo que se cargó antes de que existiera.
update public.clientes c
   set id_vendedor = z.id_vendedor
  from public.zonas z
 where z.id = c.id_zona
   and z.id_vendedor is not null
   and c.id_vendedor is distinct from z.id_vendedor;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (0 filas)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--   select c.nombre_comercio, z.nombre as zona
--     from public.clientes c join public.zonas z on z.id = c.id_zona
--    where z.id_vendedor is not null and c.id_vendedor is distinct from z.id_vendedor;
