-- ⚠ VER db/00_LEER_PRIMERO.md ANTES DE APLICAR — puede reabrir agujeros de seguridad en una base con datos.
-- ============================================================
-- LA UNIÓN — Reconciliación del esquema real (reproducibilidad)
--
-- Estas tablas/columnas EXISTEN en la base viva (proyecto la-union-pwa) pero no
-- estaban documentadas en db/schema.sql / db/02_saas.sql. Este archivo las refleja
-- para que el repo sea reproducible. Todo es idempotente (create/add if not exists),
-- NO destructivo: correrlo sobre la base actual no cambia nada.
-- ============================================================

-- Columna accuracy en posiciones (el cliente la inserta desde hace tiempo).
alter table public.posiciones add column if not exists accuracy real;

-- Columnas de asignación en clientes (zona y vendedor dueño).
alter table public.clientes add column if not exists id_zona uuid;
alter table public.clientes add column if not exists id_vendedor uuid;

-- Zonas (agrupan la cartera por área).
create table if not exists public.zonas (
  id uuid primary key default gen_random_uuid(),
  id_empresa uuid,
  nombre text not null,
  color text,
  created_at timestamptz default now()
);

-- Estado de salud del dispositivo (informe "por qué no llega la señal").
-- id_usuario es la clave del upsert (onConflict: 'id_usuario').
create table if not exists public.estado_dispositivo (
  id_usuario uuid primary key,
  id_empresa uuid,
  rol text,
  app_version text,
  ts timestamptz,
  updated_at timestamptz,
  gps_ok boolean,
  gps_desde timestamptz,
  permiso text,
  visible boolean,
  bg_ok boolean
);

-- Cupo/heatmap de consultas de rutas.
create table if not exists public.consultas_rutas (
  id bigint generated always as identity primary key,
  id_empresa uuid,
  id_usuario uuid,
  id_vendedor uuid,
  ts timestamptz default now()
);

-- Config global de la app (OTA + ventana de rastreo). Fila única (id boolean = true).
create table if not exists public.app_config (
  id boolean primary key default true,
  latest_version text,
  min_version text,
  apk_url text,
  bundle_version text,
  bundle_url text,
  track_enabled boolean default true,
  track_start text default '07:30',
  track_end text default '22:00',
  updated_at timestamptz default now()
);
