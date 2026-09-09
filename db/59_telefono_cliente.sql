-- =============================================================================
--  db/59 — El cliente tiene TELEFONO, para que el vendedor lo registre (09/09/2026)
--
--  QUE RESUELVE
--  El vendedor esta parado frente al comercio y no tiene donde anotar el
--  contacto. Hoy `clientes` guarda localidad + lat/lng y nada mas: medido contra
--  la base viva el 09/09/2026, 2.016 clientes y CERO telefonos, porque la
--  columna no existe. La unica columna `telefono` de todo el esquema es la de
--  `perfiles` (el equipo propio), mas los dos `telefono_soporte` de `empresas` y
--  `app_config`.
--
--  🔑 POR QUE ESTA MIGRACION Y NO db/58. La 58 (04/09, sin aplicar) ya agrega
--  estas dos columnas, pero viene con todo el aparato del canal de WhatsApp:
--  `telefono_wa` generada, opt-in con fecha y origen, silencio del bot, y un
--  UNIQUE (id_empresa, telefono_wa). Eso pertenece a `canal-pedidos/`, que
--  todavia no esta versionado ni decidido. Esta migracion toma SOLO lo que el
--  vendedor necesita hoy. db/58 queda intacta y sigue siendo idempotente: sus
--  `add column if not exists` van a saltear estas dos y crear el resto.
--
--  ⚠️ EL UNIQUE DE db/58 SE DEJA AFUERA A PROPOSITO, Y NO ES UN OLVIDO. Un
--  indice unico sobre el numero da por sentado que un telefono pertenece a un
--  solo comercio, y en la calle no es cierto: el del local y el del dueño son el
--  mismo numero en dos fichas, y dos kioscos de la misma familia tambien. Con el
--  unique puesto, el segundo vendedor que anota ese numero recibe un rechazo de
--  la base — y como el guardado es offline-first, el error no aparece en la
--  pantalla sino tarde y fuera de contexto, con la mutacion mandada a cuarentena
--  por `writeQueue.js` con un console.warn que nadie mira. El dia que arranque
--  el bot habra que decidir eso de nuevo, con el dato ya cargado a la vista.
--
--  ⚠️ LA RLS NO SE TOCA, PORQUE YA ALCANZA. Verificado contra la base viva el
--  09/09/2026: `clientes_upd` acepta al rol `vendedor` (y `repartidor`) sobre
--  CUALQUIER cliente de su empresa, no solo los que tienen `id_vendedor =
--  auth.uid()`. Eso importa porque ~1.980 de los 2.016 clientes no tienen
--  vendedor asignado: con la policy vieja, el vendedor habria podido escribir el
--  telefono de casi ninguno. Postgres no discrimina por columna, asi que quien
--  ya puede hacer UPDATE de la fila puede escribir esta columna sin permiso
--  nuevo.
--
--  ⚠️ AL AGREGAR UN CAMPO DE CLIENTE HAY QUE TOCAR LAS LISTAS BLANCAS (regla 56,
--  la version de clientes): `mapCliente` y `addCliente`/`updateCliente` en
--  `context/CatalogContext.jsx`, y `features/admin/ImportarClientes.jsx`. Lo que
--  no este en esas listas se guarda en la base y no viaja, sin un solo error.
-- =============================================================================

begin;

-- ── 1) Las columnas ──────────────────────────────────────────────────────────
-- `telefono` es el numero como lo tipea una persona: no se normaliza ni se
-- valida. Un regex de telefonos argentinos rebota numeros legitimos (el 15
-- intercalado, los codigos de area de 2, 3 y 4 digitos, los locales sin area),
-- y el costo de rebotar es que el vendedor no anote nada. Normalizar es
-- problema del canal de WhatsApp, cuando exista.
alter table public.clientes
  add column if not exists telefono text,
  add column if not exists contacto text;

comment on column public.clientes.telefono is
  'Telefono del comercio como lo tipeo una persona. Para mostrar y para llamar. db/59.';
comment on column public.clientes.contacto is
  'Nombre de la persona con la que se habla en el comercio. db/59.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACION (correr despues de aplicar, contra la base viva)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Las columnas existen:
--    select column_name, data_type from information_schema.columns
--     where table_schema = 'public' and table_name = 'clientes'
--       and column_name in ('telefono', 'contacto');
--    -- esperado: dos filas, las dos `text`
--
-- 2) Cuantos se van cargando (arranca en 0 y es lo correcto):
--    select count(*) filter (where telefono is not null and telefono <> '') as con_telefono,
--           count(*)                                                        as total
--      from public.clientes where archivado_ts is null;
--
-- 3) La policy que lo sostiene, para no darla por sentada (regla: los .sql no
--    son fuente de verdad):
--    select polname, pg_get_expr(polqual, polrelid)
--      from pg_policy p join pg_class c on c.oid = p.polrelid
--     where c.relname = 'clientes' and polname = 'clientes_upd';
--    -- esperado: el array de roles incluye 'vendedor'
