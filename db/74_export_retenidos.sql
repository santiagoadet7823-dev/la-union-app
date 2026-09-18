-- 74_export_retenidos.sql — Un pedido que el ERP no puede facturar NO sale en el lote.
-- 18/09/2026.
--
-- 🔴 QUÉ PASÓ CON EL LOTE 3 (18/09 11:08, 19 pedidos). La administración lo recibió así:
--   · los 19 pedidos atribuidos a UN solo vendedor: el campo 3 del archivo salió `002` en todas
--     las filas —la constante `campo_3` de la empresa— porque NINGÚN perfil tenía código de
--     vendedor cargado (`perfiles.codigo_erp` ni `perfiles.numero`);
--   · el #000047 "sin cliente": tomado sobre un comercio creado desde el celular sin `codigo`, y el
--     campo 4 (código del cliente) salió vacío. El ERP lo mostró como un pedido más para facturar.
--
-- Las dos cosas son el mismo error de diseño: el archivo salía IGUAL con el dato y sin el dato. Un
-- pedido sin código de vendedor se factura y se comisiona a otro; uno sin código de cliente se
-- factura a nadie. Ninguno de los dos es un pedido que el ERP pueda consumir bien, así que desde
-- acá `tomar_lote_pedidos` no los toma: quedan con `exportado_ts null` y entran solos al lote
-- siguiente en cuanto alguien carga el dato (Usuarios → "Código ERP"; Clientes → código). El cursor
-- por fila de db/62 es justamente lo que permite retener sin perder nada.
--
-- La app los muestra como "Retenido · sin código de vendedor/cliente" (PedidosView), que es la
-- contracara de no mandarlos: nadie los pierde de vista.
--
-- El código de vendedor es `codigo_erp` si está cargado a mano, o `numero` con ceros a 3 dígitos
-- (lo que hace `codigoVendedorErp` en lib/asciiPedidos.js). Acá sólo importa que exista alguno.

/* "¿El ERP puede facturar este pedido?" — cliente con código Y vendedor con código. Es una función
 * aparte para que la RPC y cualquier consulta de control digan exactamente lo mismo. `stable` y
 * sin SECURITY DEFINER: la llama la RPC (que ya es definer) con su propio contexto. */
create or replace function public.pedido_exportable(p_cliente uuid, p_vendedor uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.clientes c
                  where c.id = p_cliente and coalesce(c.codigo, '') <> '')
     and exists (select 1 from public.perfiles v
                  where v.id = p_vendedor
                    and (coalesce(v.codigo_erp, '') <> '' or v.numero is not null));
$$;

create or replace function public.tomar_lote_pedidos(
  p_empresa uuid,
  p_usuario uuid default null,
  p_marcar  boolean default true
)
returns table (id_pedido uuid, lote bigint)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lote bigint;
begin
  perform set_config('distat.export_bypass', 'on', true);
  perform pg_advisory_xact_lock(hashtext('export_pedidos:' || p_empresa::text));

  select coalesce(max(e.lote), 0) + 1 into v_lote
    from public.exportaciones_pedidos e
   where e.id_empresa = p_empresa;

  -- Modo prueba: mira qué saldría, no marca ni reserva número. Sin bitácora, porque no pasó nada.
  if not p_marcar then
    return query
      select p.id, v_lote from public.pedidos p
       where p.id_empresa = p_empresa and p.exportado_ts is null
         and p.estado <> 'Anulado'
         and exists (select 1 from public.pedido_items i where i.id_pedido = p.id)
         and public.pedido_exportable(p.id_cliente, p.id_vendedor)
       order by p.created_at;
    return;
  end if;

  return query
    with tomados as (
      update public.pedidos p
         set exportado_ts = now(), export_lote = v_lote
       where p.id_empresa = p_empresa and p.exportado_ts is null
         and p.estado <> 'Anulado'
         and exists (select 1 from public.pedido_items i where i.id_pedido = p.id)
         and public.pedido_exportable(p.id_cliente, p.id_vendedor)
      returning p.id, p.created_at
    ),
    -- La fila de bitácora nace pegada al UPDATE (db/64): o hay lote y registro, o ninguno.
    registro as (
      insert into public.exportaciones_pedidos (id_empresa, id_usuario, lote, pedidos, ids, origen)
      select p_empresa, p_usuario, v_lote, count(*)::int, array_agg(t.id), 'endpoint'
        from tomados t
      having count(*) > 0
    )
    select t.id, v_lote from tomados t order by t.created_at;
end
$fn$;

revoke execute on function public.tomar_lote_pedidos(uuid, uuid, boolean) from public;
revoke execute on function public.tomar_lote_pedidos(uuid, uuid, boolean) from anon;
revoke execute on function public.tomar_lote_pedidos(uuid, uuid, boolean) from authenticated;
grant  execute on function public.tomar_lote_pedidos(uuid, uuid, boolean) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--   -- lo que saldría en el próximo lote (sin marcar nada):
--   select * from public.tomar_lote_pedidos('<id_empresa>', null, false);
--   -- los retenidos y por qué:
--   select p.numero, c.codigo as cliente, v.nombre as vendedor, v.numero, v.codigo_erp
--     from public.pedidos p
--     left join public.clientes c on c.id = p.id_cliente
--     left join public.perfiles v on v.id = p.id_vendedor
--    where p.exportado_ts is null and p.estado <> 'Anulado'
--      and not public.pedido_exportable(p.id_cliente, p.id_vendedor);
