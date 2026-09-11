-- 63_pedidos_papelera.sql — Lo anulado se aparta, y al mes se va solo.
-- 11/09/2026.
--
-- POR QUÉ EXISTE. `db/45` decidió que un pedido se anula y no se borra, y dejó el borrado
-- definitivo en manos del superadmin. Lo que faltaba era el medio: entre "anulado" y "borrado a
-- mano por una sola persona" no había nada, así que los anulados se acumulaban mezclados con los
-- vivos en la misma lista. El pedido del dueño (11/09/2026) es concreto: **que lo que anula un
-- vendedor o el encargado quede aislado, y que a UN MES se elimine definitivamente**.
--
-- 🩸 Y EXISTE, ADEMÁS, PORQUE ESTO TAPONÓ LA COLA UN DÍA ENTERO. El backfill de `db/62:72-74`
-- marcó como "ya enviados a facturación" a los 20 pedidos que había, incluidos los de prueba. Con
-- esa marca el trigger `pedido_exportado_congelado` prohíbe anularlos, y el bundle que estaba
-- desplegado —anterior a `db/62`— ni siquiera leía `exportado_ts`, así que ofrecía el botón igual.
-- El encargado lo tocó, la base contestó `pedido-ya-exportado` (P0001), y como la write queue no
-- tenía ese código catalogado lo reintentó **cada 30 segundos durante casi 4 horas, en dos
-- dispositivos**. Lo que quedó atrás en la cola FIFO —los borrados— no salió nunca: en los logs
-- del servidor no hay un solo DELETE. El arreglo del cliente va en `writeQueue.js`; acá va lo que
-- le toca a la base.
--
-- CUATRO COSAS, EN ESTE ORDEN:
--
--  1. Se destilda el backfill. Esos pedidos nunca se bajaron al ERP de verdad
--     (`exportaciones_pedidos` está VACÍA), así que la marca era falsa y congelaba por nada.
--  2. `anulado_srv_ts` — la fecha de anulación **del servidor**, que es sobre la que se purga.
--  3. `pedidos_del` se abre a admin y encargado. El vaciado de la papelera deja de ser de una sola
--     persona, que era lo que hacía que en la práctica no se vaciara nunca.
--  4. La purga a 30 días, con bitácora y por cron.
--
-- APLICA AL INSTANTE. Nada de esto necesita bundle nuevo para regir (§1 a §4 son del servidor); lo
-- que sí necesita el bundle es *mostrar* la papelera.


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. DESTILDAR EL BACKFILL DE db/62
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `db/62` marcó `exportado_ts = now(), export_lote = 0` sobre TODO lo preexistente, con el
-- razonamiento correcto ("sin esto el primer GET duplica facturación"). El problema es que el lote
-- 0 no es una exportación: es un cursor inicial. Nunca hubo un archivo bajado con esos pedidos —
-- `exportaciones_pedidos` no tiene una sola fila— y sin embargo quedaron congelados para siempre:
-- inanulables, inmodificables y, por lo tanto, imborrables (borrar exige pasar por `Anulado`).
--
-- Va con bypass porque el propio trigger protege `exportado_ts` (`cursor-de-exportacion-no-editable`).
-- El lote 0 es el único que se toca: los lotes reales (1 en adelante) SÍ son exportaciones y su
-- congelado es legítimo.
begin;
  set local distat.export_bypass = 'on';
  update public.pedidos
     set exportado_ts = null, export_lote = null
   where export_lote = 0;
commit;


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. `anulado_srv_ts` — LA FECHA CON LA QUE SE CUENTA EL MES
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 🔴 POR QUÉ NO SE PURGA POR `anulado_ts`. Esa columna la escribe el CLIENTE, y está bien que así
-- sea: `anularPedido.js` lo explica —la anulación puede subir horas después si quien la hizo estaba
-- sin señal, y lo que interesa es cuándo se DECIDIÓ, no cuándo llegó. Pero para decidir un borrado
-- irreversible esa fecha no sirve: un teléfono con el reloj adelantado un mes haría desaparecer el
-- pedido en la purga de esa misma noche, y uno atrasado lo dejaría para siempre. La fecha que
-- gobierna la destrucción la pone el servidor o no la pone nadie.
--
-- Las dos columnas conviven a propósito: `anulado_ts` es lo que se le MUESTRA a la gente (cuándo se
-- anuló), `anulado_srv_ts` es con lo que se CUENTA (cuándo lo supo la base).
alter table public.pedidos add column if not exists anulado_srv_ts timestamptz;

create or replace function public.sellar_anulacion()
returns trigger
language plpgsql
as $fn$
begin
  if new.estado = 'Anulado' and old.estado is distinct from 'Anulado' then
    new.anulado_srv_ts := now();
  elsif new.estado is distinct from 'Anulado' and old.estado = 'Anulado' then
    -- Desanular devuelve el pedido a la vida y le saca la cuenta regresiva. No hay pantalla que lo
    -- haga hoy, pero la columna no puede quedar mintiendo si alguna vez la hay.
    new.anulado_srv_ts := null;
  end if;
  return new;
end
$fn$;

-- Corre antes que `pedidos_exportado_congelado` por orden alfabético del nombre del trigger, que es
-- como Postgres los ordena. No importa cuál gane: son independientes y si el congelado aborta,
-- aborta la fila entera igual.
drop trigger if exists pedidos_anulado_sello on public.pedidos;
create trigger pedidos_anulado_sello
  before update on public.pedidos
  for each row execute function public.sellar_anulacion();

-- Los tres revokes también acá (regla 7-bis), como en `asignar_numero_pedido` (`db/43:173-175`).
-- Una función de trigger no se puede llamar por RPC, así que la exposición es teórica — pero
-- Supabase le puso `anon=X | authenticated=X` igual, y una función que nadie debería poder invocar
-- no tiene por qué figurar como invocable.
revoke execute on function public.sellar_anulacion() from public;
revoke execute on function public.sellar_anulacion() from anon;
revoke execute on function public.sellar_anulacion() from authenticated;

-- Los ya anulados arrancan con la fecha que haya: la del cliente si existe, y si no la de creación.
-- Se les da el reloj en marcha desde su anulación real y no desde hoy — si alguien anuló hace dos
-- meses, ya cumplió el mes.
update public.pedidos
   set anulado_srv_ts = coalesce(anulado_ts, created_at)
 where estado = 'Anulado' and anulado_srv_ts is null;

-- Parcial: la purga sólo mira anulados, y son un puñado contra la tabla entera.
create index if not exists pedidos_papelera_idx
  on public.pedidos (anulado_srv_ts) where estado = 'Anulado';


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. QUIÉN VACÍA LA PAPELERA
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `db/45:174-175` la dejó en `es_superadmin() and estado = 'Anulado'`. Decisión del dueño del
-- 11/09/2026: el encargado y el admin también. El motivo práctico es el del incidente — cuando
-- vaciar la papelera depende de una sola persona, no se vacía; y un anulado que no se puede sacar
-- de la vista se termina resolviendo borrando lo que no hay que borrar.
--
-- Los dos cerrojos que NO se mueven:
--   · `estado = 'Anulado'` — sólo se destruye lo que ya pasó por la papelera, con motivo y firma.
--     Nadie borra un pedido vivo de un toque, ni siquiera el superadmin.
--   · el encargado sólo alcanza a su gente, vía `ids_a_mi_cargo()`, igual que en `pedidos_sel`.
--
-- La forma `in (select ids_a_mi_cargo())` con subselect es obligatoria (`db/40:76-79`): así
-- Postgres lo evalúa una vez por consulta (InitPlan) y no una vez por fila.
drop policy if exists pedidos_del on public.pedidos;
create policy pedidos_del on public.pedidos for delete
using (
  estado = 'Anulado'
  and (
    es_superadmin()
    or (
      id_empresa = mi_empresa()
      and (
        mi_rol() = 'admin'
        or (mi_rol() = 'encargado' and id_vendedor in (select ids_a_mi_cargo()))
      )
    )
  )
);


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4. EL CASCADE, DICHO A PROPÓSITO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 🩸 ESTO YA FUNCIONABA, PERO POR CASUALIDAD. `item_exportado_congelado` es
-- `before insert or update or delete` y lanza `pedido-ya-exportado` ante cualquier DELETE de una
-- línea cuyo pedido esté exportado. Cuando se borra el PEDIDO, el cascade borra sus líneas y ese
-- trigger se dispara — y hoy deja pasar únicamente porque su `select` sobre `pedidos` ya no
-- encuentra la fila padre (el cascade corre con el contador de comando ya avanzado), cae en la rama
-- `v_exportado is null` y devuelve OLD. Verificado el 11/09/2026 con una transacción de prueba: el
-- DELETE pasa y se lleva las líneas.
--
-- Que funcione por un detalle de visibilidad MVCC, en la rama equivocada y sin que ningún
-- comentario lo diga, es una bomba de tiempo: cualquiera que "arregle" ese `select` —o que le
-- agregue un `not found` razonando distinto— rompe el borrado de pedidos y la purga de más abajo
-- sin tocar ninguno de los dos. Así que el caso se escribe: **si el padre ya no existe, es un
-- cascade, y el cascade se permite**. Mismo comportamiento, ahora a propósito.
create or replace function public.item_exportado_congelado()
returns trigger
language plpgsql
as $fn$
declare
  v_exportado timestamptz;
  v_fila public.pedido_items;
begin
  if coalesce(current_setting('distat.export_bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_fila := case when tg_op = 'DELETE' then old else new end;

  select p.exportado_ts into v_exportado from public.pedidos p where p.id = v_fila.id_pedido;

  -- EL PADRE YA NO ESTÁ: esto es el cascade de un `delete from pedidos`, no alguien sacando una
  -- línea de un pedido facturado. Quién puede borrar el pedido lo decide `pedidos_del`, y para
  -- llegar ahí el pedido tuvo que estar `Anulado`. No hay nada que congelar acá.
  if not found then
    return old;
  end if;

  if v_exportado is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'pedido-ya-exportado'
      using hint = 'Este pedido ya se envió a facturación. La corrección se hace en el sistema de gestión.';
  end if;

  if new.cantidad        is distinct from old.cantidad
  or new.precio_unitario is distinct from old.precio_unitario
  or new.descripcion     is distinct from old.descripcion
  or new.codigo_producto is distinct from old.codigo_producto
  or new.id_producto     is distinct from old.id_producto
  then
    raise exception 'pedido-ya-exportado'
      using hint = 'Este pedido ya se envió a facturación. La corrección se hace en el sistema de gestión.';
  end if;

  return new;
end
$fn$;


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5. LA BITÁCORA DE LA PURGA
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 🩸 LA REGLA 20 LLEVADA HASTA DONDE SE PUEDE. "Nunca borrar de una cola: se aísla" existe porque
-- un dato borrado no se puede inspeccionar después. Acá el dueño pidió explícitamente que se
-- borre, así que se borra — pero un borrado automático, de noche, sin que nadie lo mire, no puede
-- además ser invisible. Si un día falta un pedido que alguien juraba tener, la pregunta "¿lo
-- purgamos?" tiene que poder contestarse.
--
-- Se guarda el número y el monto, no las líneas: alcanza para reconstruir qué se fue y cruzarlo
-- contra el ERP, sin convertir la bitácora en una copia de la tabla.
create table if not exists public.purgas_pedidos (
  id           uuid primary key default gen_random_uuid(),
  id_empresa   uuid not null references public.empresas(id) on delete cascade,
  ts           timestamptz not null default now(),
  dias         int not null,
  cantidad     int not null,
  numeros      text[] not null default '{}',
  ids          uuid[] not null default '{}',
  monto_total  numeric(14,2)
);

create index if not exists purgas_pedidos_empresa_idx
  on public.purgas_pedidos (id_empresa, ts desc);

alter table public.purgas_pedidos enable row level security;

-- Sólo lectura, y sólo para quien puede vaciar la papelera de toda la empresa. SIN policy de
-- insert/update/delete para nadie: la escribe la función SECURITY DEFINER de abajo, que corre como
-- dueña de la tabla y no pasa por RLS. Una bitácora que se puede editar no es una bitácora
-- (mismo criterio que `pedido_ediciones`, `db/55:96-97`).
drop policy if exists purgas_pedidos_sel on public.purgas_pedidos;
create policy purgas_pedidos_sel on public.purgas_pedidos
  for select using (es_superadmin() or (id_empresa = mi_empresa() and es_admin()));


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6. LA PURGA
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Un mes de gracia. El pedido anulado se ve en la papelera con su cuenta regresiva todo ese tiempo:
-- quien lo anuló por error tiene treinta días para darse cuenta, y quien quiere sacarlo antes lo
-- borra a mano (§3). Pasado el mes se va solo, que es lo que se pidió.
--
-- El parámetro existe para poder probarla; el cron la llama con 30 y nadie más puede llamarla.
create or replace function public.purgar_pedidos_anulados(p_dias int default 30)
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  r record;
  v_n int := 0;
begin
  -- La purga es del sistema, no de una persona: se lleva también lo anulado antes de que `db/62`
  -- existiera y lo que tenga marca de exportación. Sin esto, el trigger de las líneas la frena.
  perform set_config('distat.export_bypass', 'on', true);

  -- Por empresa, porque la bitácora es por empresa. `anulado_srv_ts` nulo nunca entra: la
  -- comparación con NULL da NULL, y un pedido sin fecha de servidor no tiene mes que cumplir.
  for r in
    select p.id_empresa,
           array_agg(p.id)                        as ids,
           array_agg(p.numero order by p.numero)  as numeros,
           count(*)::int                          as n,
           coalesce(sum(p.monto_total), 0)        as monto
      from public.pedidos p
     where p.estado = 'Anulado'
       and p.anulado_srv_ts < now() - make_interval(days => p_dias)
     group by p.id_empresa
  loop
    -- La fila va ANTES del delete: si el delete falla, queda el intento registrado; si fuera al
    -- revés, un fallo entre medio borraría sin dejar rastro.
    insert into public.purgas_pedidos (id_empresa, dias, cantidad, numeros, ids, monto_total)
    values (r.id_empresa, p_dias, r.n, r.numeros, r.ids, r.monto);

    delete from public.pedidos where id = any (r.ids);
    v_n := v_n + r.n;
  end loop;

  return v_n;
end
$fn$;

-- 🩸 REGLA 7 + 7-bis: los TRES revokes, no sólo `public`. Postgres da EXECUTE a PUBLIC por defecto
-- (y revocar sólo de anon/authenticated sería un no-op), pero además Supabase tiene un
-- ALTER DEFAULT PRIVILEGES que le da EXECUTE **explícito** a anon y authenticated sobre cada
-- función nueva de `public`, y un grant explícito no se va con un revoke a PUBLIC. Sin los tres,
-- cualquiera logueado podría vaciar la papelera de todos con un POST a /rest/v1/rpc/ — que es
-- exactamente el agujero que `db/06:44-54` encontró en la purga de posiciones.
revoke execute on function public.purgar_pedidos_anulados(int) from public;
revoke execute on function public.purgar_pedidos_anulados(int) from anon;
revoke execute on function public.purgar_pedidos_anulados(int) from authenticated;
grant  execute on function public.purgar_pedidos_anulados(int) to service_role;

-- Todos los días a las 03:40. Las 03:20 (consultas_rutas) y las 03:30 (posiciones) ya están
-- tomadas; se deja aire entre las tres para no cruzar tres borrados en el mismo minuto.
-- El unschedule previo hace que re-ejecutar este archivo no deje dos jobs haciendo lo mismo, que
-- es el lío que `db/42:6-8` encontró con tres crons de retención pisándose.
select cron.unschedule(jobid) from cron.job where jobname = 'purgar-pedidos-anulados';
select cron.schedule(
  'purgar-pedidos-anulados',
  '40 3 * * *',
  $cron$ select public.purgar_pedidos_anulados(30); $cron$
);


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 7. VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Después de aplicar, esto tiene que dar lo que dice cada comentario:
--
--   -- ningún pedido congelado por el backfill (0 filas)
--   select count(*) from public.pedidos where export_lote = 0;
--
--   -- todos los anulados con su reloj en marcha (0 filas)
--   select count(*) from public.pedidos where estado = 'Anulado' and anulado_srv_ts is null;
--
--   -- la policy nueva, con los dos cerrojos a la vista
--   select policyname, qual from pg_policies where tablename = 'pedidos' and cmd = 'DELETE';
--
--   -- el ACL real de la función: NO puede decir anon=X ni authenticated=X (regla 7-bis)
--   select proacl from pg_proc where proname = 'purgar_pedidos_anulados';
--
--   -- un solo job, a las 03:40
--   select jobid, schedule, command from cron.job where jobname = 'purgar-pedidos-anulados';


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 8. LIMPIEZA DE LOS PEDIDOS DE PRUEBA — EJECUTADO EL 11/09/2026
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Decisión del dueño, el mismo día: de los 26 pedidos que había en la base, los únicos reales eran
-- los DOS de ese día (#000042 y #000043, de Javier). Los otros 24 eran pruebas de la puesta en
-- marcha — del 31/08 al 10/09, varios con montos de siete cifras que ensuciaban todos los KPI.
--
-- No se borraron: se ANULARON, que es la única forma de sacarlos de las ventas dejando rastro de
-- que estuvieron. Ahora tienen su `anulado_srv_ts` y la purga se los lleva sola entre el 08 y el
-- 11/10/2026. Es, de paso, la primera corrida real del mecanismo que estrena este archivo.
--
-- Queda escrito y NO se re-ejecuta: correrlo de nuevo anularía los pedidos verdaderos que haya en
-- la base ese día. Está acá para que dentro de seis meses se pueda contestar por qué el histórico
-- arranca en el 11/09 y no en el 19/08.
--
--   update public.pedidos
--      set estado = 'Anulado',
--          motivo_anulacion = 'Pedido de prueba (limpieza 11/09/2026)',
--          anulado_por = '<el superadmin>',
--          anulado_ts = now()
--    where estado <> 'Anulado' and numero not in ('000042', '000043');
--   -- 20 filas. Con los 4 que ya estaban anulados: 24 en la papelera, 2 vivos.
