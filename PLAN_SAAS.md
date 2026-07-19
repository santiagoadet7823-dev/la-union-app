# Plan de migración a SaaS — `corporaciones → empresas → datos`

> **Estado: DISEÑO. No se ejecutó nada.** Todo el SQL de este documento es propuesta.
> Fecha: 18/07/2026 · Complementa [CLAUDE.md](CLAUDE.md) e [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md).

---

## 0. Punto de partida — qué existe y qué no

**El filtro multi-tenant YA existe.** `empresas` es el tenant raíz, `id_empresa` está en todas las
tablas de datos, y las reglas del servidor (RLS) lo aplican. En la base viva hay **dos** empresas:

| empresa | usuarios | posiciones | |
|---|---|---|---|
| **LA UNIÓN** | 12 (incluido el único superadmin) | 3.956 | la real |
| **Distribuidora LA UNIÓN** | 0 | 0 | creada por error, vacía |

Lo que **no** existe es cómo pararse sobre otra empresa: `idEmpresa` sale del perfil
([AuthContext.jsx:205](src/context/AuthContext.jsx#L205)) y es **inmutable en runtime**. No hay
selector, ni override, ni parámetro de URL. Crear la segunda empresa y no ver nada es el
comportamiento esperado del diseño actual.

### Los cuatro problemas reales

1. **`empresas.activo` no gatea nada.** Se escribe, se muestra como chip, y **ninguna** regla RLS ni
   la puerta de entrada de [App.jsx:182-197](src/App.jsx#L182) lo consultan. Desactivar una empresa
   hoy no tiene ningún efecto. **La palanca de cobro del negocio está desconectada.**
2. **8-10 queries del frontend no filtran por `id_empresa`** y se apoyan en un RLS que para
   superadmin no filtra. Con un segundo tenant poblado, **mezclan datos de ambos**. Dos de esas
   fugas persisten **en disco**.
3. **No hay nivel de corporación** para agrupar varias distribuidoras de un mismo cliente.
4. **Cuotas, branding y ventana horaria no son por tenant** — no hay nada que vender diferenciado.

### Lo que ya está resuelto y conviene aprovechar

- La Edge Function **`snap-recorridos` ya soporta scope de superadmin**
  ([index.ts:103](supabase/functions/snap-recorridos/index.ts#L103) acepta `id_empresa` en el body);
  el frontend nunca se lo manda. **El contrato existe.**
- La caché de catálogo **ya está namespaceada por empresa** (`lu-catalogo-cache-<idEmpresa>`) y
  re-hidrata sola al cambiar la dependencia. Ese ya está bien.

---

## 1. Modelo de datos objetivo

```
corporaciones          ← el CLIENTE del SaaS: quien firma y paga
  └─ empresas          ← distribuidoras / sucursales operativas
       └─ zonas → clientes, usuarios, posiciones, …
```

### 1.1 Tabla `corporaciones`

```sql
create table if not exists public.corporaciones (
  id                    uuid primary key default gen_random_uuid(),
  nombre                text not null,
  slug                  text unique,                  -- subdominio / branding futuro
  -- Palanca comercial
  activo                boolean not null default false,
  plan                  text not null default 'basico'
                          check (plan in ('basico','pro','enterprise')),
  vence_el              date,                         -- null = sin vencimiento (cobro P2P)
  -- Límites del plan: esto es lo que se vende
  cuota_consultas_mes   integer not null default 5000,
  max_empresas          integer not null default 1,
  max_usuarios          integer not null default 15,
  retencion_dias        integer not null default 90,
  -- Branding
  logo_url              text,
  color_primario        text,
  nombre_comercial      text,                         -- reemplaza el literal "DisT-At"
  -- Contacto / operación
  contacto_nombre       text,
  contacto_email        text,
  contacto_telefono     text,
  timezone              text not null default 'America/Argentina/Salta',
  notas                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.corporaciones enable row level security;
```

**Por qué `retencion_dias` acá**: hoy la purga es global a 7 días (`db/03_retention.sql`). Con planes
distintos, la retención es una feature vendible. La columna cuesta cero ahora y una migración después.

**Por qué `timezone` acá**: `hoyStr()` está atada a la zona del dispositivo, y toda la lógica de días
asume UTC−3. Cuando entre un cliente en otra provincia, va a mentir. La columna no arregla nada por
sí sola, pero deja el dato donde va. **Deuda conocida: no se toca en esta migración.**

### 1.2 Vínculo con `empresas`

```sql
alter table public.empresas add column if not exists id_corporacion uuid
  references public.corporaciones(id) on delete restrict;
create index if not exists empresas_id_corporacion_idx on public.empresas(id_corporacion);
```

`on delete restrict` a propósito: borrar una corporación con empresas vivas debe fallar
ruidosamente, no cascadear datos de GPS al vacío.

Arranca **nullable**. El `NOT NULL` va en la última fase — ver §4.

### 1.3 ¿Dónde vive `activo`? **En ambos niveles, con AND**

| Nivel | Qué significa | Quién la toca |
|---|---|---|
| `corporaciones.activo` | **Palanca de cobro.** El contrato está al día o no. Apagarla corta todas las empresas del cliente. | Solo superadmin |
| `empresas.activo` | **Palanca operativa.** Esta sucursal está en uso (cerró, es de prueba, está migrando). | superadmin y `corp_admin` |

> **Acceso ⟺ `empresa.activo AND corporacion.activo`.**

Si `activo` viviera solo en corporación, no podrías apagar una sola sucursal de un cliente que paga
—y el caso "creé una empresa por error", que ya te pasó, no tendría más solución que borrarla. Si
viviera solo en empresa, cortarle a un cliente con 5 sucursales serían 5 clics y un olvido. Con las
dos y un AND, la palanca comercial es atómica y la operativa granular.

### 1.4 Cuotas: en la corporación

La cuota es propiedad del **contrato**, no de la sucursal. 5.000 consultas/mes se consumen entre
todas las empresas del cliente.

> Con una sola empresa por corporación el número que ve el admin es idéntico al de hoy, así que en la
> práctica el cambio no se nota. Pero conviene avisarlo.

Si más adelante hace falta sub-repartir, se agrega `empresas.cuota_consultas_mes_override` y se toma
`coalesce(override, corp.cuota)`. No ahora.

### 1.5 Ventana horaria de rastreo: **baja a `empresas`, con herencia**

```sql
alter table public.empresas      add column if not exists track_enabled boolean;
alter table public.empresas      add column if not exists track_start   text;
alter table public.empresas      add column if not exists track_end     text;
alter table public.corporaciones add column if not exists track_enabled boolean;
alter table public.corporaciones add column if not exists track_start   text;
alter table public.corporaciones add column if not exists track_end     text;
```

Todas **nullable a propósito**: `null` = "heredá del nivel de arriba". Resolución:
**empresa → corporación → `app_config` (default global)**.

El horario de rastreo es **operativo, no comercial**: dos sucursales en provincias distintas tienen
jornadas distintas. Ponerlo en corporación obliga a la unión de ambos horarios, o sea trackear de
más, que es exactamente lo que la feature intenta evitar. Pero la mayoría de los clientes va a tener
una sola política, y la herencia evita configurar N veces lo mismo.

`app_config` queda **solo con lo genuinamente global**: `latest_version`, `min_version`, `apk_url`,
`bundle_version`, `bundle_url` (el canal OTA es uno solo para todos). Las columnas `track_*` quedan
como fallback y **no se borran** (rollback barato).

Se expone por RPC para no hacer tres queries desde el cliente:

```sql
create or replace function public.mi_track_config()
returns table(enabled boolean, hora_inicio text, hora_fin text)
language sql security definer stable set search_path = public as $$
  select
    coalesce(e.track_enabled, c.track_enabled, a.track_enabled, true),
    coalesce(e.track_start,   c.track_start,   a.track_start,   '07:30'),
    coalesce(e.track_end,     c.track_end,     a.track_end,     '22:00')
  from public.perfiles p
  left join public.empresas e      on e.id = p.id_empresa
  left join public.corporaciones c on c.id = e.id_corporacion
  left join public.app_config a    on a.id = true
  where p.id = auth.uid();
$$;
revoke execute on function public.mi_track_config() from public;   -- CLAUDE.md regla 7
grant  execute on function public.mi_track_config() to authenticated;
```

Reemplaza la query de `services/tracking.js:15`. El cacheo de 4 min y `invalidarTrackCache()` se
mantienen tal cual.

### 1.6 Roles

```sql
-- Se agregan DOS: 'corp_admin' (nuevo) y 'propietario' (arregla el bug conocido).
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check
  check (rol in ('superadmin','corp_admin','admin','encargado',
                 'vendedor','repartidor','propietario'));
```

| Rol | Alcance | ¿Lo afecta la palanca `activo`? |
|---|---|---|
| `superadmin` | Todo el SaaS, todas las corporaciones | **No**, por diseño |
| `corp_admin` | Todas las empresas **activas** de su corporación | Sí |
| `admin` / `encargado` / `propietario` | Su empresa | Sí |
| `vendedor` / `repartidor` | Su empresa, filtrado a lo suyo | Sí |

---

## 2. Capa RLS — la parte delicada

### 2.1 El principio: una sola función de alcance

Hoy el patrón repetido mezcla dos cosas: "qué tenants puedo ver" y "qué puedo hacer dentro de un
tenant". Con corporaciones + `activo` en dos niveles, la primera parte se volvería una expresión de
cinco términos repetida en ~20 policies: inmantenible y, peor, imposible de auditar.

**Solución: una función que devuelve el conjunto de empresas visibles.**

```sql
create or replace function public.mi_corporacion() returns uuid
  language sql security definer stable set search_path = public as $$
  select coalesce(p.id_corporacion, e.id_corporacion)
    from public.perfiles p
    left join public.empresas e on e.id = p.id_empresa
   where p.id = auth.uid();
$$;

create or replace function public.empresas_visibles() returns setof uuid
  language sql security definer stable set search_path = public as $$
  select e.id
    from public.empresas e
    join public.corporaciones c on c.id = e.id_corporacion
   where e.activo
     and c.activo                              -- ← acá corta la palanca de cobro
     and (
          e.id = (select id_empresa from public.perfiles where id = auth.uid())
       or ( (select rol from public.perfiles where id = auth.uid()) = 'corp_admin'
            and e.id_corporacion = public.mi_corporacion() )
     );
$$;
```

Todas las policies pasan de:

```sql
es_superadmin() OR (id_empresa = mi_empresa() AND <cláusula de rol/propiedad>)
```

a:

```sql
es_superadmin() OR (id_empresa in (select public.empresas_visibles()) AND <la MISMA cláusula>)
```

**La cláusula de rol/propiedad no cambia en ninguna policy.** Solo se reemplaza el término de tenant
y se agrega `corp_admin` a los arrays de roles de gestión. El diff queda mecánico y revisable.

### 2.2 `es_superadmin()` no se toca

Deliberadamente. **Superadmin = operador del SaaS.** Sigue viendo todo, incluidas las corporaciones
suspendidas —si no, no podrías reactivarlas ni diagnosticar. Es la única pieza de la que dependen las
20 policies; cambiarla es el riesgo que no hace falta correr. El rol `corp_admin` entra por la vía de
`empresas_visibles()`, sin tocar ninguna función existente.

### 2.3 ⚠️ Trampas — leer antes de escribir el SQL

**(a) `in (select …)` y NUNCA un predicado escalar por fila.**
Postgres evalúa la subconsulta una sola vez (InitPlan). Si en su lugar se usara
`public.empresa_habilitada(id_empresa)` como predicado, se ejecuta **por fila**, y la paginación de
`useRecorridosDelDia` (1.000 filas × N páginas sobre `posiciones`) se vuelve inusable. **Es el error
de performance clásico al meter `activo` en RLS.**

**(b) La ventana entre crear la columna y hacer el backfill.**
`empresas_visibles()` hace `join corporaciones`. Con `id_corporacion` en null el join **excluye la
fila** → **acceso cero para todos los usuarios**. Por eso la verificación del backfill es bloqueante
antes de aplicar las policies. **Es el riesgo #1 de toda la migración.**

**(c) NO gatear `posiciones_ins` con `activo`.**
Si el insert empieza a fallar, la cola offline **reintenta indefinidamente** —por diseño, corta al
primer lote fallido y no pierde nada (CLAUDE.md §5). Los teléfonos acumularían puntos en SQLite para
siempre, quemando batería y datos, y al reactivar subirían todo de golpe con `ts` viejos.
**Suspender corta la LECTURA —que es el valor que se vende—, no la ingesta.** El costo de storage de
un tenant suspendido es marginal y la purga lo limpia sola.

**(d) `perfiles_sel` y la bandeja de pendientes.**
La policy viva incluye `OR id_empresa IS NULL`, que es lo que hace funcionar la bandeja de
"Pendientes de aprobación" de `UsuariosView`. Con dos tenants **es una fuga de datos personales**: el
admin de la corporación A ve los pendientes de la B. Quitarlo implica que **solo el superadmin vea
los pendientes sin empresa**.

> ⚠️ **Esto rompe un flujo que hoy funciona.** El admin de LA UNIÓN hoy da de alta usuarios solo;
> después de esta fase tendría que pedírtelo. Con 2 clientes es manejable; cuando sean 20 hay que
> implementar invitación por token (fase aparte, fuera de este plan). **Hay que avisarle antes, no
> después.**

**(e) El rollback se captura, no se escribe a mano.**

```sql
-- Ejecutar ANTES de aplicar, y pegar la salida como comentario al inicio del 08_.
select 'create policy ' || quote_ident(policyname) || ' on public.' || quote_ident(tablename)
       || ' for ' || cmd || ' using (' || qual || ')'
       || coalesce(' with check (' || with_check || ')','') || ';'
  from pg_policies where schemaname='public';
```

**(f) Las policies vivas mandan, no los `.sql`.** Antes de escribir el `08_`, listar
`pg_policies` y reescribir sobre **esas**. Los archivos `db/02` y `db/05` están desactualizados y
contienen versiones inseguras (CLAUDE.md regla 5).

### 2.4 Tablas afectadas

Mismo reemplazo en todas las que tienen `id_empresa`: `clientes`, `productos`, `zonas`, `pedidos`,
`pedido_items` (dentro del `exists` sobre `pedidos`), `posiciones`, `rutas`, `estado_dispositivo`,
`consultas_rutas`, `recorridos_snap`, `perfiles`.

⚠️ Al reescribir `pedidos_upd` e `items_wr`, **preservar el `with check` endurecido** de
`db/06_seguridad_fixes.sql:19-34`. Es el fix de seguridad que ya se aplicó; perderlo reabre la
reasignación de tenant.

Policies nuevas para `corporaciones` y ampliación de `empresas_sel` (para que el `corp_admin` vea sus
sucursales, incluidas las desactivadas — el corte de acceso a los **datos** ya lo hace
`empresas_visibles()`).

> **Recomendación**: agregar un trigger `before update` que rechace cambios en `empresas.activo` si
> el rol no es `superadmin`. Si no, un `corp_admin` puede reactivar una sucursal que vos
> desactivaste. Es la palanca de cobro: no la dejes en manos del cliente.

### 2.5 Checklist de reglas respetadas

- ✅ `revoke execute … from public`, nunca `from anon, authenticated` — aplica solo a las funciones
  **nuevas** que RLS no invoca (`mi_track_config`, `registrar_consulta_ruta`).
- ✅ **No se revoca EXECUTE** de `mi_empresa`, `mi_rol`, `es_admin`, `es_superadmin`, ni de las
  nuevas `mi_corporacion` y `empresas_visibles`. Operan sobre `auth.uid()`, que para anon es null →
  conjunto vacío. Exposición nula, aunque el linter de Supabase las marque.
- ✅ **No se toca ningún índice de `posiciones`.** El único índice nuevo es sobre `empresas`.
- ✅ Todo en archivos **nuevos** (`07_` en adelante). Cero ediciones a `02`, `05` o `06`.

---

## 3. Capa frontend

### 3.1 🚨 La regla arquitectónica

> **`AuthContext.idEmpresa` NUNCA cambia.** Es la empresa de **identidad** del usuario.
> El scope activo vive en un `TenantContext` nuevo y **solo lo consumen las rutas de LECTURA**.

Sin esta regla, `GpsContext.jsx:24,27` haría que un superadmin mirando otro tenant **escriba sus
propias posiciones dentro de ese tenant** — contaminación irreversible de los datos de producción de
un cliente con el GPS del operador del SaaS.

**`GpsContext.jsx` y `GpsGate.jsx` quedan explícitamente marcados como NO TOCAR.** Siguen leyendo
`useAuth()`, no `useTenant()`. Esa asimetría es intencional y hay que comentarla en el código.

### 3.2 `TenantContext`

```
{
  idEmpresaActiva,        // = idEmpresa de Auth, salvo override
  idCorporacionActiva,
  empresasDisponibles,    // [] para roles normales; N para superadmin / corp_admin
  puedeCambiarScope,      // rol in ('superadmin','corp_admin') && length > 1
  setEmpresaActiva,       // persiste + limpia cachés
  esOverride,             // true si != la propia -> badge visual obligatorio
  branding,               // { logoUrl, colorPrimario, nombreComercial }
}
```

Se monta entre `AuthProvider` y `CatalogProvider` en `App.jsx:199-213`. Persiste en
`lu-empresa-activa-<userId>` y se borra al cerrar sesión.

**Migración `useAuth().idEmpresa` → `useTenant().idEmpresaActiva`** en: `SupervisionDesktop`,
`SupervisionMovil`, `RecorridosView`, `ReplayJornada`, `ClientesTab`, `AdminView`, `UsuariosView`,
`CatalogContext`. `ConsultasView` pasa a `idCorporacionActiva` (la cuota es del contrato).

> **Recomendación**: si `esOverride`, **deshabilitar las acciones de alta**. Menos features, cero
> accidentes de cargar un cliente en el tenant equivocado.

### 3.3 Limpieza de cachés al cambiar de scope

`setEmpresaActiva()` debe hacer, **en este orden**, antes de propagar:

1. Borrar `lu-recorridos-cache` — ⚠️ **`useRecorridosDelDia.js:7` NO está namespeaceada por
   empresa** y **persiste en disco**. Es la fuga más peligrosa del selector. Arreglo de fondo:
   convertir la constante en `` (idEmpresa, fecha) => `lu-recorridos-cache-${idEmpresa}` ``.
2. Invalidar la caché de módulo de `usePerfilesEquipo.js:11-13` (TTL 60 s, sin clave de empresa):
   exportar un `invalidarPerfilesEquipo()`, mismo patrón que `invalidarTrackCache()`.
3. `invalidarTrackCache()` — la ventana horaria pasa a ser por empresa.
4. Bajar y volver a levantar el canal Realtime.
5. `lu-catalogo-cache-<idEmpresa>` **no hace falta tocarla** — ya está namespaceada. ✅

### 3.4 Las queries sin filtro

| # | Archivo:línea | Fix |
|---|---|---|
| 1-2 | `hooks/useEquipoEnVivo.js:26,37` | `.eq('id_empresa', …)` + agregar la dependencia al `useEffect` (hoy es `[]`) |
| 3 | `hooks/usePerfilesEquipo.js:17` | `.eq(…)` + cachear **por empresa** (`Map`, no variable suelta) |
| 4 | `supervision/components/EstadoEquipo.jsx:28` | `.eq(…)` — hay que pasarle la empresa o consumir `useTenant()` |
| 5-7 | `services/data/catalogo.js:17,18,19` | `fetchCatalogo(idEmpresa)` con `.eq(…)` en las tres. Cambia la firma |
| 8 | `services/sync/realtime.js:25-34` | canal por empresa + `filter: id_empresa=eq.<id>` del lado del servidor |
| 9 | `hooks/useRecorridosDelDia.js:7` | clave de caché namespaceada |
| 10 | `services/recorridos.js:19-21` | mandar `id_empresa` en el body (**el backend ya lo soporta**) |

> Estos fixes son **independientes de todo lo demás y valen por sí solos**: son la defensa en
> profundidad que hace que un error futuro en RLS no se convierta en una fuga.

### 3.5 Gate de `activo` — ⚠️ debe fallar ABIERTO

En `Gate()`, después de `if (!aprobado) return <PendienteView />`, agregar
`if (tenantSuspendido) return <SuspendidaView />`, alimentado por una RPC `mi_acceso()`.

> ⚠️ **Si la RPC no responde, NO bloquear.** El gate actual deja pasar con perfil cacheado para que
> el GPS arranque sin señal. Si este gate bloqueara ante fallo de red, **un vendedor en zona sin
> señal se queda afuera**. El gate es UX ("tu cuenta está suspendida"), **no** seguridad: la
> seguridad está en `empresas_visibles()`.

### 3.6 Branding por tenant

| Archivo:línea | Hoy | Después |
|---|---|---|
| `components/Logo.jsx:9` | `logo.png` fijo | `branding.logoUrl` **con `onError` → default** (sin fallback, un logo roto deja al cliente sin marca) |
| `components/AppShell.jsx:56` | literal `'DisT-At'` | `branding.nombreComercial ?? 'DisT-At'` |
| `components/AppShell.jsx:59` | literal `'Distribuidora · Anta'` | `empresa.nombre` |
| `services/report/rutaPng.js:149` | `'DisT-At'` estampado | ⚠️ **parámetro, no contexto** — es canvas imperativo fuera de React |
| `services/maps/index.js:6` | centro fijo en Las Lajitas | `empresas.base_lat/lng` → corporación → constante (el primer nivel ya existe) |

> ⚠️ `color_primario` implica inyectar una CSS var en runtime que consume **todo** `sx.js` y
> `glass.js`. Es el cambio de mayor superficie y el que más chances tiene de romper el contraste en
> modo oscuro. **Dejarlo para el final, o ofrecer solo logo + nombre en la v1.**

### 3.7 Cuotas server-side

Una RPC `registrar_consulta_ruta(p_id_vendedor)` `SECURITY DEFINER` que cuenta contra la cuota de la
corporación, inserta el registro y devuelve `{permitido, usadas, cuota}` **en una sola operación
atómica**. El frontend borra la constante `LIMITE_MENSUAL` y el conteo previo, y hace `await` de la
RPC **antes** de cargar el recorrido.

⚠️ Hay que **quitar la policy de INSERT** de `consultas_rutas` para el cliente, o el contador se
sigue pudiendo evadir. La RPC es `SECURITY DEFINER` y no la necesita.

---

## 4. Orden de ejecución

| # | Fase | Tipo | Downtime | Canal | Reversible |
|---|---|---|---|---|---|
| **1** | **Fix de las 10 queries + namespacing de cachés** | JS | No | OTA + push a `main` | Sí |
| 2 | `07_` corporaciones + `07b_` backfill (rename + borrado de la vacía) | SQL aditivo | No | — | Sí, total |
| 3 | `08_` reescritura RLS a `empresas_visibles()` (**sin** el `and activo`) | SQL policies | **Ventana** | — | Sí (bloque capturado) |
| 4 | `09_` activar el gate de `activo` | SQL, 1 función | No | — | Sí |
| 5 | `10_` tracking por tenant + `mi_track_config()` | SQL + JS | No | OTA | Sí |
| 6 | `11_` cuotas server-side | SQL + JS | No | OTA | Sí |
| 7 | `TenantContext` + selector + branding | JS | No | OTA + push | Sí |
| 8 | `07c_` `id_corporacion NOT NULL` | SQL | No | — | Sí |

**Por qué la Fase 1 va primero:** es el único problema **hoy explotable** con solo poblar la segunda
empresa, no depende de nada, y es la defensa en profundidad que evita que un error en la Fase 3 sea
catastrófico. Es además el único cambio que **mejora la seguridad sin tocar RLS**.
👉 **Si vas a hacer una sola cosa de todo este plan, hacé esta.**

**Por qué la 3 y la 4 van separadas:** la reescritura de policies es verificable con el tenant actual
(una sola corporación, todo activo → resultado idéntico al de hoy). Meterle `and activo` en el mismo
paso mezcla "¿reescribí bien?" con "¿la palanca funciona?". Separadas, si algo falla sabés cuál fue.

**Por qué la 8 va última:** el `NOT NULL` rompe el `insert` de `EmpresasView.jsx:70` (que solo manda
`{nombre, activo}`), y eso se arregla en la Fase 7.

### Downtime

**Solo la Fase 3 necesita ventana.** Los `drop policy` + `create policy` son transaccionales, pero
toman locks. Con 12 usuarios: elegir una hora **después de las 22:00** (fuera de la ventana de
rastreo) y aplicar todo el `08_` en **una sola transacción**. Si algo falla, `rollback` y no pasó
nada.

Las fases 1, 5, 6 y 7 son compatibles hacia atrás: **un teléfono con el bundle viejo sigue
funcionando** durante la transición.

### Canal de despliegue

**Nada de este plan requiere APK nuevo.** Todo es JS/SQL: cero cambios en `android/`,
`capacitor.config.ts`, plugins nativos o permisos.

Recordatorios (CLAUDE.md §3 y §6):
- `CAP_BUILD=1` antes de cualquier OTA, o pantalla blanca.
- Publicar OTA **no** actualiza la PWA. Las fases 1 y 7 tocan ambos canales → **dos acciones**.
- Bumpear `src/version.js` en cada OTA.

---

## 5. Verificación por fase

**Fase 1** — crear una empresa de prueba con 1 cliente y 1 posición ficticia. Como superadmin, abrir
Supervisión: **no deben aparecer**. Antes del fix aparecen mezclados.

**Fase 2 — BLOQUEANTE antes de la 3:**
```sql
select count(*) from public.empresas where id_corporacion is null;   -- DEBE ser 0
select e.nombre, e.activo, c.nombre as corp, c.activo
  from public.empresas e join public.corporaciones c on c.id = e.id_corporacion;
-- Debe haber exactamente 1 empresa: "Distribuidora LA UNIÓN", activa, corporación activa.
```

**Fase 3** — censo **antes y después**, con el mismo usuario y **un usuario de cada rol**:
```sql
select count(*) from public.clientes;     -- deben dar los MISMOS números
select count(*) from public.posiciones;   -- 3956
select count(*) from public.perfiles;     -- 12
-- Y el chequeo de CLAUDE.md regla 6:
select indexdef from pg_indexes
 where tablename='posiciones' and indexdef ilike '%client_uid%';
-- NO debe contener ' WHERE '. Si lo contiene, el GPS ya está roto.
```
En la app: que un vendedor siga viendo solo su cartera, que suban posiciones, cargar un cliente.

**Fase 4** — con la reversión escrita y lista **en la misma sesión**, y en horario sin uso:
```sql
update public.corporaciones set activo=false where slug='la-union';
-- Como admin:      select count(*) from clientes;  -> 0
-- Como superadmin: sigue viendo todo.
-- INSERT de posiciones: DEBE seguir funcionando (decisión §2.3c).
update public.corporaciones set activo=true  where slug='la-union';
```

**Fase 5** — `select * from mi_track_config();` como cada rol. Poner `track_start='23:00'` en una
empresa y confirmar que su móvil deja de publicar.

**Fase 6** — bajar la cuota a 2, hacer 3 replays: el tercero debe bloquear. Verificar que un
`insert into consultas_rutas` directo desde el cliente **falla**.

**Fase 7 — el test que valida la regla arquitectónica:** con dos tenants poblados, cambiar de scope y
confirmar que
```sql
select * from posiciones where id_empresa='<tenant-B>' and id_usuario='<superadmin>';
```
devuelve **0 filas** — el GPS del superadmin no contaminó el tenant B.

---

## 6. Dónde este diseño puede romper algo que hoy funciona

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | Ventana `07`→`08` con `id_corporacion` null → **acceso cero para todos** | Verificación bloqueante de la Fase 2 |
| 2 | `perfiles_sel` sin `id_empresa IS NULL` → el admin pierde la bandeja de pendientes | **Cambio de flujo real: avisar antes** |
| 3 | `empresas_visibles()` como predicado escalar → colapso de performance en `posiciones` | Siempre `in (select …)` |
| 4 | `activo` en `posiciones_ins` → cola offline reintentando para siempre | Decisión explícita de no gatear el insert |
| 5 | `NOT NULL` antes de arreglar `EmpresasView.jsx:70` → no se pueden crear empresas | Fase 8 va última |
| 6 | Selector sobrescribiendo `AuthContext.idEmpresa` → contaminación de GPS entre tenants | La regla de §3.1 |
| 7 | `lu-recorridos-cache` sin namespace → recorridos de dos tenants mezclados **en disco** | Fase 1, antes que el selector |
| 8 | Gate de `activo` bloqueante ante fallo de red → vendedor sin señal queda afuera | El gate falla **abierto** |
| 9 | `color_primario` como CSS var → contraste roto en modo oscuro en toda la app | Dejarlo último, o solo logo+nombre en v1 |

---

## 7. Nota de encuadre

Este plan monta la maquinaria de un SaaS de varios tenants sobre una base que hoy tiene **un solo
cliente real**. Eso es razonable si la venta a un segundo cliente está cerca; si no, buena parte de
esto es infraestructura por adelantado.

Las tres cosas que valen **independientemente** de cuándo llegue el segundo cliente:

1. **La Fase 1** (aislamiento de queries) — es corrección de bugs, no arquitectura.
2. **Conectar `empresas.activo`** — hoy tu palanca de cobro no existe, y eso importa con un cliente
   o con veinte.
3. **Las cuotas server-side** — hoy son evadibles y no se pueden vender diferenciadas.

El resto —corporaciones, `corp_admin`, branding, selector de scope— rinde recién con el segundo
cliente en la mano.
