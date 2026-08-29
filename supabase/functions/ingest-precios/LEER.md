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

## 🔴 PENDIENTE: la versión desplegada no es la de esta carpeta

**Estado al 28/08/2026.** La función está desplegada y **verificada de punta a punta** (archivo
tabulado real, decimales con coma, escalas, los cuatro caminos de error), pero se desplegó con
copias **condensadas** de los tres módulos —mismo comportamiento, comentarios recortados— antes de
que existiera el script de sincronización.

**No está en uso**: no hay ningún token con `proposito = 'precios'` emitido, así que hoy el endpoint
rechaza todo con 401.

**Antes de emitir el primer token, redesplegar desde esta carpeta** para que lo desplegado sea
idéntico al repo. Es el paso que cierra la última fuente de divergencia posible.

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
