-- 79_codigos_registro.sql — Códigos de invitación de un solo uso para el registro propio.
-- 29/09/2026.
--
-- 🩸 POR QUÉ EXISTE. `registrar-usuario` (db/78, segunda tanda) nació con un código FIJO
-- compartido (un secret de la función, igual para todos). El dueño hizo la pregunta correcta: si
-- ese código lo terminan sabiendo los mismos vendedores, cualquiera que lo tenga puede seguir
-- creando cuentas pendientes para siempre — no expone datos (una cuenta pendiente no lee nada,
-- la RLS la bloquea entera), pero sí ensucia la cola de aprobación y consume cupo de usuarios sin
-- límite. La solución de fondo no es un código más largo: es que cada código sirva UNA sola vez.
--
-- Lo que agrega esta migración:
--   1) `codigos_registro` — un código por alta esperada, con vencimiento. Se marca `usado_ts` en
--      el mismo UPDATE que lo valida (WHERE usado_ts is null), así dos pedidos con el mismo código
--      llegando a la vez no pueden ganar los dos: el segundo encuentra 0 filas y falla.
--      Sin policies a propósito: NADIE entra acá por PostgREST, ni siquiera un admin leyendo. Se
--      genera con la RPC de abajo (SECURITY DEFINER) y se consume desde `registrar-usuario` con
--      la service_role key — las dos únicas puertas que existen.
--   2) `generar_codigo_registro(nota, dias_validez)` — la usa un admin/superadmin para armar un
--      código antes de pasárselo a la persona (por teléfono/WhatsApp). Válido 7 días por defecto.

create table public.codigos_registro (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null,
  creado_por         uuid references auth.users(id),
  creado_ts          timestamptz not null default now(),
  expira_ts          timestamptz not null,
  usado_ts           timestamptz,
  usuario_registrado text,
  nota               text
);
comment on table public.codigos_registro is
  'Códigos de invitación de un solo uso para registrar-usuario (db/79). Sin policies: solo entra service_role (la Edge Function) y la RPC generar_codigo_registro (SECURITY DEFINER). Nadie más, ni por REST ni por RLS.';

create unique index codigos_registro_codigo_key on public.codigos_registro (codigo);

alter table public.codigos_registro enable row level security;
-- enable row level security sin ninguna policy = deny total para anon/authenticated (regla del
-- proyecto para "nadie salvo service_role"). El revoke de abajo es cinturón y tirantes: aunque
-- alguna policy se agregue después sin querer, sin GRANT no hay con qué entrar.
revoke all on table public.codigos_registro from public;
revoke all on table public.codigos_registro from anon;
revoke all on table public.codigos_registro from authenticated;

create or replace function public.generar_codigo_registro(p_nota text default null, p_dias_validez int default 7)
returns table(codigo text, expira_ts timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
  v_codigo text;
begin
  select rol into v_rol from public.perfiles where id = auth.uid();
  if v_rol is distinct from 'admin' and v_rol is distinct from 'superadmin' then
    raise exception 'sin-permiso';
  end if;
  if p_dias_validez is null or p_dias_validez < 1 or p_dias_validez > 30 then
    raise exception 'dias-invalidos';
  end if;

  -- Dos bloques de 5 hex en mayúscula ("A1B2C-D3E4F"): el hexadecimal no tiene O/0/I/1/L
  -- ambiguos entre sí como base32/base36, más fácil de dictar por teléfono sin perder un carácter.
  loop
    v_codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5)) || '-' ||
                upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
    exit when not exists (select 1 from public.codigos_registro c where c.codigo = v_codigo);
  end loop;

  insert into public.codigos_registro (codigo, creado_por, expira_ts, nota)
  values (v_codigo, auth.uid(), now() + (p_dias_validez || ' days')::interval, p_nota);

  codigo := v_codigo;
  select c.expira_ts into expira_ts from public.codigos_registro c where c.codigo = v_codigo;
  return next;
end;
$$;

revoke execute on function public.generar_codigo_registro(text, int) from public;
revoke execute on function public.generar_codigo_registro(text, int) from anon;
grant execute on function public.generar_codigo_registro(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
--   select proacl from pg_proc where proname = 'generar_codigo_registro';
--   -- authenticated=X, SIN anon.
--
--   select tablename, policyname from pg_policies where tablename = 'codigos_registro';
--   -- 0 filas: sin policies, a propósito.
--
--   select has_table_privilege('anon', 'public.codigos_registro', 'SELECT');        -- false
--   select has_table_privilege('authenticated', 'public.codigos_registro', 'SELECT'); -- false
--
--   -- Como un vendedor (tiene que fallar con 'sin-permiso'):
--   -- select * from generar_codigo_registro('prueba') con un JWT de rol vendedor.
--
--   -- Como admin/superadmin, genera y lo deja listo para dictar:
--   -- select * from generar_codigo_registro('Juan, vendedor nuevo');
-- ─────────────────────────────────────────────────────────────────────────────
