# Documentación funcional — DisT-At

> Qué hace cada función de la app y a qué rol pertenece.
> Complementa [CLAUDE.md](CLAUDE.md) (reglas técnicas) e [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md)
> (arquitectura y deuda). Fecha: 18/07/2026 · `APP_VERSION 1.5.25`.

---

## 0. Lo primero que hay que entender

> **Hoy DisT-At es un sistema de RASTREO GPS + GESTIÓN DE CARTERA.**
> **Todavía NO es un sistema de ventas.**

Todo el eje pedidos → entregas → faltante está construido como interfaz, funciona al tocarlo, y
**no persiste nada**. Un vendedor puede hacer su jornada completa —check-in, carrito, confirmar
pedido— y al recargar la app no queda ningún rastro. Esta es la línea divisoria más importante del
producto y condiciona todo lo demás.

### Estado real de cada módulo

| Estado | Módulos |
|---|---|
| ✅ **REAL** (lee/escribe Supabase) | Login · Usuarios · Empresas · Zonas · Importar clientes · Clientes · Catálogo · Recorridos · Replay de jornada · Consultas · Estado del equipo · Supervisión móvil y escritorio · Alta de cliente/producto · Mi perfil · todo el pipeline GPS y de sincronización |
| ⚠️ **REAL pero SIN PERSISTENCIA** | Jornada del vendedor (check-in, visita, carrito, montos, sin-pedido) · Entregas del repartidor (estados + firma) |
| 🔶 **DEMO / estático** | Faltante · Ruteo · pestañas Dashboard y Órdenes · KPIs del propietario y de ambas supervisiones · el `DEPOSITO` de `demoGeo` en MapaOperativo |
| ⛔ **CÓDIGO MUERTO** (sin ruta de acceso) | `tabs/RuteoTab.jsx` (no lo importa nadie) · `vendedor/tabs/PerfilTab.jsx` (no está en la bottom-nav de `VendedorView.jsx:52`) · `AdminView` y `MapaOperativo` (solo alcanzables por un fallback que ningún rol activa) |

> **Nota sobre `PerfilTab`:** está muerto, pero **eso no deja al vendedor sin "Mi cuenta"**.
> `AppShell` envuelve toda la vista del vendedor y del repartidor ([App.jsx:168-178](src/App.jsx#L168))
> y monta `MiCuenta` en su topbar ([AppShell.jsx:6](src/components/AppShell.jsx#L6)). El menú de
> cuenta —Mi perfil, tema, cerrar sesión— **sí está disponible**. `PerfilTab` es una segunda
> implementación de lo mismo que quedó sin conectar.

---

## 1. Puerta de entrada

### Login — `features/auth/LoginView.jsx:17`
Única pantalla sin sesión. **Un solo botón: "Continuar con Google".** No hay usuario/contraseña.
Muestra el estado y el error de autenticación en pantalla, que sirve para diagnosticar en la APK
(donde el login nativo falla de formas opacas).

### Aprobación — `features/auth/PendienteView.jsx:9`
**Entrar con Google NO da acceso.** Crea una fila en `perfiles` con `rol = null` y `activo = false`
que un admin debe aprobar. Regla:

```
aprobado = activo && rol          (AuthContext.jsx:207)
```

Sin rol o inactivo → PendienteView, con botones "Ya me aprobaron — reintentar" y "Salir".

### Perfil offline-first
El perfil se cachea. Si hay caché se usa ya y se revalida en segundo plano. **Si la red falla pero
hay caché, no se marca error**: es preferible entrar con el perfil viejo que dejar a un vendedor sin
GPS al abrir la app sin señal. Al cerrar sesión la caché se borra, para que no se filtre a otra
cuenta en el mismo teléfono ([AuthContext.jsx:194](src/context/AuthContext.jsx#L194)).

### Quién ve qué — `decidirSupervisionMovil()` en [App.jsx:102](src/App.jsx#L102)

Es el **único lugar del sistema** que sabe esta regla.

| Rol | En APK (nativo) | En web / PWA |
|---|---|---|
| `vendedor` | AppShell + VendedorView (con GpsGate) | igual |
| `repartidor` | AppShell + RepartidorView (con GpsGate) | igual |
| `encargado` | switch: "Mi jornada" = VendedorView · "Panel" = SupervisiónMóvil | "Panel" = SupervisiónEscritorio |
| `admin` / `superadmin` | SupervisiónMóvil (siempre) | SupervisiónEscritorio |
| `propietario` | SupervisiónMóvil | **SupervisiónMóvil también** — el dueño usa el celular |

El switch del encargado se recuerda en `localStorage['lu-encargado-vista']`.

---

## 2. Rol VENDEDOR

Toda la máquina de estado de la jornada vive en `vendedor/useJornada.js:15`. Las pestañas son
presentación pura. **Nada de esto se guarda en la base.**

### Paso 1 · Inicio y check-in — `tabs/InicioTab.jsx:12`

El vendedor ve: fecha, **banner de GPS** (con botón "Activar GPS" si no hay fix), resumen del día
(Paradas X/Y · Pedidos · Monto), barra de progreso, meta diaria, efectividad, y su cartera.

Cada cliente lleva un badge: **Pendiente / Visitado / Sin pedido**. El primer pendiente se marca
"**Próxima parada**" y se resalta. Los clientes que cargó el vendedor y gestión todavía no confirmó
llevan el chip "**A CONFIRMAR**".

**"Check-in"** → arranca el cronómetro, vacía el carrito, salta a Catálogo y avisa
*"Check-in registrado en el comercio"*.

> **Regla no obvia**: el botón de editar cliente solo aparece si el cliente es suyo
> (`InicioTab.jsx:116`). Se espeja la regla del servidor para no ofrecer un "guardar" que la base
> va a rechazar.

### Paso 2 · La visita — `tabs/VisitaCatalogo.jsx:10`

Header con punto pulsante "VISITA EN CURSO", **cronómetro mm:ss**, nombre del comercio, y dos
salidas: "Sin pedido" y "Cancelar".

Sin visita activa el catálogo se puede navegar en "**Modo consulta**", pero no se puede cerrar un
pedido. Productos agrupados por categoría, buscador, stepper por producto, y una **barra de carrito
flotante** con `N ítems · X kg · $Total` (kg y total derivados de `peso_kg` y `precio_unitario`).

"Confirmar pedido y finalizar visita" cierra la visita como `visitado` con su monto. Sin check-in el
botón se reemplaza por el aviso *"Hacé check-in para confirmar el pedido"*.

### Paso 3 · Sin pedido — `tabs/SinPedidoSheet.jsx:11`

Cartel centrado con **4 motivos fijos**: Stock suficiente · Precio/condición · Comercio cerrado ·
Otro. El motivo es obligatorio.

### Paso 4 · Ruta — `tabs/RutaTab.jsx:16`

Mapa de 70vh con los clientes coloreados por estado y la posición GPS en vivo.
**"Calcular ruta óptima"** ordena **solo las paradas pendientes** por camino más corto siguiendo
calles, desde la ubicación actual y sin volver al inicio. Muestra km, minutos y "N paradas · orden
óptimo". Sin conexión cae a línea recta, avisándolo.

### El cierre de jornada no existe

`PerfilTab.jsx:66` tiene el botón "Cerrar jornada", pero **solo dispara un toast** y esa pantalla ni
siquiera está ruteada. No hay cierre de jornada real.

### Qué escribe realmente un vendedor

| Se guarda | No se guarda |
|---|---|
| Posición GPS (`posiciones`) | Visitas |
| Latido de salud (`estado_dispositivo`) | Pedidos y montos |
| Alta de cliente (`clientes`, `activo=false`) | Carrito |
| Edición de ubicación y días de sus clientes | Motivos de "sin pedido" |

### Reglas de negocio del vendedor

- **Meta diaria: $900.000 hardcodeada** (`useJornada.js:85`) — igual para todos los vendedores de
  todas las empresas.
- **Efectividad = pedidos / visitas cerradas**, no sobre el total de la cartera.
- Un cliente cargado por un rol móvil nace **sin confirmar** (`activo=false`) y a nombre de quien lo
  cargó.
- **Cancelar una visita no deja rastro**: no queda registro de que el vendedor entró y salió.

---

## 3. Rol REPARTIDOR — `features/repartidor/RepartidorView.jsx:13`

**Hoy es, en la práctica, un rastreador GPS con una interfaz de entregas inactiva.**

La lista `deliveries` arranca vacía y **nunca se llena** (`:15`): las entregas llegarían de los
pedidos asignados, que son parte del módulo de ventas que todavía no existe. En producción el
repartidor **siempre** ve el estado vacío: *"No tenés entregas asignadas… Mientras, tu ubicación se
envía en vivo al panel."*

El circuito está construido y funciona si hubiera datos:

1. **Pendiente → "Marcar en camino" → En camino → "Confirmar entrega"**.
2. **Paso 1 · Verificación de cantidades**: stepper por ítem con tope en lo pedido —no se puede
   entregar de más. Si se entrega de menos, aparece un **selector de motivo obligatorio** (Sin stock
   / Rechazado / Otro) que alimentaría el reporte de faltante.
3. **Paso 2 · Firma de conformidad**: canvas de firma; el botón de confirmar queda deshabilitado
   hasta que haya trazo.

Su único aporte real al sistema hoy es su posición y su latido de salud.

---

## 4. Rol ENCARGADO — el rol dual

Es el único rol que **se trackea y supervisa al mismo tiempo**:

- **Se trackea**: entra en `esMovil` ([GpsContext.jsx:19](src/context/GpsContext.jsx#L19)), así que
  publica posición aunque esté en modo "Panel".
- **Supervisa**: accede a Clientes, Zonas, Catálogo, Faltante y Consultas. **No** a Usuarios ni a
  Empresas.
- **Carga clientes como preventista**: sus altas quedan sin confirmar y a su nombre.
- **Pero edita y borra clientes a profundidad**, como gestión.
- Alterna con el ítem "Ir a mi jornada" del menú de cuenta.

---

## 5. Roles ADMIN y SUPERADMIN

### Permisos de menú

⚠️ Esta tabla está **duplicada** en `SupervisionMovil.jsx:78-84` y `SupervisionDesktop.jsx:67-73`.
**Cambiar una sin la otra hace divergir los permisos en silencio.**

| Vista | encargado | admin | superadmin | propietario |
|---|---|---|---|---|
| Clientes · Zonas · Catálogo · Faltante · Consultas | ✅ | ✅ | ✅ | ❌ |
| Usuarios | ❌ | ✅ | ✅ | ❌ |
| Empresas | ❌ | ❌ | ✅ | ❌ |

Al propietario se le corta el menú **explícitamente** (`isProp ? [] : …`), no por omisión — depender
de que un rol no figure en ningún array es una invariante que se rompe sola al agregar un ítem.

### Usuarios — `admin/UsuariosView.jsx:70` · admin + superadmin

Tabla dividida en "**Pendientes de aprobación**" y "**Habilitados**". Se asigna rol, **código de
vendedor** (`numero`, ej. 1 = Zona 1) y, si sos superadmin, la empresa. "Aprobar" activa la cuenta.

- Roles asignables: admin ve `[vendedor, repartidor, encargado, admin]`; superadmin suma
  `superadmin`. **`propietario` no figura en ninguna lista** — hoy no se puede dar de alta un
  propietario desde la app (ver §8).
- No podés desactivarte a vos mismo. No se aprueba sin rol ni sin empresa.

### Empresas — `admin/EmpresasView.jsx:17` · solo superadmin

Tres funciones distintas conviven en esta pantalla:

1. **Ventana horaria de rastreo GPS** — checkbox + Desde/Hasta, default **07:30–22:00**.
   ⚠️ **Es GLOBAL a todas las empresas**, no por tenant, aunque viva en la pantalla "Empresas".
   Fuera de esa franja los móviles no envían ubicación (ahorra backend si alguien deja la app
   abierta).
2. **Alta y palanca de empresas (distribuidoras)** — crear, activar/desactivar. Sin datos de
   facturación: el abono se cobra en persona.
   ⚠️ **Desactivar una empresa hoy no hace nada** — ver §8.
3. **Coordenada base (depósito) por empresa** — dónde abre el mapa. Ambos valores o ninguno.

### Zonas — `admin/ZonasView.jsx:19` · encargado, admin, superadmin

> **Regla de negocio central: "la zona lleva el vendedor".**

Cada zona tiene número, color y un **vendedor dueño**. Los clientes que se importen o se muevan a esa
zona **heredan automáticamente ese vendedor**. La opción "— Sin dueño —" se rotula
"**(todos lo ven)**", que es la contracara de la regla del servidor: un vendedor solo ve los clientes
que tiene asignados.

### Importar clientes — `admin/ImportarClientes.jsx:29`

Importación masiva desde **Excel .xlsx**, con plantilla descargable.

- **Encabezados flexibles**: acepta `codigo/cod/code`, `nombre/comercio/razón social`,
  `localidad/loc/ciudad`, `zona/n zona/nro zona`… sin distinguir mayúsculas ni tildes.
- **Previsualización con 4 estados**: `ok` (Nuevo) · `dup` (Código repetido) · `zona?` (Zona no
  encontrada) · `sin-nombre`.
- **Reglas**: dedup por `codigo` contra la cartera **y** dentro del mismo lote. Las filas `zona?`
  **sí se importan**, sin zona ni vendedor; las `dup` y `sin-nombre` no. Los importados nacen
  **`activo=true`** —es una acción de admin, no necesita confirmación— y **sin coordenadas**: se
  ubican después tocando el mapa en la ficha.

### Clientes — `admin/tabs/ClientesTab.jsx:17`

Tabla (escritorio) o tarjetas (celular). Contadores: total, "**N por confirmar**" y "**N sin
ubicar**" (este último es un filtro clickeable).

**Es el circuito de aprobación** de lo que cargan los móviles: botón "Confirmar" en cada fila no
activa.

La ficha tiene dos niveles de permiso:
- **Todos**: geofence (50–150 m), días de visita, frecuencia (Semanal/Quincenal/Mensual), y ubicar
  en el mapa un cliente importado.
- **Solo gestión** (admin/encargado/superadmin): razón social, código, localidad, horario, zona, y
  **eliminar** (con confirmación en dos pasos).

> **Regla clave**: al cambiar la zona de un cliente, **se le reasigna el vendedor dueño de la zona
> nueva**. Está anunciado en la interfaz.

### Catálogo — `admin/tabs/CatalogoTab.jsx:7`
Tabla de productos + "Nuevo producto". **No se puede editar ni borrar un producto.**

### Recorridos — `admin/RecorridosView.jsx:25` · lo usa también el propietario

Mapa con todos los recorridos del día, un color por persona. Selector de fecha, Recargar, y toggle
"**Pegar a calles**" (por defecto **apagado** = rastro GPS crudo y fiel). Panel lateral con nombre,
rol, puntos y **km recorridos** por persona.

> **Los km se calculan siempre sobre el rastro crudo**, aunque se dibuje el pegado a calles: es más
> fiel. Y el mapa **no reencuadra** al auto-refrescar (cada 60 s si la fecha es hoy), para no
> interrumpir al que está navegando.

### Replay de jornada — `admin/components/ReplayJornada.jsx:30`

Elegís usuario + fecha → se anima el recorrido grabado. Play/pausa, **scrub**, velocidades
**1×/2×/4×/8×**. Panel con punto actual, distancia, hora de inicio/fin y coordenada.
**Exportar PNG** genera una imagen del recorrido con título, rol, fecha, distancia y horario.

### La cuota de consultas — la regla comercial del sistema

- **Límite: 5.000 consultas por mes y por empresa.** Referencia semanal de 1.250, solo informativa.
- **1 consulta = cargar el recorrido de un vendedor en Replay.** Nada más: Recorridos y las dos
  supervisiones **no consumen cuota** aunque carguen posiciones.
- Al llegar al límite, Replay **bloquea** con un aviso.

> ⚠️ **Es evadible.** El límite es una constante en el bundle, el chequeo ocurre en el teléfono, y
> el registro del contador es "disparar y olvidar": si falla, la consulta se sirvió igual y no se
> contabilizó. No hay nada en el servidor que lo imponga. Tampoco hay una columna de cuota por
> empresa, así que **no se le puede vender un plan más grande a un cliente sin recompilar la app**.

### Consultas — `admin/ConsultasView.jsx:37`
Dos medidores (mes y semana) con color según el consumo, y un **heatmap estilo GitHub**: columnas =
semanas, filas = días. Leyenda literal: *"1 consulta = cargar el recorrido de un vendedor"*.

---

## 6. Supervisión

`SupervisionMovil.jsx` (APK, pantalla completa) y `SupervisionDesktop.jsx` (PWA, sidebar + topbar)
son **dos implementaciones de lo mismo con distinta piel**. No comparten código salvo `dwells.js`, y
ya divergieron antes (los carteles de parada salieron en 1.5.7 solo en móvil).

Funciones comunes: mapa de recorridos del día · móviles en vivo clickeables · filtro
Vendedores/Repartidores · selector de fecha · toggles Calles / Paradas / Clientes · sincronizar
ubicaciones · menú de cuenta · dashboard de KPIs "próximamente" · acceso a Gestión.

### Reglas no obvias

1. **Los pines en vivo solo se muestran si la fecha es HOY.** En un día pasado solo tiene sentido el
   recorrido, no la "posición ahora".
2. **El rastro crudo es el default**, no el pegado a calles: la fidelidad al GPS real prima sobre la
   estética.
3. **Los carteles de parada se calculan sobre el rastro CRUDO a propósito**: el pegado a calles ya
   descartó los tramos quietos, así que sobre él una parada no existe.
4. La **batería** del pin se saca del último punto con dato, recorriendo de atrás para adelante.
5. **Pendiente conocido**: el cartel de parada debería decir el nombre del comercio cuando cae dentro
   del geofence de un cliente. Está bloqueado **por datos, no por código**: de 2.001 clientes, uno
   solo tiene coordenadas.

### Estado del equipo — `supervision/components/EstadoEquipo.jsx:22`

La pieza de diagnóstico más valiosa del sistema. Responde "**¿por qué no llega la señal de fulano?**"

| Estado | Significado |
|---|---|
| 🟢 **OK** | Fix fresco + latido reciente + **2º plano confirmado** |
| 🟡 **GPS apagado** | Late pero sin fix (ubicación off o permiso denegado) |
| 🟡 **En pantalla OK pero NO grabó en 2º plano** | Reporta ahora, pero si guarda el celular el recorrido se pierde |
| 🔴 **Sin señal desde HH:MM** | Latido más viejo que 5 minutos |
| ⚪ **Sin actividad hoy** | Ningún latido registrado hoy |

> **`bg_ok` es el campo clave.** Se pone en `true` solo cuando el móvil recibió un fix **estando en
> segundo plano**, lo que confirma el permiso "Siempre" y que el sistema no lo está matando. El
> código lo dice sin vueltas: *es la causa nº1 de "hice el recorrido y no aparece"*.

El consejo que muestra **cambia según `bg_ok`**: con 2º plano confirmado sugiere revisar la
optimización de batería; sin confirmar, sugiere el permiso "solo mientras uso la app".

---

## 7. Rol PROPIETARIO

Rol de **solo lectura**, pensado para el celular del dueño. No tiene un solo botón de crear o editar.

Ve: alerta de GPS apagado · franja "**Equipo en vivo**" (quién comparte GPS ahora, con "hace Xs"
contando en vivo) · mapa de recorridos del día · y **KPIs "próximamente"** (Pedidos por preventista,
Horas trabajadas, Clientes visitados, Recaudado en la semana) todos en "—".

En la práctica el propietario entra por SupervisiónMóvil con la bandera de solo-lectura, tanto en la
APK como en la PWA. `PropietarioView.jsx` solo se alcanza por un fallback que casi nunca se activa.

---

## 8. Reglas del producto, en un solo lugar

| Regla | Valor | Dónde |
|---|---|---|
| **Una parada** | permanecer **≥ 3 min dentro de 40 m** | `geolocation/dwell.js:24-25` |
| Centro de la parada | **mediana** de lat y lng por separado (no promedio: robusto a outliers) | `dwell.js:42-45` |
| Movimiento mínimo para registrar un punto | **10 m** | `gpsConfig.js` |
| Reenvío de cortesía estando quieto | **90 s** | `gpsConfig.js` |
| Precisión máxima aceptada | **30 m** (peor se descarta: el jitter en interiores es la causa #1 de "vueltas" falsas) | `gpsConfig.js` |
| Velocidad máxima creíble | **45 m/s** (~160 km/h); más rápido = glitch | `gpsConfig.js` |
| Ventana horaria de rastreo | **07:30–22:00**, global, solo superadmin | `services/tracking.js` |
| Cuota de consultas | **5.000/mes por empresa** | `ConsultasView.jsx:13` |
| Meta diaria del vendedor | **$900.000**, hardcodeada para todos | `useJornada.js:85` |
| Geofence por cliente | 50–150 m, default **75 m** | `NuevoCliente.jsx` |
| Retención de posiciones | **7 días**, purga diaria 03:30 | `db/03_retention.sql` |
| La zona lleva el vendedor | el cliente hereda el vendedor de su zona | `ZonasView.jsx:60` |
| Cliente cargado por rol móvil | nace `activo=false`, necesita confirmación | `CatalogContext.jsx:130` |
| Cliente importado por admin | nace `activo=true` | `CatalogContext.jsx:242` |

---

## 9. Brechas funcionales

Lo que hay que saber antes de prometerle algo a un cliente:

1. **La jornada del vendedor no se guarda.** Qué vendió cada quién y a quién —el activo comercial
   central del sistema— hoy no existe en la base. Es la brecha más grande del producto.
2. **El repartidor nunca recibe entregas.** Su interfaz completa de dos pasos con firma está
   construida y nunca se activa.
3. **El propietario no se puede dar de alta.** El rol existe en el código pero no en la restricción
   de la base, y no figura en las listas de Usuarios.
4. **Desactivar una empresa no hace nada.** La palanca de cobro está desconectada: ninguna regla del
   servidor ni la puerta de entrada consultan `empresas.activo`. El texto de la propia interfaz
   —*"deja sin acceso a todos sus usuarios"*— es falso hoy. Ver [PLAN_SAAS.md](PLAN_SAAS.md).
5. **La ventana horaria de rastreo es global**, no por empresa: en un SaaS multi-tenant, cambiarla
   afecta a todas las distribuidoras a la vez.
6. **La meta de $900.000 está hardcodeada** para todos los vendedores de todas las empresas.
7. **La cuota es client-side y evadible**, y no configurable por cliente.
8. **Faltante y Ruteo son maquetas.** `FaltanteTab` tiene el reporte completo escrito pero
   inalcanzable (`faltVacio` fijo en `true`); `RuteoTab` no está importado en ningún lado.
