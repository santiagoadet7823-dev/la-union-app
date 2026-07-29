# 🚨 No ejecutar nada de esta carpeta

Estos archivos son **historia**, no instalador. Se movieron acá el 29/07/2026 justamente para que
nadie los corra por costumbre al ver una carpeta `db/` llena de `.sql` numerados.

## Por qué están apartados

`02_saas.sql` y `05_schema_real.sql` contienen **políticas RLS históricas inseguras**. Correrlos
sobre la base de hoy no "reinstala el esquema": **reemplaza políticas endurecidas por las viejas y
reabre los agujeros entre empresas**. Un `psql -f` distraído deja los datos de cada distribuidora a
la vista de las demás, y no avisa nada — termina sin error.

`05_schema_real.sql` además es un volcado de un estado que ya no existe: la base viva tiene columnas,
funciones e índices que se agregaron después y que este archivo desconoce.

## Qué hacer en su lugar

- **Para saber cómo está la base**: consultarla. El MCP de Supabase (`list_tables`, `execute_sql`,
  `get_advisors`). Nunca leer un `.sql` y asumir que eso es lo que está corriendo (regla 5).
- **Para cambiar algo**: un archivo **nuevo** con el número siguiente en `db/`, aplicado contra la
  base viva. No editar los existentes.
- **Si alguna vez hay que reconstruir desde cero**: no sirve esta carpeta. Hay que armar el orden a
  partir de la base viva, y `06_seguridad_fixes.sql` va **último** (regla 9).
