-- 62_pedidos_erp.sql — el canal de salida de pedidos hacia el ERP de la distribuidora.
-- 10/09/2026.
--
-- 🩸 POR QUÉ EXISTE. La distribuidora factura y arma la logística desde su propio sistema de
-- gestión (el mismo servidor Java que ya nos manda la lista de precios por `ingest-precios`).
-- Hasta hoy la única salida era un botón que baja un `.txt` con un formato INVENTADO: se escribió
-- en agosto sin ver un archivo real, y así está declarado en `exportarPedidos.js`.
--
-- El 09/09/2026 llegó el archivo real (`20260909164538.txt`): 25 campos separados por TAB, sin fila
-- de encabezado, una fila por renglón. Al compararlo con el modelo aparecieron los huecos que esta
-- migración cierra:
--   · datos que el ERP espera y no capturábamos: forma de pago, fecha de entrega, observaciones;
--   · un límite de esquema: el archivo trae renglones de `0.5` y `cantidad` era `int`;
--   · el código de producto no se copiaba en la línea;
--   · no había forma de saber qué pedido ya se mandó.
--
-- 🔑 EL CURSOR ES UNA MARCA POR FILA (`exportado_ts`), NO UN "ÚLTIMO TIMESTAMP".
-- Ésta es la decisión de diseño de todo el canal. El vendedor toma pedidos sin señal y la cola los
-- sube cuando aparece: un pedido de las 09:00 puede llegar a la base a las 18:00, DESPUÉS del lote
-- de las 17:00. Con un cursor de tiempo ("mandame lo posterior a T") ese pedido no entra en ningún
-- lote nunca, y nadie se entera: el ERP factura de menos y los dos sistemas quedan sin cuadrar.
-- Con la marca por fila, entra solo en el lote siguiente. Es el mismo modo de falla del precedente
-- de 1.19.0 en CLAUDE.md ("publicar no es entregar").

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) LO QUE EL ERP PIDE Y NO TENÍAMOS
-- ─────────────────────────────────────────────────────────────────────────────

-- Campo 7 del archivo. Viene `3` fijo en el ejemplo y es el candidato firme a forma de pago, pero
-- 🔴 NO ESTÁ CONFIRMADO: los encabezados del archivo todavía no llegaron. Por eso es `text` y no un
-- enum ni un CHECK — no conocemos su tabla de códigos, y un CHECK con valores adivinados haría
-- fallar el alta de pedidos el día que nos pasen la lista buena.
alter table public.pedidos add column if not exists forma_pago text;

-- Campo 10. En el archivo real siempre es igual al campo 6 (la fecha del pedido), así que `null`
-- significa "misma fecha" y el exportador la resuelve. Es `date` y no `timestamptz`: el ERP sólo
-- usa el día, y guardar una hora inventada sería precisión falsa.
alter table public.pedidos add column if not exists fecha_entrega date;

-- Campo 14. Viene vacío en las 300 filas del ejemplo, pero es el único lugar del layout donde cabe
-- texto libre — y hoy el vendedor no tiene dónde anotar nada del pedido.
alter table public.pedidos add column if not exists observaciones text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) EL CURSOR DE EXPORTACIÓN
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.pedidos add column if not exists exportado_ts timestamptz;
alter table public.pedidos add column if not exists export_lote  bigint;

-- El índice que sostiene el canal entero: la consulta del lote es exactamente este predicado, y es
-- parcial a propósito — sólo indexa lo que todavía no se mandó, que son unas pocas filas contra una
-- tabla que crece para siempre.
create index if not exists pedidos_pendiente_export_idx
  on public.pedidos (id_empresa, created_at)
  where exportado_ts is null;

create index if not exists pedidos_export_lote_idx
  on public.pedidos (id_empresa, export_lote)
  where export_lote is not null;

/* 🔴 BACKFILL: LOS 23 PEDIDOS QUE YA EXISTEN SE MARCAN COMO YA ENVIADOS (lote 0).
 *
 * Sin esto, el primer GET del ERP se lleva TODO el histórico y le duplica la facturación de lo que
 * ya facturó a mano. "Ningún pedido viejo" es la única opción segura: los que estén sin facturar se
 * reponen a mano con `reponer_pedidos_para_export()`, que es una decisión consciente de alguien,
 * mientras que mandarlos todos sería una decisión de nadie.
 *
 * `export_lote = 0` los distingue de los lotes reales, que empiezan en 1. */
update public.pedidos
   set exportado_ts = now(), export_lote = 0
 where exportado_ts is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) LAS LÍNEAS
-- ─────────────────────────────────────────────────────────────────────────────

/* 🩸 CANTIDAD FRACCIONADA (campo 19). El archivo real trae dos renglones con `0.5` — media unidad
 * de los productos 1436 y 1437 en el pedido de las 09:11. Con `cantidad int` eso no se puede ni
 * cargar en la app, y el exportador además lo redondeaba a 1 al emitir (`numero(cantidad, 0)`),
 * que es peor: factura de más sin ningún error.
 *
 * `numeric(10,2)` y no `real`: es plata multiplicada por precio, y un flotante binario no puede
 * representar 0.1 exacto. Misma razón por la que `precio_unitario` ya era numeric. */
alter table public.pedido_items alter column cantidad type numeric(10,2);

-- Por coherencia: si se pueden pedir 0.5, se pueden entregar 0.5. Dejarla `int` haría que el
-- repartidor no pueda confirmar la entrega de un renglón fraccionado.
alter table public.pedido_items alter column cantidad_entregada type numeric(10,2);

/* Campo 18. Hasta hoy el código salía por relación viva (`producto:productos(codigo)` en
 * `usePedidos.js`) y no de la línea. Si el producto se borra del catálogo, la celda va VACÍA y el
 * ERP rechaza el renglón — de un comprobante que ya se vendió.
 *
 * Se copia al confirmar, exactamente igual que `descripcion` y `precio_unitario` (db/43): un
 * comprobante dice lo que se vendió, con el código que tenía cuando se vendió. */
alter table public.pedido_items add column if not exists codigo_producto text;

-- Backfill del histórico: los 53 renglones vivos tienen producto y todos tienen código.
update public.pedido_items i
   set codigo_producto = pr.codigo
  from public.productos pr
 where pr.id = i.id_producto
   and i.codigo_producto is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) CÓDIGOS DEL ERP QUE NO TENÍAMOS DÓNDE GUARDAR
-- ─────────────────────────────────────────────────────────────────────────────

-- Campo 3 del archivo (`002`, constante en todo el ejemplo). Puede ser el vendedor o la sucursal;
-- 🔴 no está confirmado. Si resulta ser el vendedor, se carga acá y el exportador lo usa; si
-- resulta ser la sucursal, esta columna queda sin uso y manda la constante de `empresas.export_erp`.
alter table public.perfiles add column if not exists codigo_erp text;

-- La condición de pago pactada con cada comercio. Sin esto el vendedor elige lo mismo 40 veces por
-- día, y a la cuadragésima elige mal.
alter table public.clientes add column if not exists forma_pago_default text;

/* 🔑 LAS CONSTANTES DEL LAYOUT NO SE HARDCODEAN.
 *
 * De los 25 campos, 11 son constantes cuyo significado NO conocemos (los encabezados del archivo no
 * llegaron). Escribirlas en el código significa que el día que el cliente diga "el campo 7 es la
 * forma de pago y contado es 1" haya que tocar el exportador, la Edge Function, y sacar un release
 * de APK para una app que anda en teléfonos que no siempre actualizan.
 *
 * Acá se cambian con un `update` y el efecto es inmediato en los dos runtimes. */
alter table public.empresas add column if not exists export_erp jsonb;

-- Los valores exactos del archivo real. `campo_3` queda como la constante observada; si se confirma
-- que es el vendedor, el exportador prefiere `perfiles.codigo_erp` cuando está cargado.
update public.empresas
   set export_erp = jsonb_build_object(
     'campo_2',  '1',
     'campo_3',  '002',
     'campo_5',  '0',
     'campo_8',  '1',
     'campo_11', '0',
     'campo_12', '0',
     'campo_13', '0',
     'campo_15', '0',
     'campo_16', '01',
     'campo_20', '1',
     'campo_22', '0',
     'campo_23', '1',
     'campo_24', '',
     'campo_25', 'SIN GRUPO',
     'forma_pago_default', '3',
     -- Cómo se emite el campo 1. 'epoch' = milisegundos de `created_at`, que es lo que su app de
     -- preventa manda hoy; 'numero' = nuestro correlativo de 6 dígitos. Ver `exportarPedidos.js`.
     'id_pedido', 'epoch',
     -- El ejemplo escribe `38000` y `7350.07`: decimales sólo cuando hacen falta.
     'decimales_fijos', false,
     /* 🩸 LA ZONA VA ACÁ Y NO SE DEDUCE DEL RUNTIME (10/09/2026, cazado ejecutando). El formateo
      * usaba "la hora local del que ejecuta": en el teléfono eso es Salta y estaba bien, pero el
      * runtime de la Edge Function es UTC — el canal automático emitió un pedido de las 22:33 como
      * "11/09/2026 01:33", con la fecha del día siguiente y por lo tanto en otro día de
      * facturación. Es la regla 23 entrando por la puerta de atrás. */
     'zona_horaria', 'America/Argentina/Salta'
   )
 where export_erp is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) UN PEDIDO YA FACTURADO NO SE REESCRIBE
-- ─────────────────────────────────────────────────────────────────────────────

/* 🩸 ACÁ HAY UNA TRAMPA, Y ES LA RAZÓN POR LA QUE ESTO NO SE HACE CON RLS.
 *
 * La idea original era endurecer `pedidos_upd` con `exportado_ts is null`. Eso ROMPE EL REPARTO
 * ENTERO: el pedido se exporta a facturación por la mañana y se entrega por la tarde, así que
 * después de exportado el repartidor todavía tiene que poder escribir `estado`, `ts_en_camino`,
 * `ts_entregado`, `cantidad_entregada` y `motivo_faltante`. Una policy de RLS decide por FILA, no
 * por columna, y no sabe distinguir "confirmar la entrega" de "cambiar lo que se vendió".
 *
 * Por eso el freno es un trigger que mira columna por columna: se congela lo que ya se facturó
 * —cliente, cantidades, precios, montos, forma de pago— y sigue abierto todo el circuito de
 * entrega. Y da un mensaje que se puede mostrar en pantalla, en vez de un 42501 de RLS que el
 * vendedor lee como "se rompió la app". */

create or replace function public.pedido_exportado_congelado()
returns trigger
language plpgsql
as $$
begin
  -- La compuerta de servicio: la RPC del canal y la de reposición la prenden con `set local`, así
  -- el trigger no se pelea con el proceso que justamente tiene que mover el cursor.
  if coalesce(current_setting('distat.export_bypass', true), '') = 'on' then return new; end if;

  if old.exportado_ts is null then return new; end if;

  if new.monto_total   is distinct from old.monto_total
  or new.peso_total    is distinct from old.peso_total
  or new.id_cliente    is distinct from old.id_cliente
  or new.id_vendedor   is distinct from old.id_vendedor
  or new.forma_pago    is distinct from old.forma_pago
  or new.fecha_entrega is distinct from old.fecha_entrega
  or new.observaciones is distinct from old.observaciones
  or (new.estado = 'Anulado' and old.estado is distinct from 'Anulado')
  then
    raise exception 'pedido-ya-exportado'
      using hint = 'Este pedido ya se envió a facturación. La corrección se hace en el sistema de gestión.';
  end if;

  -- El cursor no se edita desde la app. Si alguien lo pudiera poner en null a mano, el pedido se
  -- volvería a mandar y se facturaría dos veces.
  if new.exportado_ts is distinct from old.exportado_ts
  or new.export_lote  is distinct from old.export_lote
  then
    raise exception 'cursor-de-exportacion-no-editable';
  end if;

  return new;
end $$;

drop trigger if exists pedidos_exportado_congelado on public.pedidos;
create trigger pedidos_exportado_congelado
  before update on public.pedidos
  for each row execute function public.pedido_exportado_congelado();

create or replace function public.item_exportado_congelado()
returns trigger
language plpgsql
as $$
declare
  v_exportado timestamptz;
  v_fila public.pedido_items;
begin
  if coalesce(current_setting('distat.export_bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_fila := case when tg_op = 'DELETE' then old else new end;
  select p.exportado_ts into v_exportado from public.pedidos p where p.id = v_fila.id_pedido;
  if v_exportado is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Agregar o sacar un renglón de un pedido ya facturado cambia el comprobante entero.
  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'pedido-ya-exportado'
      using hint = 'Este pedido ya se envió a facturación. La corrección se hace en el sistema de gestión.';
  end if;

  -- En UPDATE sólo se congela lo vendido. `cantidad_entregada` y `motivo_faltante` quedan libres:
  -- son del repartidor, y el reparto pasa DESPUÉS de la facturación.
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
end $$;

drop trigger if exists items_exportado_congelado on public.pedido_items;
create trigger items_exportado_congelado
  before insert or update or delete on public.pedido_items
  for each row execute function public.item_exportado_congelado();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) LA BITÁCORA
-- ─────────────────────────────────────────────────────────────────────────────

/* Calcada de `ingestas_precios` (db/48) y `ingestas_emisor` (db/60), con la lección que dejó
 * escrita `ingest-precios/index.ts`: los rechazos TAMBIÉN dejan fila. Hasta el 09/09 los 400 se
 * devolvían antes de llegar a la RPC que escribía la bitácora, así que un emisor que fallaba todo
 * el tiempo no dejaba una sola marca — y "cero errores registrados" se leía como "está todo bien".
 *
 * `ids` es lo que permite REPONER un lote sin volver a mover el cursor. */
create table if not exists public.exportaciones_pedidos (
  id          uuid primary key default gen_random_uuid(),
  id_empresa  uuid not null references public.empresas(id) on delete cascade,
  id_usuario  uuid references public.perfiles(id),
  ts          timestamptz not null default now(),
  lote        bigint,
  pedidos     int  not null default 0,
  filas       int  not null default 0,
  ids         uuid[] not null default '{}',
  bytes       int,
  ip          text,
  agente      text,
  origen      text,          -- 'endpoint' | 'manual'
  error       text
);

create index if not exists exportaciones_pedidos_empresa_idx
  on public.exportaciones_pedidos (id_empresa, ts desc);
create unique index if not exists exportaciones_pedidos_lote_uidx
  on public.exportaciones_pedidos (id_empresa, lote) where lote is not null;

alter table public.exportaciones_pedidos enable row level security;

-- Lectura para quien puede ver los pedidos de la empresa. SIN policy de INSERT ni UPDATE, igual que
-- `ingestas_precios`: la escribe `service_role` desde la Edge Function y nadie más.
drop policy if exists exportaciones_pedidos_sel on public.exportaciones_pedidos;
create policy exportaciones_pedidos_sel on public.exportaciones_pedidos
  for select using (es_superadmin() or (id_empresa = mi_empresa() and es_admin()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) EL TOKEN
-- ─────────────────────────────────────────────────────────────────────────────

/* Un token de GPS no escribe precios y uno de precios no LEE la cartera de pedidos. Son tres
 * superficies distintas, y ésta es la más sensible de las tres: expone qué compró cada comercio y
 * a cuánto. */
alter table public.ingesta_tokens drop constraint if exists ingesta_tokens_proposito_chk;
alter table public.ingesta_tokens add constraint ingesta_tokens_proposito_chk
  check (proposito = any (array['gps','precios','pedidos']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) LA RPC QUE TOMA EL LOTE
-- ─────────────────────────────────────────────────────────────────────────────

/* 🔑 MARCAR Y DEVOLVER EN UN SOLO STATEMENT.
 *
 * El `update ... returning` es lo que hace que dos ejecuciones simultáneas del `.bat` del cliente no
 * puedan llevarse el mismo pedido dos veces ni partir un lote a la mitad. Un `select` seguido de un
 * `update` tendría una ventana entre los dos, y esa ventana es exactamente el bug que duplica
 * facturación.
 *
 * El advisory lock serializa la numeración del lote por empresa (y sólo por empresa: una
 * distribuidora no espera a la otra). Es por transacción, se suelta solo.
 *
 * `exists (pedido_items)` deja fuera las cabeceras cuyas líneas todavía están en la cola offline:
 * la cola es FIFO y sube la cabecera primero, así que hay una ventana real —de segundos, o de horas
 * si se cortó la señal en el medio— donde el pedido existe sin renglones. Mandar media factura es
 * peor que mandarla en el lote siguiente. */
create or replace function public.tomar_lote_pedidos(
  p_empresa uuid,
  p_usuario uuid default null,
  p_marcar  boolean default true
)
returns table (id_pedido uuid, lote bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote bigint;
begin
  perform set_config('distat.export_bypass', 'on', true);
  perform pg_advisory_xact_lock(hashtext('export_pedidos:' || p_empresa::text));

  select coalesce(max(e.lote), 0) + 1 into v_lote
    from public.exportaciones_pedidos e
   where e.id_empresa = p_empresa;

  if not p_marcar then
    -- `?probar=1`: arma el archivo sin tocar el cursor. Para la puesta en marcha, donde hace falta
    -- ver la salida real sin quemar los pedidos del día.
    return query
      select p.id, v_lote
        from public.pedidos p
       where p.id_empresa = p_empresa
         and p.exportado_ts is null
         and p.estado <> 'Anulado'
         and exists (select 1 from public.pedido_items i where i.id_pedido = p.id)
       order by p.created_at;
    return;
  end if;

  return query
    with tomados as (
      update public.pedidos p
         set exportado_ts = now(), export_lote = v_lote
       where p.id_empresa = p_empresa
         and p.exportado_ts is null
         and p.estado <> 'Anulado'
         and exists (select 1 from public.pedido_items i where i.id_pedido = p.id)
      returning p.id, p.created_at
    )
    select t.id, v_lote from tomados t order by t.created_at;
end $$;

revoke all on function public.tomar_lote_pedidos(uuid, uuid, boolean) from public, anon, authenticated;

/* REPONER. Para el caso "el GET salió bien pero el archivo se perdió del lado del cliente" (disco
 * lleno, proceso muerto, carpeta equivocada). Sin esto, esos pedidos no vuelven NUNCA: el cursor ya
 * avanzó y no hay nada en el layout que permita pedirlos de nuevo.
 *
 * No mueve el cursor: devuelve los ids que quedaron guardados en la bitácora. */
create or replace function public.pedidos_de_lote(p_empresa uuid, p_lote bigint)
returns table (id_pedido uuid)
language sql
security definer
set search_path = public
as $$
  select p.id
    from public.pedidos p
    join public.exportaciones_pedidos e
      on e.id_empresa = p_empresa and e.lote = p_lote and p.id = any (e.ids)
   order by p.created_at;
$$;

revoke all on function public.pedidos_de_lote(uuid, bigint) from public, anon, authenticated;

/* La vía de escape de soporte: devolver pedidos al estado "sin mandar" para que entren en el lote
 * siguiente. Es la contraparte del backfill del punto 2 — un pedido viejo que sí había que
 * facturar. Sólo superadmin, y deja su marca en la bitácora. */
create or replace function public.reponer_pedidos_para_export(p_ids uuid[], p_motivo text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_empresa uuid;
begin
  if not es_superadmin() then
    raise exception 'solo-superadmin';
  end if;
  perform set_config('distat.export_bypass', 'on', true);

  select p.id_empresa into v_empresa from public.pedidos p where p.id = any (p_ids) limit 1;

  update public.pedidos p
     set exportado_ts = null, export_lote = null
   where p.id = any (p_ids);
  get diagnostics v_n = row_count;

  insert into public.exportaciones_pedidos (id_empresa, id_usuario, pedidos, ids, origen, error)
  values (v_empresa, auth.uid(), v_n, p_ids, 'reposicion', p_motivo);

  return v_n;
end $$;

revoke all on function public.reponer_pedidos_para_export(uuid[], text) from public, anon;

commit;
