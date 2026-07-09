# Brief de Diseño UX/UI — Distribuidora LA UNIÓN
**Plataforma logística de preventa y reparto · Versión de brief 1.0 · Julio 2026**

---

## 0. Cómo usar este documento

Este brief es **autónomo**: contiene todo lo necesario para diseñar la UX/UI completa **sin tocar el código**. El equipo técnico se encarga de la implementación (React + Tailwind + Capacitor); el diseñador entrega **Figma** (pantallas + librería de componentes + prototipo). Los tokens de color/tipografía de acá abajo son el contrato que después el código replica 1:1 — respetalos.

**Qué NO tenés que hacer:** escribir CSS/código, definir la arquitectura de datos, ni resolver el backend. **Qué SÍ:** sistema visual, layout, jerarquía, estados, microinteracciones y todas las pantallas de los 3 roles.

---

## 1. El producto en una frase

> App para que una distribuidora mayorista gestione el ciclo completo **preventa → despacho → entrega**, con seguimiento GPS, toma de pedidos en la calle y control en tiempo real desde un panel.

### Tres roles, un flujo
```
VENDEDOR (móvil)  →  ADMIN (escritorio)  →  REPARTIDOR (móvil)
Visita al comercio    Consolida y controla     Entrega y firma
Toma el pedido        Optimiza la ruta         Confirma cantidades
GPS + geofencing      Mapa en vivo + KPIs      Reporta faltante de stock
```

| Rol | Dispositivo | Objetivo de diseño |
|---|---|---|
| **Vendedor / Preventista** | Teléfono (PWA/app), uso a una mano, en la calle | Rapidez para cargar pedidos, legible bajo sol, pulgar-friendly |
| **Repartidor / Chofer** | Teléfono, dentro del vehículo | Pocos toques, botones grandes, firma y confirmación de entrega |
| **Administrador / Supervisor** | Escritorio / notebook | Densidad de datos, mapa grande, monitoreo, reportes |

---

## 2. Principios de diseño

1. **Operativo antes que decorativo.** Es una herramienta de trabajo diario. La información manda; el adorno se subordina.
2. **Estética "sala de control" (TradingView).** Datos densos, números monoespaciados y alineados, grillas finas, deltas verde/rojo, sparklines. Sensación de instrumento de precisión.
3. **Dual real, no un modo "apagado".** Light (Tiffany) y Dark (teal profundo) son dos identidades cuidadas por igual — el dark es el modo primario para el vehículo y la noche.
4. **Mobile-first en Vendedor/Repartidor, data-first en Admin.** No es la misma app estirada: son dos densidades distintas.
5. **Estados explícitos.** Cada dato tiene su vacío, su carga y su error diseñados. Nada queda "en blanco".
6. **Continuidad de marca.** El mismo lenguaje visual atraviesa los 3 roles: si ves una pantalla, sabés que es LA UNIÓN.

---

## 3. Fundamentos del Design System

### 3.1 Color — sistema de tokens semánticos

Definimos **tokens semánticos** (no colores sueltos). Diseñá con estos nombres; cada uno tiene su valor en Light y en Dark.

#### Paleta de marca — Tiffany
| Token | Hex | Uso |
|---|---|---|
| `brand/tiffany` | `#0ABAB5` | Color primario, CTAs, acentos |
| `brand/tiffany-classic` | `#81D8D0` | Tiffany clásico, fondos suaves, chips |
| `brand/tiffany-light` | `#A7E8E3` | Tintes, hovers claros |
| `brand/tiffany-deep` | `#06807C` | Texto sobre claro, bordes activos |

#### LIGHT MODE — "Tiffany con degradado a blanco"
| Token | Hex | Notas |
|---|---|---|
| `bg/app` | degradado `#FFFFFF → #F2FBFA` | Fondo general con tinte tiffany apenas perceptible |
| `bg/surface` | `#FFFFFF` | Tarjetas, paneles |
| `bg/surface-2` | `#F4FAF9` | Superficie hundida / filas alternas |
| `border/default` | `#E2EFEE` | Bordes 1px |
| `text/strong` | `#0B2B2A` | Títulos (casi negro con tinte teal) |
| `text/muted` | `#5A7371` | Secundario |
| `text/faint` | `#93A9A7` | Metadatos, placeholders |
| `primary` | `#0ABAB5` | Botón principal, links |
| `primary-contrast` | `#FFFFFF` | Texto sobre primary |

#### DARK MODE — "base #0D1F1E y #0C0C0C con marcos blancos"
| Token | Hex | Notas |
|---|---|---|
| `bg/app` | `#0C0C0C` | Fondo general (casi negro) |
| `bg/surface` | `#0D1F1E` | Paneles (verde-teal profundo) |
| `bg/surface-2` | `#12302E` | Superficie elevada / hundida |
| `frame/white` | `rgba(255,255,255,0.12)` | **Marco blanco 1px** — la firma del dark |
| `frame/white-strong` | `rgba(255,255,255,0.20)` | Marco resaltado (foco, tarjeta activa) |
| `text/strong` | `#ECF5F4` | Títulos |
| `text/muted` | `#8FA9A6` | Secundario |
| `text/faint` | `#5C7370` | Metadatos |
| `primary` | `#2DD4CE` | Tiffany más brillante para contraste en oscuro |
| `primary-contrast` | `#04211F` | Texto sobre primary |

#### Semánticos de estado (ambos modos, ajustar luminosidad)
| Token | Light | Dark | Uso |
|---|---|---|---|
| `success` / delta ▲ | `#10B981` | `#34D399` | Entregado, ganancia, ruta OK |
| `warning` | `#F59E0B` | `#FBBF24` | Parcial, pendiente, sin stock leve |
| `danger` / delta ▼ | `#EF4444` | `#F87171` | No entregado, faltante, error |
| `info` | `#0EA5E9` | `#38BDF8` | En camino, neutro informativo |

> **Regla de accesibilidad:** todo texto ≥ 4.5:1 de contraste; datos pequeños (≤12px) ≥ 7:1. Nunca usar Tiffany puro para texto largo sobre blanco (bajo contraste) — es color de acento/superficie, no de párrafo.

### 3.2 Tipografía
| Rol tipográfico | Familia | Uso |
|---|---|---|
| **Display** | Space Grotesk | Títulos, números KPI grandes |
| **Body** | Inter | Texto general, labels, botones |
| **Mono** | IBM Plex Mono (o JetBrains Mono) | **Todo dato numérico/técnico:** IDs de pedido, coordenadas, timestamps, cantidades, montos, kilos. Es el corazón del look TradingView. |

Escala sugerida (mobile / desktop): 11 · 12 · 13 · 14 · 16 · 18 · 20 · 24 · 32. **Tabular numbers (`tabular-nums`) obligatorio** en toda cifra que se compare en columnas.

### 3.3 Grafismo técnico — el "lenguaje TradingView"
Elementos que le dan la identidad de instrumento:
- **Grillas de 1px** de baja opacidad detrás de gráficos y tablas.
- **Sparklines / mini area charts** en las tarjetas KPI (venta del día, kilos, efectividad).
- **Deltas con flecha y color:** `▲ +12%` verde / `▼ −8%` rojo, en mono.
- **Barras de capacidad:** `usado / total` con % (ver patrón 6.2).
- **Densidad alta:** padding ajustado, líneas divisorias finas, mucha info por pantalla en Admin.
- **Bordes finos, radios contenidos:** radios 8–16px, nada de globos redondeados; sensación técnica.
- **Monospace + puntos de estado** (● verde/ámbar/rojo/gris) como en una consola.

### 3.4 Espaciado, formas, elevación
- **Grilla base 4px.** Espaciados: 4, 8, 12, 16, 20, 24, 32.
- **Radios:** `sm 8` (chips/inputs), `md 12` (botones), `lg 16` (tarjetas), `full` (badges/pills).
- **Elevación Light:** sombras suaves y difusas (`0 2px 8px rgba(11,43,42,.06)`).
- **Elevación Dark:** casi sin sombra; la separación la dan los **marcos blancos** y el cambio de superficie.
- **Bordes 1px** siempre; en dark, blancos translúcidos.

### 3.5 Iconografía
Set lineal, trazo 1.5–2px, coherente (recomendado **Lucide** o **Phosphor**). Evitar emojis en producción (el prototipo actual los usa como placeholder). Íconos clave: pin/ubicación, ruta, camión, caja, firma, reloj, check, alerta, filtro, capas de mapa.

### 3.6 Estados a diseñar para CADA componente
Default · Hover · Active/Pressed · Focus (anillo visible) · Disabled · **Loading** (skeleton, no spinner genérico) · **Empty** (ilustración + texto + acción) · **Error** (mensaje claro + reintento).

---

## 4. Inventario de componentes (librería a entregar)

**Átomos:** Botón (primario/secundario/ghost/danger), Input, Select, Checkbox/Toggle, Chip/Badge, Pill de estado, Avatar, Ícono, Divider, Delta (▲▼), Punto de estado.

**Moléculas:** Tarjeta KPI (con sparkline + delta), Barra de capacidad, Fila de producto (con stepper +/−), Fila de cliente/parada, Fila de pedido, Card de entrega, Buscador con filtro, Tabs, Selector de rol, Toggle de tema, Toast/notificación, Modal, Bottom sheet (móvil), Timeline item.

**Organismos:** Bottom navigation (móvil), Header/topbar (Admin), Panel de parámetros, Tabla densa (Órdenes/Rutas), Dona de efectividad, Mapa con controles + leyenda, Pad de firma, Consola de eventos, Reporte de faltante (tabla + gráfico), Ficha de cliente con radio de geofence.

**Entregar en 2 temas** (Light + Dark) con **auto-layout** y variantes/estados en Figma.

---

## 5. Pantallas por rol

### 5.1 VENDEDOR — móvil (PWA/app), pulgar-friendly
Navegación: **bottom nav** (Inicio · Ruta · Catálogo · Perfil).

1. **Hoja de ruta (Home).** Lista de clientes del día en orden, con progreso `hechas/total` y barra. Próxima parada resaltada. Cada fila: nº de parada, comercio, localidad/ID (mono), estado (pendiente/visitado/sin pedido), botón **Check-in**. Header con resumen del día (pedidos, monto — mono, tabular). Estados: cargando (skeleton de filas), vacío (ruta sin clientes).
2. **Visita activa + Catálogo.** Al hacer check-in aparece un **header de visita en curso** con **cronómetro de permanencia** (mm:ss, mono, animado) y nombre del comercio. Debajo: buscador + catálogo **agrupado por categoría**, cada producto con precio, peso y **stepper +/−**. **Barra de carrito flotante** fija abajo con items, kilos y total (mono), y CTA "Confirmar pedido y finalizar visita". Acción secundaria: "Cancelar visita" y "Sin pedido" (con motivo: stock suficiente / precio / cerrado / otro).
3. **Mapa de ruta.** Mapa con pines de clientes + posición propia; botón "Calcular ruta óptima"; lista seleccionable de paradas. (Ver patrón 6.1 geofence.)
4. **Perfil / Reportes.** Venta del día (KPI + sparkline estilo TradingView), meta diaria (dona/anillo), toggle de tracking GPS, cierre de jornada.

### 5.2 REPARTIDOR — móvil, dentro del vehículo, botones grandes
1. **Hoja de entregas.** Lista de pedidos ordenada por estado (Pendiente → En camino → Entregado) y hora. Contador "X de Y por entregar". Cada **card de entrega**: comercio, ID pedido (mono), nº de artículos, peso, monto, **pill de estado** (Pendiente ámbar / En camino info / Entregado verde), hora tomado/entregado.
2. **Flujo de entrega (estados dentro de la card):**
   - `Pendiente` → botón grande **"Marcar en camino"**.
   - `En camino` → **"Confirmar entrega"** que abre: **(a) verificación de cantidades entregadas** por ítem (default = pedido; si entrega menos, selecciona **motivo: "sin stock"** u otro → esto alimenta el reporte de faltante) y **(b) pad de firma** (canvas táctil, botones Limpiar/Cancelar/Confirmar).
   - `Entregado` → bloque de conformidad con **miniatura de la firma** + hora.
3. **Detalle de pedido** (opcional): tabla de ítems con generado vs entregado.

### 5.3 ADMINISTRADOR — escritorio, densidad de datos
Layout: **topbar** (marca, distribuidora, toggle tema, config) + **contenido en grilla**. Secciones (tabs o rutas): **Dashboard · Mapa operativo · Rutas · Órdenes · Clientes · Reporte de faltante**.

1. **Dashboard (KPIs).** Fila de **tarjetas KPI** con número grande (mono), delta ▲▼ y **sparkline**: Rutas terminadas, Clientes visitados, Cobros/Recaudación, Estado de órdenes. A la derecha, **dona "Efectividad en Ruta"** con leyenda de estados (Realizadas / Parciales / No realizadas / Reprogramadas / Pendientes) — ver patrón 6.3. Selector de fecha ("Hoy") y "última actualización".
2. **Mapa operativo (tiempo real).** Mapa grande (dark tiles) con: pin de la distribuidora, pines de clientes (color por estado), **posición del vendedor/repartidor con "ping" animado**, **polilínea de la ruta recorrida** (breadcrumbs), popups. Overlay superior con métricas de la ruta (distancia, tiempo, visitas). **Consola de eventos** tipo terminal abajo (log con timestamps mono). Controles de zoom/capas y **leyenda**.
3. **Auditoría de pedido + consolidado logístico.** Panel lateral: al enfocar un cliente, tabla de ítems del pedido (art./cant./subtotal, mono) + totales de peso y monto. Card "Cierre de carga": clientes con pedido `X/Y`, kilos consolidados, recaudación.
4. **Ruteo (planificación).** Inspirado en el benchmark: panel de **parámetros** (depósito, objetivo "minimizar distancia/tiempo"), **chips de capacidad** del vehículo (Peso/Volumen/Dinero/Visitas — patrón 6.2), lista de órdenes a asignar, botón **"Optimizar rutas"**, y "Publicar plan".
5. **Clientes.** Tabla + ficha de cliente (**Nuevo/Editar**) con: código, razón social, **ubicación por coordenadas**, estado, **marcador con RADIO de geofence** (slider + círculo en el mapa), **días de visita** (chips LU–DO), **frecuencia** (Semanal/Quincenal/Mensual), horario. Ver patrón 6.1.
6. **📊 Reporte de faltante de stock (diferenciador clave).** Comparación **Pedidos Generados vs Entregados**: tabla por producto con `generado`, `entregado`, `faltante`, `motivo`, y **gráfico de barras estilo TradingView** (entregado vs faltante). Es el informe de "productos no entregados por falta de stock". Diseñá también su estado vacío ("sin entregas registradas aún").

---

## 6. Patrones clave (diseñar con cuidado)

**6.1 Radio de geofence del cliente.** Editor con **slider de radio (50–100 m)** que dibuja un **círculo semitransparente** sobre el mapa alrededor del pin del cliente. Es la zona que dispara el check-in/out automático. (Referencia visual: captura QuadMinds de "Nuevo Cliente".)

**6.2 Chips de capacidad.** `ícono · label · usado / total · %` con mini-barra de progreso. Ej: `⚖ Peso  240 / 1.000 kg  24%`. Colores: normal Tiffany/info, >80% ámbar, >100% rojo. Cuatro variantes: Peso, Volumen, Dinero, Visitas.

**6.3 Dona de efectividad.** Anillo con % central grande (mono) + leyenda con **punto de color + label + valor** por estado. Estética limpia, sin sombras 3D.

**6.4 Pad de firma.** Canvas con línea base y placeholder "Firmá acá"; en dark, fondo claro para que la firma (trazo oscuro) se lea; acciones Limpiar/Cancelar/Confirmar; el resultado se muestra como miniatura enmarcada.

**6.5 Cronómetro de permanencia.** Reloj `mm:ss` mono con punto pulsante, indica tiempo dentro del comercio.

**6.6 Pills de estado de pedido/orden.** Pendiente (ámbar) · En camino (info) · Entregado (verde) · No entregado (rojo) · Parcial (ámbar rayado). Consistentes en los 3 roles.

---

## 7. Responsive & PWA

- **Vendedor/Repartidor:** diseñar a **375×812** (iPhone base) y verificar 360px (Android chico). **Touch targets ≥ 44×44px.** Respetar **safe areas** (notch, home indicator). Barra de carrito/bottom-nav no debe tapar contenido (padding inferior).
- **Admin:** diseñar a **1280–1440** de ancho; grilla fluida hasta 1600. Tablas con scroll interno, no romper el layout.
- **PWA:** pensar **splash/ícono**, estado **offline** (banner "trabajando sin conexión, se sincroniza al volver") y skeletons de carga. Modo instalado (standalone) sin barra de navegador.
- **Orientación:** móvil solo vertical; Admin horizontal.

---

## 8. Accesibilidad
- Contraste AA (texto normal 4.5:1, datos chicos 7:1). Cuidado especial con Tiffany sobre blanco.
- **Foco visible** en todos los interactivos (anillo Tiffany 2px).
- No comunicar estado **solo con color**: sumar ícono/label (daltonismo).
- Respetar `prefers-reduced-motion`: los "pings"/animaciones se atenúan.
- Tamaño mínimo de texto 11px (solo metadatos); cuerpo ≥ 13–14px.

---

## 9. Referencias visuales (carpeta `fotos de referencia...`)

| Material | Cómo usarlo |
|---|---|
| **7 capturas de QuadMinds Flash** | **Benchmark de UX y features**, NO de estilo. Tomar: arquitectura de KPIs, chips de capacidad, dona de efectividad, editor de radio de geofence, panel de optimización de rutas, estados de órdenes. **Evitar:** su paleta celeste/corporativa y su layout literal. |
| **Captura de la app actual "LA UNIÓN"** (`...160106`) | Punto de partida a superar (verde emerald, mobile, Leaflet). Muestra el flujo real (Calcular ruta, Clientes en ruta, Sin pedido, bottom nav). |
| `image.png` (404 GitHub) | **Ignorar** — es un error de deploy, no un diseño. |

> Al diseñador se le comparten las 7 de QuadMinds + la de la app actual, con la aclaración: *"referencia de estructura y funciones; la identidad visual la define este brief (Tiffany + dark teal + TradingView), no las capturas."*

---

## 10. Entregables del diseñador

**Se espera (en Figma):**
1. **Design tokens** documentados (color Light/Dark, tipografía, espaciado, radios, sombras) como estilos/variables.
2. **Librería de componentes** (sección 4) con variantes y estados, en ambos temas.
3. **Pantallas completas** de los 3 roles (sección 5), Light y Dark.
4. **Prototipo interactivo** de los 3 flujos: Vendedor (check-in → pedido → confirmar), Repartidor (en camino → cantidades → firma → entregado), Admin (dashboard → mapa → reporte de faltante).
5. **Specs de handoff** (medidas, gaps, comportamiento responsive) y export de íconos/assets.

**Fuera de alcance del diseñador:** código, CSS, backend, integración de mapas/GPS, definición de datos. (Los tokens son el puente: se entregan como valores, el equipo los implementa.)

**Formato:** archivo Figma compartido + este brief como referencia. Entregar en el mismo orden de prioridad: tokens → componentes → pantallas Dark (modo primario) → pantallas Light → prototipo.

---

### Anexo — Glosario operativo
- **Preventa/Vendedor:** toma pedidos visitando comercios; no entrega mercadería.
- **Geofencing:** radio virtual alrededor del cliente que detecta entrada/salida (check-in/out automático).
- **Breadcrumbs:** rastro de puntos GPS de la ruta recorrida.
- **Faltante de stock:** diferencia entre lo pedido (generado) y lo efectivamente entregado.
- **Consolidado de carga:** suma de kilos/monto/clientes de la jornada para armar el camión.
