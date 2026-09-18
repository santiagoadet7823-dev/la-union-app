-- 73_zonas_abrev_hasta_4.sql — La abreviatura de zona admite de 2 a 4 caracteres.
-- 18/09/2026.
--
-- db/65 la fijó en EXACTAMENTE 2 ("LJ", "GA") pensando en que el chip del pin mide 25 px. Al cargar
-- las zonas reales apareció el caso que 2 letras no cubren: "Las Lajitas 1" y "Las Lajitas 2" son
-- dos zonas y con "LJ" sólo entra una; el cliente pidió "LJ1". Se abre a 4 como tope: 4 caracteres
-- a 7 px de mono son ~19 px y es lo último que entra en la cabeza del pin (`LeafletMap.tamGlifo`).
--
-- Sigue en mayúscula o dígito y sin acentos, por el mismo motivo que en db/65: que "lj1", "Lj1" y
-- "LJ1" no puedan convivir como tres abreviaturas distintas. El índice único por empresa
-- (`zonas_empresa_abrev_uidx`) no cambia. Las abreviaturas de 2 que ya existan siguen válidas.
--
-- ⚠️ Aplicar ANTES de publicar la app que deja escribir 3-4: con el check viejo el insert de "LJ1"
-- fallaría en la cola de escritura (23514) y la zona iría a cuarentena sin que la persona lo vea.

alter table public.zonas drop constraint if exists zonas_abrev_chk;
alter table public.zonas add constraint zonas_abrev_chk
  check (abrev is null or abrev ~ '^[A-Z0-9]{2,4}$');
