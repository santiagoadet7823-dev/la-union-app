-- 65_zonas_abrev.sql — Abreviatura de zona para el mapa.
-- 13/09/2026.
--
-- La capa de clientes del mapa de monitoreo dibujaba 686 puntos grises iguales: no se podía saber a
-- qué zona pertenece cada comercio. Cada zona lleva ahora una ABREVIATURA de dos caracteres (LJ, GA,
-- G1…) que el mapa pinta como chip al acercar el zoom, junto con el color de la zona.
--
-- Exactamente 2 caracteres en mayúscula o dígito: el check lo fuerza para que "lj", "Lj " y "LJ" no
-- puedan convivir como tres abreviaturas distintas. Única por empresa, como el número
-- (`zonas_empresa_numero_uidx`): dos zonas con la misma abreviatura harían inútil el chip.
--
-- SIN BACKFILL a propósito. Las iniciales automáticas chocan en la cartera real ("GAONA" y
-- "GONZALEZ A" dan las dos "GA"); la pantalla de Zonas sugiere una y la persona confirma.
--
-- No hace falta policy nueva: `zonas_wr` (FOR ALL) ya cubre la columna.

alter table public.zonas add column if not exists abrev text;

alter table public.zonas drop constraint if exists zonas_abrev_chk;
alter table public.zonas add constraint zonas_abrev_chk
  check (abrev is null or abrev ~ '^[A-Z0-9]{2}$');

create unique index if not exists zonas_empresa_abrev_uidx
  on public.zonas (id_empresa, abrev) where abrev is not null;
