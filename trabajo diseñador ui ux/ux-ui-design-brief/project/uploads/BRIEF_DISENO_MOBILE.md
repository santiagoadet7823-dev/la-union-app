# Brief de diseño — LA UNIÓN (mobile / app nativa)

> Para el diseñador. Objetivo: rehacer/pulir las **visuales mobile** de la app (APK Android nativa + PWA) manteniendo el sistema visual ya definido. Hoy la vista de escritorio está diseñada; la **mobile del panel** es un colapso hecho por código (funcional, no diseñado a medida) y las pantallas del vendedor necesitan una pasada fina para pantalla real (sin el marco de teléfono simulado).

---

## 1. Qué es el producto
Plataforma logística de una distribuidora (LA UNIÓN, Las Lajitas, Salta). **Una sola app** que cambia según el rol del usuario:
- **Vendedor / Repartidor** → app mobile: toma pedidos en la calle, GPS en vivo, ruta del día.
- **Encargado** → es vendedor **y** auditor: alterna entre "Mi jornada" (vista vendedor) y "Panel".
- **Admin / Superadmin** → panel de control (mapa en vivo, clientes, zonas, reportes, usuarios).

Se distribuye como **APK nativo** (Android, Capacitor) y como **PWA** (web). El diseño debe verse bien en **celular real a pantalla completa** (no en el marco de teléfono que se usa en escritorio para previsualizar).

---

## 2. Sistema visual (fuente de verdad — NO reinventar)
Estética **"sala de control / TradingView"**: datos densos, mono tabular, grillas finas, deltas verde/rojo, sparklines. Tiene **tema claro (Tiffany)** y **tema oscuro (teal sobre negro)** — hay que diseñar ambos.

**Tipografías**
- Display/títulos: **Space Grotesk** (fallback Inter).
- Cuerpo/UI: **Inter**.
- Números, códigos, coordenadas, timestamps: **IBM Plex Mono** (tabular).

**Paleta (tokens CSS reales — usar estos, no inventar HEX nuevos):**

| Token | Light | Dark | Uso |
|---|---|---|---|
| `--primary` | `#0abab5` | `#2dd4ce` | Acción principal / marca (teal Tiffany) |
| `--deep` | `#06807c` | `#2dd4ce` | Texto/acento sobre tint |
| `--bg-app` | degradé blanco→#edf9f7 | `#0c0c0c` | Fondo de pantalla |
| `--surface` | `#ffffff` | `#0d1f1e` | Tarjetas / paneles |
| `--surface2` | `#f4faf9` | `#12302e` | Superficie secundaria |
| `--line` / `--line2` | `#e2efee` / `#c9e0de` | rgba blanco .12 / .20 | Bordes |
| `--text` / `--muted` / `--faint` | `#0b2b2a` / `#5a7371` / `#93a9a7` | `#ecf5f4` / `#8fa9a6` / `#5c7370` | Texto jerárquico |
| `--success` | `#10b981` | `#34d399` | OK / entregado / GPS activo |
| `--warning` | `#f59e0b` | `#fbbf24` | Pendiente / a confirmar |
| `--danger` | `#ef4444` | `#f87171` | Error / GPS apagado |
| `--info` | `#0ea5e9` | `#38bdf8` | Superadmin / en camino |
| `--console-bg`/`--console-fg` | `#0b2b2a` / `#a7e8e3` | `#081414` / `#5fd9d3` | Consola de eventos |

Cada color tiene su `-tint` (fondo suave del mismo color, ~10–14% alpha) para chips/badges.

**Radios**: tarjetas 14–16px, botones 10–12px, chips/pills 99px. **Sombras**: suaves en light (`--shadow`, `--shadow-lg`), inexistentes en dark (se usa borde). **Íconos**: line-icons stroke 2 (estilo Lucide/Feather), 12–18px.

---

## 3. Pantallas a diseñar (mobile-first, prioridad alta → baja)

### A. Login (nativa + web)
- Card centrada, logo "U" en cuadrado teal, título "Distribuidora LA UNIÓN", botón blanco "Continuar con Google" (con isotipo Google), nota de "cuenta queda pendiente de aprobación".
- **Estado de error** (cartel rojo `--danger-tint`): "No se pudo completar el ingreso" + detalle.
- Diseñar también la **mini-pantalla puente** "Volviendo a la app…" (fondo dark teal, spinner, logo) — es transitoria.

### B. GPS Gate (bloqueo de pantalla)
- Cuando el vendedor no tiene GPS activo, la app bloquea todo: ícono de ubicación tachada (rojo), título "GPS desactivado", texto explicativo, botón grande "Activar GPS". Debe transmitir que es **obligatorio**.

### C. Vendedor (4 tabs, bottom-nav)
Bottom nav: **Inicio · Ruta · Catálogo · Perfil**.
1. **Inicio**: header con logo + fecha (mono); botón/estado GPS; card "Resumen del día" (Paradas x/y, Pedidos, Monto) + barra de progreso; lista "Mis clientes" (tarjetas con nº, nombre, localidad, estado: Pendiente/Visitado/Sin pedido, botón Check-in en la próxima parada). Badge "A CONFIRMAR" en clientes nuevos.
2. **Ruta**: mapa (Leaflet) con pines numerados por estado + posición en vivo; botón "Calcular ruta óptima" + chips de km/tiempo/paradas; lista de paradas pendientes. Incluir texto explicativo de qué hace el cálculo.
3. **Catálogo / Visita**: barra de "visita en curso" con cronómetro (mono grande); buscador; productos agrupados por categoría con stepper (− cantidad +); barra flotante de carrito (ítems, kg, total) + "Confirmar pedido". Bottom-sheet "Visita sin pedido" con motivos (radio).
4. **Perfil**: venta del día, medidor circular de meta diaria, visitas/efectividad, toggle Tracking GPS, "Cerrar jornada".

### D. Encargado (dual)
- Igual que Vendedor **+ un switch segmentado** en la barra superior: **"Mi jornada" / "Panel"**. En Panel ve el panel admin (abajo). Diseñar el switch y cómo convive con la topbar en mobile.

### E. Panel admin en **mobile** (lo más urgente de rediseñar)
Hoy es el panel de escritorio colapsado a 1 columna. Tabs (scroll horizontal): **Mapa operativo · Reproducción · Clientes · Zonas · Catálogo · Dashboard · Órdenes · Faltante · Consultas · Usuarios · Empresas**. Repensar para mobile:
- **Mapa operativo**: mapa + lista de móviles en vivo (chips con color por persona + "hace Xs") + ficha de cliente (bottom-sheet al tocar un pin) + consola de eventos.
- **Clientes**: hoy es tabla ancha (scroll horizontal). Rediseñar como **tarjetas apiladas** en mobile (razón social, localidad, días, estado, botón Confirmar).
- **Zonas** (nuevo): crear zona (nombre + color), lista de zonas como chips con contador, y asignación cliente→zona/vendedor (en mobile, tarjetas con 2 selects).
- **Reproducción de jornada**: selector usuario+fecha, mapa con el recorrido (pegado a calles), barra play/scrub/velocidad, stats, botones "Pegar a calles" y "Exportar PNG".
- **Usuarios**: aprobar/asignar rol y empresa (tabla → tarjetas en mobile).

### F. Componentes nuevos (diseñar como piezas reutilizables)
1. **Banner de selección de dispositivo** (aparece al abrir por 1ª vez): "¿Desde qué dispositivo entrás?" con dos tarjetas grandes **Celular / PC** (una marcada como "sugerido" según autodetección).
2. **Alerta de actualización** (banner inferior fijo): ícono de refresh, "Actualización disponible", texto, botón "Actualizar" (web) / "Descargar" (APK).
3. **Heatmap de consultas de rutas** (nuevo, estilo grilla de uso tipo GitHub/Claude): grilla de **cuadraditos** (columnas = semanas, filas = días Lu–Do) coloreados por **intensidad** (5 niveles de teal, de `--surface2` a `--primary`) según cantidad de consultas del día. Arriba: resumen "Mes: N / 5000" y "Semana: M / 1250" con barra de progreso y color de alerta (warning/danger) al acercarse/superar el límite. Leyenda "menos → más". Debe leerse tanto en light como dark.
4. **Export PNG** (informe de recorrido): ya se genera por código un PNG con encabezado dark teal + mapa + ruta + stats + "LA UNIÓN". Si el diseñador quiere, puede especificar el layout del informe (encabezado, tipografías, ubicación de datos).

---

## 4. Estados a contemplar (para cada pantalla)
- **Vacío**: sin clientes / sin catálogo / sin pedidos / sin recorrido grabado → ilustración simple + título + texto guía + CTA (ya hay un patrón `EmptyState` con ícono de caja).
- **Cargando**: texto mono "Cargando…" / skeletons.
- **Error / sin conexión**: mensajes claros (OSRM sin red → "se muestra línea directa", GPS sin permiso, etc.).
- **Offline**: la app puede operar con datos cacheados; indicar cuando la telemetría está "conectando…".

---

## 5. Especificaciones responsive
- **Breakpoint** mobile: ancho ≤ 820px (o app nativa). En mobile: **1 columna**, sin scroll horizontal (hoy algunas tablas scrollean; el diseño mobile debe evitarlo con tarjetas apiladas).
- Alturas de mapa: ~300px en mobile, ~440–460px en desktop.
- Touch targets ≥ 44px. Bottom-nav fijo en las vistas vendedor. Topbar puede envolver (wrap) en mobile.
- Diseñar en **375–393px** de ancho (celular) y validar en 360px (equipos chicos tipo Moto E7).

---

## 6. Entregable esperado del diseñador
- Pantallas en **light y dark** de: Login, GPS Gate, Vendedor (4 tabs), Encargado (switch), Panel admin mobile (Mapa, Clientes, Zonas, Reproducción, Consultas/heatmap, Usuarios), y los 3 componentes nuevos (banner dispositivo, alerta update, heatmap).
- **Redlines** (spacing, tamaños, tokens usados) referenciando los tokens del punto 2 — así el pase a código es 1:1 (el código usa esos mismos CSS vars).
- Ícono de la app y splash (Android): ya hay uno base; si se rehace, entregar en los tamaños de `mipmap` (adaptive icon: foreground + background).
- Formato: Figma con los tokens como estilos/variables. Export de assets en SVG (íconos) y PNG (ilustraciones/estados vacíos).

## 7. Qué NO tocar
- La **paleta y tipografías** del punto 2 (son la identidad ya acordada).
- La **arquitectura de navegación por rol** (login → gate → vista según rol).
- Nada de facturación/pago en ninguna pantalla (el cobro es en persona; no va UI de pago).
