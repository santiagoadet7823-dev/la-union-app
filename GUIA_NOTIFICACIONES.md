# GUÍA — Notificaciones y avisos

Cómo funciona todo lo que le llega a un teléfono desde el servidor, y cómo se agrega un aviso nuevo.
Escrito el 22/08/2026 leyendo el código y la base viva, no de memoria.

> **Lo que hay que saber antes de leer el resto**, porque explica casi todas las decisiones raras:
>
> 1. **El push es el aviso; la campanita es el registro.** El push interrumpe y se pierde si el
>    teléfono estaba apagado. La lista de la campanita queda. Los dos tienen que existir siempre.
> 2. **La PWA NO tiene push.** No hay VAPID ni service worker de push en el repo — sólo caché
>    (`web/vite.config.js`). Un supervisor que trabaja desde la PC **sólo ve la campanita**. Eso no
>    es un pendiente: es el estado actual, y hay que tenerlo presente antes de prometer un aviso.
> 3. **Publicar no es entregar.** Un `{"enviados": 12, "fallidos": 0}` no significa que alguien lo
>    haya visto. El cierre se mira en `estado_dispositivo`.

---

## 1. Qué avisos existen hoy

Tres familias, ocho mensajes distintos.

### A · Vigilancia del equipo — los que le importan al supervisor

| Aviso | Qué lo dispara | Quién decide |
|---|---|---|
| **Sin reportar** — *"Sin reportar · Nelson"* | El teléfono lleva más de `alerta_silencio_min` (30 min por defecto) sin mandar ubicación, **dentro de la ventana de rastreo** | `vigilancia_equipo()` mide en SQL · `alertas-equipo` decide |
| **Quieto** — *"Quieto 2 h · Nelson"* | Sigue reportando pero no se movió hace más de `alerta_quieto_min` (120 min) | idem |
| **Agrupado** — *"3 móviles sin reportar"* | Se abren ≥2 incidentes en la misma pasada **para el mismo supervisor** | `alertas-equipo` |
| **Cierre** — *"Volvió a reportar"* / *"Se movió"* | El incidente dejó de corresponder **y ya se había avisado** | `alertas-equipo` |
| **Resumen por hora** — *"Equipo · 2 sin reportar"* | Cron horario | `alertas-equipo?resumen=1` |

Cuatro reglas de comportamiento que ya están decididas y **no hay que reimplementar**:

- **El antirrebote es un ÍNDICE, no lógica.** `alertas_equipo_abierta_uidx (id_usuario, tipo) where
  resuelta_ts is null`. Es lo que permite que el cron corra cada 10 min sin mandar 6 push por hora.
  No agregar un "ya avisé" adentro de la función: sería el mismo criterio en dos lugares, y ganaría
  el que se olvide de actualizarse (regla 33).
- **"Nunca arrancó" no interrumpe a nadie.** Quien no mandó un solo punto en el día no *dejó* de
  reportar. El incidente se abre igual (el panel lo muestra), pero sale sólo en el resumen. Es lo
  que convierte los 6 carteles de las 08:00 en una línea.
- **El sujeto nunca recibe su propio aviso.** Un encargado es a la vez supervisado y supervisor.
- **"Sin internet" no es un tipo de aviso**, es la columna `motivo` — lo explica el teléfono después.

### B · Actualización

| Aviso | Cuándo | Dónde |
|---|---|---|
| **Push "Actualización disponible"** | Cron horario, a los teléfonos con versión atrasada y sin sellar | `supabase/functions/push-actualizacion/` |
| **Notificación local "DisT-At 1.x actualizada"** | Cuando el bundle ya se descargó solo | `web/src/services/updateNotify.js` |
| **Cartel `UpdatePrompt`** | Al abrir la app | `web/src/components/UpdatePrompt.jsx` |

### C · Watchdog (invisible)

Un push **data-only** cada ~30 min, ventana 6–22 hora Salta, para despertar la app.
`supabase/functions/push-heartbeat/`. No dibuja nada. No filtra por empresa ni por rol, **y está
bien así**: va al dueño del teléfono, no a un supervisor.

---

## 2. El camino completo de un aviso

```
pg_cron  ──►  alertas-equipo (Edge Function)
                 │
                 ├─ 1. vigilancia_equipo()      ← SQL: MIDE. No decide nada.
                 ├─ 2. abre / cierra filas en alertas_equipo   ← el registro (campanita)
                 ├─ 3. resuelve DESTINATARIOS   ← la jerarquía (§3)
                 └─ 4. enviarPush() ──► FCM ──► teléfono
                                                  │
                            app en background ─────┤──► Android dibuja el cartel (canal "avisos")
                            app abierta ───────────┘──► lo dibuja la APP (push.js → AlarmWatchdog)
```

**La detección vive en SQL a propósito.** Así se verifica con un `select` contra la base viva, sin
desplegar nada y sin esperar un cron.

**Con la app abierta el cartel lo dibuja la app.** El plugin de Capacitor no postea nada al recibir
un push: se lo reenvía al JS. Hasta 1.9.0 `push.js` sólo miraba `tipo === 'actualizacion'`, así que
mientras el supervisor tenía la app abierta mirando el mapa —el caso más común— **los avisos se
perdían en silencio, contados como "enviados"** (regla 45).

### Archivos

| Pieza | Ruta |
|---|---|
| Medición | `db/26_alertas_equipo.sql` → `vigilancia_equipo()` |
| Decisión y envío | `supabase/functions/alertas-equipo/index.ts` |
| Firma y transporte FCM | `supabase/functions/alertas-equipo/fcm.ts` |
| Watchdog | `supabase/functions/push-heartbeat/index.ts` |
| Actualización | `supabase/functions/push-actualizacion/index.ts` |
| Recepción en el teléfono | `web/src/services/push.js` |
| Canales de Android | `web/android/app/src/main/java/com/launion/app/LaUnionApp.java` |
| Cartel con la app abierta | `.../AlarmWatchdogPlugin.java` → `notificar()` |
| Campanita (datos) | `web/src/hooks/useAlertasEquipo.js` |
| Campanita (UI) | `web/src/components/AlertasEquipo.jsx` |
| Dónde se monta | `SupervisionMovil.jsx` · `SupervisionDesktop.jsx` · `PanelDireccion.jsx` |

`getAccessToken` está **triplicado a propósito** (una copia por función). La nota del código dice que
si aparece una cuarta, va a `_shared/`.

---

## 3. Quién recibe qué — la jerarquía

### La regla, en un solo lugar

Vive en `ids_a_mi_cargo()` (`db/40_jerarquia_encargados.sql`), y dice:

| Rol | Ve / recibe avisos de |
|---|---|
| `superadmin` | Todos, de **todas** las empresas |
| `admin` | Toda su empresa |
| `encargado` | Su empresa **y** `nivel(sujeto) < greatest(nivel(encargado), 1)` |
| `vendedor` · `repartidor` · `marketing` | Sólo a sí mismos |

El `greatest(…, 1)` no es un detalle: un encargado al que nadie le asignó nivel queda en 0, y sin ese
piso no supervisaría ni a un vendedor. Hoy en la base hay exactamente ese caso.

### 🩸 El bug que se arregló el 22/08/2026

Hasta hoy **el push ignoraba la jerarquía y la campanita no**. `alertas-equipo` elegía destinatarios
sólo por `rol` + `activo`, y los filtraba sólo por `id_empresa`.

Lo grave no era que llegaran de más, sino esto: `alertas_sel` **sí** obedece `ids_a_mi_cargo()`. Así
que el encargado recibía *"Sin reportar · Fulano"*, tocaba el cartel, abría la campanita… y el aviso
no estaba. **El push estaba filtrando información que la policy protege.**

Ahora la Edge Function replica la regla invertida (`aCargo()` en `index.ts`): *"quiénes me ven"* en
vez de *"a quiénes veo"*. No puede llamar a la función SQL porque corre como `service_role`, que no
tiene sesión; por eso la regla está replicada, con la referencia al SQL que manda escrita al lado.
**Si `db/40` cambia, esto cambia.** La equivalencia se verificó contra la base viva: 95 pares
(supervisor × sujeto), 95 coincidencias, 0 diferencias.

Y el **agrupado y el resumen se calculan por DESTINATARIO, no por empresa**: decirle *"3 móviles sin
reportar"* a quien supervisa 1 es tan incorrecto como mandarle el aviso ajeno.

### ⚠️ El límite honesto, y es importante

**El modelo de hoy no puede expresar "los vendedores de tal encargado".** `nivel` es un **umbral**, no
una asignación: dos encargados del mismo nivel ven exactamente a la misma gente. No existe ninguna
columna que diga "este vendedor es del encargado X".

Medido con los perfiles reales de la base:

| Supervisor | Personas rastreadas a cargo (de 13) |
|---|---|
| `admin` (×2) | 12 |
| `superadmin` | 13 |
| `encargado` nivel 2 | 11 |
| `encargado` nivel 0 | 10 |

O sea: el arreglo **cierra el agujero de coherencia** —el push ya no dice cosas que la campanita
niega— pero **el recorte práctico es chico**, porque casi todo el mundo está en nivel 0.

Dos caminos, y los dos son decisiones de producto:

1. **Sin tocar código**: asignar niveles desde *Usuarios* (`UsuariosView`). Un encargado con nivel 1
   deja de recibir avisos de los otros encargados. Ojo: los **admin también están en nivel 0**, así
   que hoy un encargado recibe avisos del admin y del superadmin — subirles el nivel a ellos los saca.
2. **Con desarrollo**: agregar una asignación real (una columna `id_encargado` en `perfiles`, o usar
   `zonas.id_vendedor`, que ya existe). Es una migración más tocar las 9 policies que hoy usan
   `ids_a_mi_cargo()`. **Recién ahí "sus vendedores a cargo" se cumple literalmente.**

---

## 4. Cómo se agrega un aviso nuevo

Los pasos, en orden. Saltearse el 1 es el error clásico: el insert falla con **23514** y el aviso no
aparece nunca.

### Paso 1 — SQL (archivo `db/NN_*.sql` nuevo, número siguiente; NO editar los existentes)

1. **Ampliar el CHECK del tipo.** Hoy `alertas_equipo.tipo` acepta `sin_reportar` y `quieto`. Sin
   esto, el insert de la Edge Function revienta.
2. Si el aviso necesita una medición nueva, agregarla al `returns table` de `vigilancia_equipo()` y
   calcularla en el cuerpo. **La detección va en SQL**, no en TypeScript.
3. Si es un umbral configurable, va como columna de `app_config`.
4. Si creás una función `SECURITY DEFINER`: `revoke execute from public` **y de `anon` y de
   `authenticated`** (los tres — Supabase le da EXECUTE explícito a los dos últimos en cada función
   nueva, y un grant explícito no se va con un revoke a PUBLIC), después `grant to service_role`, y
   **verificar el ACL real** con `select proacl from pg_proc`. Es la regla 7-bis.
5. El **antirrebote no hay que tocarlo**: el índice único parcial cubre el tipo nuevo gratis.
6. La **jerarquía de lectura tampoco**: `alertas_sel` filtra por `id_usuario`, sin mirar el tipo.

### Paso 2 — La Edge Function (`alertas-equipo/index.ts`)

1. Agregar el campo a `interface FilaVigilancia`.
2. Agregar la condición al bloque `corresponde`.
3. Escribir el **título y el cuerpo**, y el texto de **cierre**.
4. Definir el `tag`: patrón `lu-alerta-{id_usuario}-{tipo}`. **El tag es lo que hace que reemplace en
   vez de apilar** — con un tag distinto por pasada, el supervisor termina el día con doce tarjetas
   casi iguales.
5. Si tiene que salir en el resumen, tocar `textoResumen()`.
6. **Los destinatarios no se tocan**: ya salen de `destinatariosDe()`, que aplica la jerarquía.

### Paso 3 — El cliente (bundle JS)

1. `web/src/components/AlertasEquipo.jsx` — hoy el tipo se resuelve con un **ternario binario**
   (`esSilencio ? … : …`). Un tercer tipo obliga a convertirlo en un mapa. Es el cambio más fácil de
   olvidar, y se ve como "el aviso llega pero se muestra mal".
2. `web/src/hooks/useAlertasEquipo.js` — sumar la columna nueva al `.select`, si el aviso trae datos
   nuevos.
3. `web/src/services/push.js` — **no hace falta tocarlo** si el `data.tipo` sigue siendo `alerta`.

### Paso 4 — Nativo (SÓLO si hace falta un canal nuevo)

Los canales se crean en `LaUnionApp.onCreate()`. Hoy hay dos: `avisos` (IMPORTANCE_HIGH) y
`actualizaciones` (DEFAULT).

- 🔴 **Un canal de Android es INMUTABLE una vez creado.** Si querés otra importancia, va un id nuevo;
  no se reusa uno existente.
- 🔴 **`channel_id` se manda SÓLO a los teléfonos que ya tienen ese canal.** Mandárselo a un APK
  viejo lo deja **mudo**: el canal no existe y Android 8+ descarta la notificación en silencio. Por
  eso se decide teléfono por teléfono, mirando `estado_dispositivo.app_version` contra `VER_CANAL`.
- Un canal nuevo significa **APK nuevo**, no OTA.

### Paso 5 — Desplegar, EN ESTE ORDEN

| # | Qué | Cómo |
|---|---|---|
| 1 | **SQL** | MCP de Supabase (`apply_migration`). **Nunca** `psql -f db/`. Va primero: la cola de escrituras del cliente corta al primer error, así que un insert contra columnas que no existen taponaría también el catálogo |
| 2 | **Edge Function** | `supabase functions deploy alertas-equipo` |
| 3 | **Cron**, si hace falta otra cadencia | `cron.schedule` derivado del job existente. ⚠️ `timeout_milliseconds := 60000` es **obligatorio**: el default de `pg_net` son 5 s y no alcanza |
| 4 | **OTA** (bundle) para la UI de la campanita | `bash scripts/ota-release.sh <ver>` + `update app_config …`. `CAP_BUILD=1` obligatorio |
| 5 | **APK**, sólo si tocaste `.java` o el manifest | |

### Paso 6 — Verificar (esto no es opcional)

1. **La detección, sin desplegar nada**: `select * from vigilancia_equipo()` con umbrales de prueba.
2. **La función, a mano**: invocarla y leer los contadores que ya devuelve —
   `{evaluados, abiertas, sin_push, cerradas, enviados, fallidos, omitidos, destinatarios, tokens_muertos}`.
   Viajan siempre a propósito: un tope o un fallo silencioso hace que esto parezca funcionar durante
   semanas.
3. **La jerarquía**: comprobar que un `encargado` de nivel bajo **no** recibe el aviso de alguien de
   nivel mayor, y que el agrupado que le llega cuenta sólo a su gente.
4. **El cierre del release se mira en `estado_dispositivo`**, no en la respuesta del push.

---

## 5. Los tropiezos que ya se pagaron

| Síntoma | Causa real |
|---|---|
| "No me llegan las notificaciones, y a los usuarios tampoco la de actualizar" | La app **no declaraba ningún canal**: FCM caía en "Miscellaneous", que varios fabricantes silencian de fábrica. Los dos avisos viajan por el mismo camino, por eso fallaron juntos |
| El supervisor con la app abierta no ve nada | Android sólo entrega el push al sistema con la app en **background**. Con la app abierta, el cartel lo tiene que dibujar la app |
| `fallidos` clavado en un número > 0 | **Tokens FCM muertos.** Ante 404 / `NotRegistered` hay que poner `fcm_token = null`. Un token muerto no se cura solo y deja el contador sucio — que es justo lo que hace que nadie note una falla real. Un fallo de **red** no cuenta como token muerto |
| El supervisor deja de ver a alguien, sin error | Un latido escribía `fcm_token = null` en cada arranque en frío y pisaba el token bueno. Si un valor puede ser *"todavía no sé"*, **se omite, no se manda null** |
| El cron responde 200 pero no hace nada | `timeout_milliseconds` quedó en el default (5 s) |
| "Ya publiqué y nadie lo tiene" | Avisar no es actualizar, y descargarse sola tampoco alcanza: la OTA se aplica en el **arranque en frío** |
| El teléfono no despierta nunca | Ni el push ni la alarma local vencen un **force-stop** ni a los killers de algunos fabricantes. Es un límite real, no un bug por arreglar |

---

## 6. Preguntas rápidas

**¿Puedo mandar un aviso a una sola persona?**
Sí: armá la lista con `destinatariosDe()` o a mano, y pasásela a `enviarA()`.

**¿Y a alguien que sólo usa la PWA?**
No por push (ver el punto 2 del encabezado). Le va a aparecer en la campanita cuando abra.

**¿Cuánto tarda en llegar?**
El cron de incidentes corre cada 10 min; el resumen, cada hora. Un aviso puede tardar hasta esos
10 min en salir, más lo que tarde FCM.

**¿Por qué el cron no está en ningún `.sql`?**
Porque el `cron.schedule` lleva la `service_role` key adentro y no se transcribe al repo (regla 25).
El estado real de los jobs se mira en `cron.job`, en la base viva.
