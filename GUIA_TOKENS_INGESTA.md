# Guía de tokens de ingesta — emitir, revocar y sumar empresas

**29/08/2026 · documento INTERNO.** No va al cliente.

Todo lo que hay que saber sobre las llaves que dejan que un sistema externo escriba en DisT-At: el
del ERP que manda la lista de precios y el de los teléfonos que suben posiciones.

> ⚠️ **Este documento no contiene ningún token.** Explica cómo emitirlos y dónde viven. Los valores
> se leen una sola vez, al generarlos, y se entregan por canal privado (regla 25 de `CLAUDE.md`).

---

## 1. Qué es un token de ingesta

Es **una fila** en `public.ingesta_tokens`, y su columna `token` es un UUID. Eso es todo: no hay JWT,
no hay firma, no hay refresh. Un servidor externo lo manda en el header `Authorization: Bearer <uuid>`
y con eso el endpoint sabe **quién es y de qué empresa**.

```
token       uuid       la llave. Default gen_random_uuid()
id_usuario  uuid       a nombre de quién quedó emitida
id_empresa  uuid       🔑 de acá sale el alcance. NUNCA del payload
creado      timestamptz
revocado    boolean    default false
proposito   text       'gps' | 'precios'
```

### 🔑 La regla de oro: `id_empresa` sale del TOKEN, nunca del payload

Es lo que hace que esto sea seguro en un sistema multi-empresa. El archivo que manda el ERP **no
dice** a qué distribuidora pertenece, y aunque lo dijera, se ignora. La empresa se resuelve buscando
el token en la tabla. Un cliente **no puede** escribirle el catálogo a otro ni equivocándose ni
queriendo.

### Los dos propósitos, y por qué están separados

| Propósito | Quién lo usa | Qué puede escribir |
|---|---|---|
| `gps` | Los 13 teléfonos, vía `ingest-posiciones` | Sus propias posiciones |
| `precios` | El ERP del cliente, vía `ingest-precios` | El catálogo entero de su empresa |

`db/48` los separó a propósito: **un token de GPS no puede escribir precios**, y son dos superficies
muy distintas — una de ellas vive adentro de trece teléfonos que andan por la calle y se pierden.
El endpoint lo verifica explícitamente (`if (tk.proposito !== 'precios') return 401`).

---

## 2. ⏳ ¿Cuánto dura? — **No vence nunca**

**La tabla no tiene columna de expiración.** Verificado sobre la base viva el 29/08/2026: las columnas
son `token`, `id_usuario`, `id_empresa`, `creado`, `revocado`, `proposito`. No hay `expira_ts` ni nada
parecido.

O sea: **un token vale para siempre hasta que alguien lo revoque a mano.**

### Por qué está así, y por qué está bien para este caso

Un vencimiento automático suena más seguro, pero acá haría exactamente lo contrario de lo que uno
quiere: el envío del ERP dejaría de funcionar **un martes cualquiera a las seis de la mañana**, sin
que nadie tocara nada, y el síntoma sería un catálogo congelado que nadie mira. Un `401` sorpresa a
las 6 AM en el servidor de un cliente es peor que una llave larga.

La contrapartida es que **la seguridad depende de que la llave se cuide**, no de que caduque sola.
Por eso el token se entrega por canal privado, se guarda con permisos restringidos y `token.txt` está
en el `.gitignore` (este repo es público).

### Lo que sí conviene hacer

| Cuándo | Qué |
|---|---|
| Si se filtró o hay sospecha | Revocar **ya** (§4). No cuesta nada y el cliente lo nota enseguida |
| Si se va la persona que lo administraba del lado del cliente | Rotar |
| Rutina | Rotarlo una vez al año no está de más, pero **no es obligatorio** y no hay nada que lo fuerce |

⚠️ **Un token revocado NO deja de existir**: la fila queda con `revocado = true` y sigue ahí. Eso es
a propósito — sirve para auditar quién tuvo qué. Si de verdad hay que hacerlo desaparecer (por
ejemplo, porque el valor se filtró en un log), **hay que borrar la fila**, no sólo revocarla.

---

## 3. Emitir un token de precios

### 3.1 Por la app — **NO existe todavía**

`mi_token_ingesta('precios')` está en la base y funciona, pero **ninguna pantalla la llama**. El
teléfono llama a `mi_token_ingesta()` sin argumentos (para el de GPS), y eso es todo.

⚠️ **Y no se puede llamar desde el SQL editor de Supabase.** La función resuelve la identidad con
`auth.uid()`, que corriendo como `postgres` viene en `NULL`: tira `sin empresa` y confunde. Es la
trampa que hay que conocer.

### 3.2 Por SQL — **el camino real de hoy**

👉 **https://supabase.com/dashboard/project/lqhtxivednffpiicnbog/sql/new**

```sql
insert into public.ingesta_tokens (id_usuario, id_empresa, proposito)
select p.id, p.id_empresa, 'precios'
  from public.perfiles p
 where p.nombre = 'Supermercado La unión'
on conflict (id_usuario, proposito)
  do update set token = gen_random_uuid(), revocado = false
returning token as "PEGAR ESTO EN token.txt";
```

Devuelve **una línea con el token**. Ese valor se copia y se entrega por canal privado. No queda en
ningún archivo del repo.

### A nombre de quién conviene emitirlo

El `id_usuario` queda registrado como *"quién integró"* en la bitácora de cada envío
(`ingestas_precios.id_usuario`). Emitido a nombre de la cuenta que tiene el catálogo a cargo —
`Supermercado La unión`, rol `marketing` — esa bitácora se lee sola. A nombre del superadmin diría
"lo hizo Santiago" para siempre, aunque lo mande el ERP del cliente.

**Estado al 29/08/2026:** hay **1 token de precios activo**, a nombre de `Supermercado La unión
(marketing)`, empresa LA UNIÓN.

### Quién puede pedirlo (la guarda de `mi_token_ingesta`)

Sólo `admin`, `encargado`, `marketing`, `superadmin`, o quien tenga el permiso `catalogo`. Un
vendedor **no puede** emitirse un token de precios: escribiría el catálogo entero de la empresa. El
de GPS sí lo pide cualquiera, porque es su propio teléfono reportando su propia posición.

> ⚠️ Esa guarda vive en la **función**. Emitiendo por SQL como `postgres` uno se la saltea — así que
> el criterio de a quién emitirle queda en la cabeza de quien corre el `insert`. Es la razón por la
> que este documento existe.

### 🩸 La trampa del `on conflict`

El único es `(id_usuario, proposito)`, así que **una cuenta tiene UN token de precios y sólo uno**.

Correr `mi_token_ingesta('precios')` dos veces con el mismo usuario hace `do update set revocado =
false` y **devuelve el MISMO valor de antes** — no genera uno nuevo. Por eso el SQL de arriba fuerza
`token = gen_random_uuid()`: para que "generar" signifique de verdad generar.

Pasó en la práctica el 29/08: el token efímero de una prueba quedó atado al superadmin, y regenerar
con esa cuenta habría devuelto el valor ya conocido. Se borró la fila y se emitió limpio.

---

## 4. Revocar y rotar

**Revocar** (el envío del cliente empieza a dar `401` en la próxima corrida):

```sql
update public.ingesta_tokens
   set revocado = true
 where proposito = 'precios' and id_empresa = '<uuid de la empresa>';
```

**Rotar** (revocar el viejo y emitir uno nuevo en un solo movimiento): es el mismo `insert … on
conflict` del §3.2. El valor anterior deja de servir en el acto.

**Borrar** (sólo si el valor se filtró y hay que hacerlo desaparecer):

```sql
delete from public.ingesta_tokens
 where proposito = 'precios' and id_empresa = '<uuid de la empresa>';
```

> ✅ **Rotar es barato y se nota enseguida.** El cliente ve `401` en su registro en la próxima
> corrida y avisa. **No falla en silencio**, que es lo que importa.

---

## 5. 🟢 Una segunda empresa: SÍ se puede, y el bloqueante ya no existe

**Verificado sobre la base viva el 29/08/2026.** Esto estaba anotado como el impedimento para el
segundo cliente y **`db/48` lo resolvió**:

```
productos_codigo_norm_uidx  ON productos (id_empresa, codigo_norm)  ← por EMPRESA
clientes_codigo_norm_uidx   ON clientes  (id_empresa, codigo_norm)  ← por EMPRESA
```

Antes el único de `codigo` era **global**: si LA UNIÓN tenía el producto `0011`, ninguna otra empresa
podía tener un `0011`. **Ya no.** Dos distribuidoras pueden usar los mismos códigos sin pisarse.

### Cómo se suma una empresa nueva al envío automático

| # | Paso |
|---|---|
| 1 | Crear la fila en `empresas` |
| 2 | Crear al menos un usuario de esa empresa con rol `admin`, `marketing` o `encargado` (o permiso `catalogo`) |
| 3 | Emitir el token con el SQL del §3.2, cambiando el `where p.nombre` por el usuario de esa empresa |
| 4 | Mandarle el **mismo paquete** de documentos y scripts. La URL del endpoint es idéntica para todos |

### Lo que NO hay que hacer

- ❌ **No hace falta un endpoint nuevo, ni una URL distinta, ni desplegar nada.** La misma Edge
  Function atiende a todos: lo único que cambia es el token.
- ❌ **No hay que tocar `ingest-precios`.** Ni una línea.
- ❌ **No hay que preocuparse por el aislamiento.** `id_empresa` sale del token y la RPC
  `importar_precios` recibe `p_empresa` desde ahí, nunca del archivo.

### ⚠️ Tres cosas a tener en cuenta antes del segundo cliente

1. **`empresas.activo` no gatea nada.** Está escrito y se muestra, pero ninguna policy lo consulta.
   **Desactivar una empresa NO apaga su token**: si un cliente deja de pagar, hay que revocarle el
   token a mano. Hoy existe `Prueba SaaS` con `activo = false` y eso no significa nada técnicamente.
2. **El freno del 20 % de bajas es por empresa** y se calcula sobre el catálogo vigente de ESA
   empresa, así que funciona igual con dos. No hay nada que ajustar.
3. **Cada empresa necesita su propio recorrido de puesta en marcha** (primera carga a mano, revisión,
   y recién después el automático). El freno del 20 % va a rechazar la primera carga masiva **a
   propósito**, igual que con LA UNIÓN.

---

## 6. Auditoría — las consultas para revisar el estado

**Quién tiene tokens de precios, y desde cuándo:**

```sql
select e.nombre as empresa, p.nombre as usuario, p.rol,
       t.revocado,
       to_char(t.creado at time zone 'America/Argentina/Buenos_Aires','DD/MM/YYYY HH24:MI') as emitido
  from ingesta_tokens t
  join perfiles p on p.id = t.id_usuario
  join empresas e on e.id = t.id_empresa
 where t.proposito = 'precios'
 order by e.nombre;
```

**¿Está entrando la lista? (últimas 10 corridas):**

```sql
select e.nombre as empresa, i.origen,
       to_char(i.ts at time zone 'America/Argentina/Buenos_Aires','DD/MM HH24:MI') as cuando,
       i.recibidas, i.creados, i.actualizados, i.descontinuados,
       jsonb_array_length(i.rechazadas) as rechazadas, i.error
  from ingestas_precios i join empresas e on e.id = i.id_empresa
 order by i.ts desc limit 10;
```

**¿Hace cuánto que no entra nada?** (es lo mismo que mira la app para el cartel ámbar de 36 h):

```sql
select e.nombre,
       to_char(max(i.ts) at time zone 'America/Argentina/Buenos_Aires','DD/MM HH24:MI') as ultima,
       round(extract(epoch from (now() - max(i.ts)))/3600, 1) as horas
  from empresas e left join ingestas_precios i on i.id_empresa = e.id
 group by e.nombre;
```

---

## 7. Resumen en cuatro líneas

- **El token no vence.** Vale hasta que alguien lo revoque. Rotar es barato y el cliente lo nota.
- **Una cuenta = un token de precios.** Regenerar con la misma cuenta devuelve el mismo valor salvo
  que se fuerce `gen_random_uuid()`.
- **Una segunda empresa funciona sin tocar código**: mismo endpoint, otro token. El único global que
  lo bloqueaba se resolvió en `db/48`.
- **`empresas.activo` no apaga nada.** Cortarle el servicio a un cliente = revocarle el token.
