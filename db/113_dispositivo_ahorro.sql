create table if not exists public.dispositivo_ahorro (
  id_usuario        uuid primary key references public.perfiles(id) on delete cascade,
  id_empresa        uuid not null references public.empresas(id) on delete cascade,
  ahorro_energia    boolean not null,
  ahorro_gps_modo   integer,
  ahorro_apaga_gps  boolean,
  desde_ts          timestamptz not null default now(),
  ts                timestamptz not null default now()
);

create table if not exists public.dispositivo_ahorro_historial (
  id                bigint generated always as identity primary key,
  id_usuario        uuid not null references public.perfiles(id) on delete cascade,
  id_empresa        uuid not null references public.empresas(id) on delete cascade,
  ahorro_energia    boolean not null,
  ahorro_gps_modo   integer,
  ahorro_apaga_gps  boolean,
  ts                timestamptz not null default now()
);

create index if not exists dispositivo_ahorro_historial_usuario_ts_idx
  on public.dispositivo_ahorro_historial (id_usuario, ts desc);

alter table public.dispositivo_ahorro enable row level security;
alter table public.dispositivo_ahorro_historial enable row level security;

drop policy if exists dispositivo_ahorro_sel on public.dispositivo_ahorro;
create policy dispositivo_ahorro_sel on public.dispositivo_ahorro
  for select using (es_superadmin() or id_usuario = auth.uid());
drop policy if exists dispositivo_ahorro_ins on public.dispositivo_ahorro;
create policy dispositivo_ahorro_ins on public.dispositivo_ahorro
  for insert with check (id_usuario = auth.uid() and id_empresa = mi_empresa());
drop policy if exists dispositivo_ahorro_upd on public.dispositivo_ahorro;
create policy dispositivo_ahorro_upd on public.dispositivo_ahorro
  for update using (id_usuario = auth.uid()) with check (id_usuario = auth.uid() and id_empresa = mi_empresa());

drop policy if exists dispositivo_ahorro_historial_sel on public.dispositivo_ahorro_historial;
create policy dispositivo_ahorro_historial_sel on public.dispositivo_ahorro_historial
  for select using (es_superadmin());

revoke all on public.dispositivo_ahorro, public.dispositivo_ahorro_historial from anon;
revoke delete on public.dispositivo_ahorro from authenticated;
grant select, insert, update on public.dispositivo_ahorro to authenticated;
revoke all on public.dispositivo_ahorro_historial from authenticated;
grant select on public.dispositivo_ahorro_historial to authenticated;

create or replace function public.dispositivo_ahorro_desde()
returns trigger
language plpgsql
as $$
begin
  if new.ahorro_energia is not distinct from old.ahorro_energia
     and new.ahorro_gps_modo is not distinct from old.ahorro_gps_modo then
    new.desde_ts := old.desde_ts;
  else
    new.desde_ts := now();
  end if;
  return new;
end $$;

create or replace function public.dispositivo_ahorro_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.ahorro_energia is not distinct from old.ahorro_energia
     and new.ahorro_gps_modo is not distinct from old.ahorro_gps_modo then
    return null;
  end if;
  insert into public.dispositivo_ahorro_historial (id_usuario, id_empresa, ahorro_energia, ahorro_gps_modo, ahorro_apaga_gps)
  values (new.id_usuario, new.id_empresa, new.ahorro_energia, new.ahorro_gps_modo, new.ahorro_apaga_gps);
  return null;
end $$;

revoke all on function public.dispositivo_ahorro_cambio() from public, anon, authenticated;

drop trigger if exists dispositivo_ahorro_desde on public.dispositivo_ahorro;
create trigger dispositivo_ahorro_desde
  before update on public.dispositivo_ahorro
  for each row execute function public.dispositivo_ahorro_desde();

drop trigger if exists dispositivo_ahorro_cambio on public.dispositivo_ahorro;
create trigger dispositivo_ahorro_cambio
  after insert or update on public.dispositivo_ahorro
  for each row execute function public.dispositivo_ahorro_cambio();
