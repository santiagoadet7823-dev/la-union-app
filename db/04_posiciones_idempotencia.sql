-- ============================================================
-- LA UNIÓN — Idempotencia de posiciones (evitar duplicados)
--
-- Ya aplicado en la base (proyecto la-union-pwa). Se versiona acá para
-- reproducibilidad. Aditivo y seguro: columna nullable + índice único completo,
-- no rompe filas existentes (client_uid queda null en las viejas; los múltiples
-- NULL siguen permitidos porque en un índice único los NULL son distintos entre sí).
--
-- El cliente genera un client_uid (uuid) por cada fix GPS y la cola sube con
-- upsert(onConflict:'client_uid', ignoreDuplicates:true). Así, si un batch se
-- commitea pero se pierde la respuesta de red y se reintenta, las filas ya
-- insertadas se ignoran en vez de duplicarse.
-- ============================================================

alter table public.posiciones add column if not exists client_uid uuid;

-- OJO: el índice DEBE ser completo (sin WHERE). Un índice PARCIAL rompe el
-- upsert(onConflict:'client_uid') con error 42P10 (costó dos rebuilds el 14/07/2026).
drop index if exists posiciones_client_uid_uidx;
create unique index if not exists posiciones_client_uid_uidx on public.posiciones (client_uid);
