-- ============================================================================
-- 41 — La FOTO de un producto se protege con el mismo rol que la FILA
-- 18/08/2026
-- ============================================================================
--
-- 🩸 LA ASIMETRÍA. `productos_wr` (la tabla) exige rol:
--
--     mi_rol() in ('admin','encargado','marketing')  or  'catalogo' = any(mis_permisos())
--
-- pero la policy de Storage (`productos_avatares_del` / `_ins` / `_upd`) solo llamaba a
-- `puede_escribir_objeto`, que verificaba **la carpeta y nada más**. Resultado medido en la base
-- viva: un `vendedor` NO puede borrar un producto, pero SÍ puede borrar su foto — y también
-- reemplazarla por otra imagen. La fila estaba protegida y la foto no.
--
-- El aislamiento entre EMPRESAS nunca estuvo en duda (la carpeta es `<id_empresa>/…` y eso ya se
-- verificaba); lo que faltaba era el rol dentro de la propia empresa.
--
-- CONTEXTO DE POR QUÉ SE MIRÓ ESTO: el 18/08 aparecieron 626 fotos huérfanas contra 0 productos.
-- La causa NO fue esta asimetría —fue que borrar un producto nunca borró su foto, ver
-- `CatalogContext.deleteProducto`— pero al revisarlo salió esto al lado.
--
-- ⚠️ `avatares` NO cambia: ahí la regla correcta es "cada uno el suyo" (`split_part(name,'.',1) =
-- auth.uid()`), que no tiene nada que ver con el rol. Un vendedor tiene que poder cambiar su
-- propia foto de perfil.
--
-- ⚠️ Y `superadmin` sigue pasando por arriba de todo, igual que antes: es el que opera entre
-- empresas (y es el que acaba de limpiar las huérfanas).
--
-- Se reescribe la FUNCIÓN y no las policies: las tres (INSERT/UPDATE/DELETE) ya la invocan, así que
-- el arreglo llega a las tres sin tocarlas. Es también el motivo por el que existe la función.
-- ============================================================================

create or replace function public.puede_escribir_objeto(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'storage'
as $function$
  select case
    when public.es_superadmin() then true
    -- productos: la carpeta tiene que ser la empresa de quien escribe **y** el rol tiene que ser
    -- uno de los que pueden tocar el catálogo. Los mismos que `productos_wr`, sin excepción: si
    -- alguna vez se agrega un rol allá, hay que agregarlo acá — están a propósito enumerados en
    -- los dos lados y no en una función común, porque son dos preguntas distintas que HOY
    -- coinciden (quién edita la fila / quién edita el archivo).
    when p_bucket = 'productos' then
      (storage.foldername(p_name))[1] = public.mi_empresa()::text
      and (
        public.mi_rol() = any (array['admin','encargado','marketing'])
        or 'catalogo' = any (public.mis_permisos())
      )
    -- avatares: cada uno el suyo. Sin rol: cambiar la propia foto de perfil no es una capacidad
    -- del catálogo.
    when p_bucket = 'avatares' then split_part(p_name, '.', 1) = auth.uid()::text
    else false
  end
$function$;

-- Regla 7-bis: en una función nueva hay que revocar de los TRES. Acá es un `create or replace`
-- sobre una que ya existía, así que conserva su ACL — pero se deja escrito el estado esperado, que
-- es lo que se verifica abajo. `anon` tenía EXECUTE explícito (herencia del ALTER DEFAULT
-- PRIVILEGES de Supabase) y no lo necesita: ninguna policy de Storage es `to anon`.
revoke execute on function public.puede_escribir_objeto(text, text) from public;
revoke execute on function public.puede_escribir_objeto(text, text) from anon;
grant  execute on function public.puede_escribir_objeto(text, text) to authenticated;
grant  execute on function public.puede_escribir_objeto(text, text) to service_role;

-- Verificación (correr a mano, no es parte de la migración):
--   select proacl from pg_proc where proname = 'puede_escribir_objeto';
--     → debe quedar SIN `anon=X` y SIN el grant a PUBLIC.
--   Y con una sesión de rol `vendedor`, un DELETE sobre una foto de su propia empresa
--   tiene que fallar. Antes de esto, funcionaba.
