-- =============================================================================
--  db/58 — El cliente tiene TELEFONO (04/09/2026)
--
--  QUE RESUELVE
--  El bot de pedidos por WhatsApp necesita el numero del comercio, y hoy
--  `clientes` no tiene donde guardarlo: no hay telefono, ni contacto, ni CUIT,
--  ni direccion. Solo `localidad` + lat/lng. Medido contra la base viva el
--  04/09/2026: 1.820 clientes activos, CERO numeros. Sin esta migracion no hay
--  nada que construir arriba.
--
--  🔴 LA TRAMPA QUE ESTA MIGRACION EXISTE PARA CERRAR: EL NUMERO QUE SE ESCRIBE
--  NO ES EL NUMERO QUE MANDA META. Un celular de Salta se anota como
--  "0387 15-4123456", "387 154123456" o "(0387) 4123456"; Meta lo entrega en el
--  webhook como `wa_id = 5493874123456`. Si guardamos el texto tal cual y
--  comparamos, NUNCA cruza: cada mensaje entrante seria de un desconocido y el
--  bot no sabria a que comercio pertenece.
--  Es exactamente la forma de `codigo_norm` (db/48): el dato como lo tipea una
--  persona, y al lado la version canonica contra la que se compara.
--
--  🩸 Y POR QUE LA NORMALIZACION NO ADIVINA. El "15" argentino es ambiguo: los
--  codigos de area tienen 2, 3 o 4 digitos, asi que separar area de abonado en
--  un numero suelto es una conjetura. Y conjeturar mal acá no es un numero feo:
--  es escribirle el pedido de un comercio al telefono de OTRO. Igual que el
--  parser de precios de la regla 54, `telefono_wa_norm` resuelve lo inequivoco
--  y devuelve NULL cuando no puede — el NULL es la cola de revision manual, no
--  un fracaso silencioso.
--
--  ⚠️ EL UNIQUE NO ES PARCIAL, A PROPOSITO (regla 6). Postgres ya trata los
--  NULL como distintos en un indice unico, asi que `(id_empresa, telefono_wa)`
--  admite todos los clientes sin numero que haga falta sin un `where`. No
--  agregarle uno: un indice unico parcial rompe cualquier `upsert` futuro con
--  onConflict, que es el bug 42P10 que se llevo dos rebuilds del APK.
--
--  ⚠️ AL AGREGAR UN CAMPO DE CLIENTE HAY QUE TOCAR LAS LISTAS BLANCAS (regla 56,
--  la version de clientes): `mapCliente` y `addCliente`/`updateCliente` en
--  `context/CatalogContext.jsx`, `features/admin/ImportarClientes.jsx`, la ficha
--  `features/admin/tabs/FichaCliente.jsx` y `catalog/NuevoCliente.jsx`. Lo que
--  no este en esas listas se guarda en la base y no viaja, sin un solo error.
-- =============================================================================

begin;

-- ── 1) Normalizacion a formato WhatsApp (E.164 sin '+') ──────────────────────
-- Devuelve NULL ante cualquier ambiguedad. Que devuelva NULL es una respuesta
-- valida y esperada: significa "esto lo tiene que mirar una persona".
create or replace function public.telefono_wa_norm(p_tel text)
returns text
language plpgsql
immutable
as $$
declare
  d text;
begin
  if p_tel is null then return null; end if;

  d := regexp_replace(p_tel, '[^0-9]', '', 'g');
  if d = '' then return null; end if;

  -- Ya viene internacional con el 9 de movil argentino: 549 + 10 digitos.
  if d ~ '^549[0-9]{10}$' then
    return d;
  end if;

  -- Internacional argentino SIN el 9 (fijo, o movil mal exportado): 54 + 10.
  -- Se le agrega el 9 porque WhatsApp en Argentina siempre lo lleva.
  if d ~ '^54[0-9]{10}$' then
    return '549' || substring(d from 3);
  end if;

  -- Nacional con 0 delante: 0 + area + abonado = 11 digitos.
  if d ~ '^0[0-9]{10}$' then
    return '549' || substring(d from 2);
  end if;

  -- Nacional pelado, 10 digitos (area + abonado, sin 0 y sin 15).
  if d ~ '^[0-9]{10}$' then
    return '549' || d;
  end if;

  -- Todo lo demas es ambiguo: el 15 intercalado, los locales de 6-8 digitos sin
  -- area, los numeros de otro pais. No se adivina.
  return null;
end;
$$;

comment on function public.telefono_wa_norm(text) is
  'Telefono argentino -> wa_id de Meta (549XXXXXXXXXX). NULL = ambiguo, revisar a mano. db/58.';

-- ── 2) Las columnas ──────────────────────────────────────────────────────────
alter table public.clientes
  add column if not exists telefono            text,
  add column if not exists contacto            text,
  -- Canonico para cruzar contra el webhook de Meta. Generada: no se puede
  -- desincronizar del telefono, igual que codigo_norm (db/48).
  add column if not exists telefono_wa         text
    generated always as (public.telefono_wa_norm(telefono)) stored,
  -- Consentimiento. Meta exige opt-in verificable para escribir primero, y
  -- "verificable" quiere decir con fecha y origen, no de palabra.
  add column if not exists opt_in_wa_ts        timestamptz,
  add column if not exists opt_in_origen       text,
  add column if not exists opt_in_por          uuid references public.perfiles(id) on delete set null,
  -- "Hoy no": silencia la campana proactiva hasta esta fecha. Sin esto, el
  -- quality rating del numero se cae y Meta baja el limite de mensajeria.
  add column if not exists bot_silencio_hasta  timestamptz;

comment on column public.clientes.telefono is
  'Telefono como lo tipeo una persona o lo mando el ERP. Para mostrar y para llamar.';
comment on column public.clientes.telefono_wa is
  'Generada: telefono en formato wa_id de Meta. NULL = no se pudo normalizar, revisar. db/58.';
comment on column public.clientes.opt_in_wa_ts is
  'Cuando este comercio acepto recibir mensajes. Sin esto NO se le manda una plantilla.';
comment on column public.clientes.bot_silencio_hasta is
  'El comercio pidio que no le escriban hasta esta fecha ("Hoy no").';

-- ── 3) Un numero pertenece a UN comercio ─────────────────────────────────────
-- Si dos clientes comparten telefono_wa, el bot no puede decidir a cual de los
-- dos escribirle el pedido. Que reviente en la importacion es MUY barato al
-- lado de descubrirlo con un pedido cargado al comercio equivocado.
create unique index if not exists clientes_telefono_wa_uidx
  on public.clientes (id_empresa, telefono_wa);

-- ── 4) Busqueda del cliente por su numero ────────────────────────────────────
-- Es la primera consulta de cada mensaje entrante: la cubre el unique de arriba.

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACION (correr despues de aplicar, contra la base viva)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) La normalizacion hace lo que dice, incluido devolver NULL:
--    select t, public.telefono_wa_norm(t) from (values
--      ('0387 15-4123456'), ('+54 9 387 412-3456'), ('3874123456'),
--      ('54 387 4123456'),  ('4123456'),           ('no tiene')
--    ) v(t);
--    -- esperado: los cuatro primeros -> 5493874123456 ; los dos ultimos -> NULL
--    -- ⚠️ '0387 15-4123456' son 12 digitos por el 15: cae en el NULL de revision.
--    --    Es el caso mas comun del pais y esta bien que se revise, no que se adivine.
-- 2) Cuantos quedaron sin cruzar despues de la carga del ERP:
--    select count(*) filter (where telefono is not null and telefono_wa is null) as a_revisar,
--           count(*) filter (where telefono_wa is not null)                      as listos
--    from public.clientes where activo and archivado_ts is null;
