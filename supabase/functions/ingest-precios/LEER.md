# ingest-precios — leer antes de desplegar

## La carpeta `lib/` es una COPIA. No la edites acá.

Los tres módulos de `lib/` (`texto.js`, `precios.js`, `planillaProductos.js`) son copias de
`web/src/lib/`. La fuente es esa; acá viven sólo porque el deploy de una Edge Function sube el
contenido de su propia carpeta y Deno no puede importar desde fuera.

**Antes de cada deploy:**

```bash
node scripts/sync-ingest-precios.mjs
```

Y para verificar sin copiar (CI, o antes de tocar nada):

```bash
node scripts/sync-ingest-precios.mjs --check
```

Por qué se comparte en vez de escribir un parser propio: el endpoint tiene que leer la planilla
**exactamente igual** que la pantalla de importación —mismos encabezados, mismo parser de números,
misma forma de armar una escala—. Dos implementaciones es la regla 36 de CLAUDE.md, y el día que
alguien agregue una columna la agrega en una sola.

⚠️ Los imports de esos módulos llevan `.js` explícito. Vite resuelve `from './texto'` sin extensión
y **Deno no**: sin la extensión el módulo carga perfecto en la app y la función revienta con
`ERR_MODULE_NOT_FOUND`. Ya pasó una vez.

---

## Dónde está cada archivo que mandó el ERP (db/90, 25/10/2026)

Cada envío, también los rechazados, se guarda **tal cual llegó** antes de parsearlo:

- **Servidor:** panel de Supabase → Storage → bucket `ingestas-precios` (privado) →
  `<id_empresa>/<AAAA-MM-DD>/<HH-MM-SS>-<sha>.csv`, hora de Argentina. `<sha>` son los 8 primeros
  caracteres del SHA-256 del archivo.
- **Disco:** `D:\Respaldos\precios\<AAAA-MM-DD>\`, copiado todas las noches a las 03:30 por
  `infra/selfhost/espejar_precios.sh` (cron de `distat`).
- Se guarda un año; después se borra del bucket y del disco.

Para cada envío, `ingestas_emisor` dice qué archivo es (`archivo`) y de dónde salió. Esos datos los
manda el agente del cliente en cabeceras: `ruta_origen` (ruta completa en su PC), `equipo`,
`version_agente`, `modificado_origen` y `sha256_cliente`. Hasta que La Unión instale el agente nuevo
(va por ZIP), esas cinco columnas quedan vacías; `archivo` y `sha256_servidor` se llenan igual.

```sql
select ts, resultado, equipo, ruta_origen, sha256_cliente = sha256_servidor as integro, archivo
  from ingestas_emisor order by ts desc limit 10;
```

Si `sha256_cliente` no coincide con lo recibido, el archivo llegó cortado: se responde
`400 archivo-incompleto` y **no se importa** (la copia queda igual en el bucket).

`?solo_config=1` (db/59) responde la config del token y no guarda archivo ni toca el catálogo.

---

## Verificado el 27-28/08/2026

Contra la base viva, con un producto de descarte (`ZZTEST9`) que se borró después:

| Caso | Resultado |
|---|---|
| Archivo tabulado real, decimales con coma (`1850,50`) | ✅ `creados: 1`, separador `\t` detectado |
| Cuerpo `application/json` | ✅ |
| Token inventado · sin token | ✅ `401 token-invalido` |
| Token de **GPS** intentando escribir precios | ✅ `401 token-sin-permiso-de-precios` |
| `?lista_completa=1` sobre 530 vigentes | ✅ **409**, `"No se escribio nada"`, y no escribió |
| Precio ambiguo (`1.450`) | ✅ campo rechazado con el nº de fila; el precio anterior **no** se pisó |
| Reenviar el mismo archivo | ✅ idempotente (`actualizados`, no `creados`) |
| Planilla de sólo `codigo` + `precio` | ✅ descripción, peso, marca y escalas intactos |

## Cómo emitir un token para el cliente

Lo mintea la RPC `mi_token_ingesta('precios')`, y sólo se lo puede pedir alguien que ya puede editar
el catálogo (`admin`, `encargado`, `marketing`, `superadmin`, o con el permiso `catalogo`). No hay
pantalla todavía: por ahora se pide desde la consola con la sesión de esa persona.

⚠️ El token identifica a la **empresa**. `id_empresa` sale de él y nunca del payload — es la regla de
oro heredada de `ingest-posiciones` y la razón por la que el cliente no puede escribirle el catálogo
a otra distribuidora.
