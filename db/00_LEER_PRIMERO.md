# ⚠ LEER PRIMERO — antes de tocar cualquier archivo `db/*.sql`

**La base viva de Supabase (proyecto `la-union-pwa`) YA ESTÁ ENDURECIDA:** tiene
RLS activa y las políticas correctas. Varios archivos de esta carpeta contienen
políticas **históricas** que **NO reflejan la base actual**.

## No re-apliques esto sobre una base con datos

Los archivos:

- `02_saas.sql`
- `05_schema_real.sql`

contienen políticas viejas e inseguras. Si los re-corrés contra la base viva,
**dropean las políticas buenas y reabren agujeros de seguridad**. Ejemplos:

- `clientes_wr` está como `FOR ALL` con scope solo de tenant → deja que un
  **vendedor borre toda la cartera** de su empresa.
- `pedidos_upd` viejo no tiene `WITH CHECK` → permite **reasignar `id_empresa`**
  de un pedido a otro tenant.
- `items_wr` viejo tiene un `WITH CHECK` débil (solo valida tenant).
- El bucket `firmas` queda **público** con un `SELECT` amplio.

El archivo `06_seguridad_fixes.sql` es el que **cierra** todos esos agujeros y es
el que refleja el estado real de la base viva.

## Orden canónico (SOLO para una base NUEVA y vacía)

Para levantar una base desde cero, aplicar en este orden:

1. `schema.sql`
2. `02_saas.sql`
3. `03_retention.sql`
4. `04_posiciones_idempotencia.sql`
5. `05_schema_real.sql`
6. `06_seguridad_fixes.sql`  ← **imprescindible, va último y deja todo endurecido**

**Sobre la base viva (con datos): NO reaplicar 02 ni 05.** Si necesitás algún
cambio puntual, hacelo con una migración nueva y aditiva, no re-corriendo estos.

## Objetos que existen EN VIVO pero faltan en los `.sql`

El repo está incompleto respecto de la base real. Estos objetos existen en la
base viva pero no están versionados todavía:

- Tabla `recorridos_snap` (con único sobre `id_usuario, fecha`).
- Función `actualizar_mi_perfil(p_nombre, p_telefono)`.
- Columna `perfiles.telefono`.
- Columnas `empresas.base_lat` / `empresas.base_lng`.
- Columna `estado_dispositivo.cola_pendiente`.

Tenerlos presentes al reproducir la base o al escribir nuevas migraciones.
