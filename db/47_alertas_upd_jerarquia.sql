-- ============================================================================================
-- 47 — `alertas_upd` obedece la jerarquía, igual que `alertas_sel`
-- 22/08/2026
--
-- ⚠️ NO APLICADO TODAVÍA. Va con el release 1.21.0, ANTES del bundle.
--
-- POR QUÉ
-- -------
-- `db/40` jerarquizó la LECTURA de los avisos (`alertas_sel` usa `ids_a_mi_cargo()`) pero **no tocó
-- `alertas_upd`**, que quedó como lo dejó `db/31`:
--
--     id_empresa = mi_empresa() and mi_rol() in ('admin','encargado')
--
-- Verificado contra la base viva el 22/08/2026: sigue así. O sea que un encargado puede marcar como
-- vista, por id, una alerta de alguien que **no tiene a su cargo y que ni siquiera puede leer**.
--
-- El impacto es bajo — lo único que ese UPDATE toca es `vista_por`/`vista_ts` — pero es exactamente
-- la asimetría entre `sel` y `upd` que el propio `db/40` declara importante al jerarquizar
-- `visitas_upd` junto con `visitas_sel`. Una policy de escritura más laxa que la de lectura es una
-- forma de enterarse de que algo existe: si escribir un id ajeno "funciona" y escribir uno inventado
-- falla, la diferencia es información.
--
-- Va junto con el arreglo de la Edge Function (`alertas-equipo`), que hasta hoy mandaba el push
-- ignorando la jerarquía mientras `alertas_sel` sí la aplicaba. Después de este archivo, las tres
-- capas —push, lectura y escritura— dicen lo mismo.
--
-- CÓMO SE APLICA
-- --------------
-- Con el MCP de Supabase (`apply_migration`), contra la base viva. **Nunca** `psql -f db/` (regla 5).
-- ============================================================================================

drop policy if exists alertas_upd on public.alertas_equipo;

create policy alertas_upd on public.alertas_equipo
  for update
  using (
    (select es_superadmin())
    or (
      id_empresa = (select mi_empresa())
      and (
        (select mi_rol()) = 'admin'
        -- El encargado, sólo sobre su gente. Subselect y no predicado escalar: así es InitPlan y se
        -- evalúa una vez, no por fila (regla 10).
        or ((select mi_rol()) = 'encargado' and id_usuario in (select ids_a_mi_cargo()))
      )
    )
  )
  with check (
    (select es_superadmin())
    or (
      id_empresa = (select mi_empresa())
      and (
        (select mi_rol()) = 'admin'
        or ((select mi_rol()) = 'encargado' and id_usuario in (select ids_a_mi_cargo()))
      )
    )
  );

-- VERIFICACIÓN (correr después de aplicar):
--
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'alertas_equipo';
--
-- `alertas_sel` y `alertas_upd` tienen que nombrar los dos a `ids_a_mi_cargo()`. Si sólo lo hace
-- uno, el arreglo no entró.
