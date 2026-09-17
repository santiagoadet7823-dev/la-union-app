# Propuestas para la parte administrativa — DisT-At

> Qué le falta a la gestión de la distribuidora para estar a la altura de lo que hoy ofrece el
> mercado de preventa/reparto en Argentina, y en qué orden conviene hacerlo.
>
> Escrito el **16/09/2026** sobre `APP_VERSION 1.37.0`, después de recorrer las once pantallas de
> gestión (`lib/gestion.js`) contra el código y la base viva, y de mirar qué ofrecen los productos
> del rubro (BCNSoft, Cair, Venttu, Pi Móvil, Genuino Soft, DistriGest): en todos aparecen, como
> mínimo, **cobranzas en campo y cuenta corriente, hoja de reparto con confirmación de entrega,
> historial comercial por cliente, promociones/listas de precio, stock y auditoría**.
>
> Cada propuesta lleva **dónde se nota hoy** (archivo y línea, para que cualquiera lo verifique),
> qué se puede hacer **100 % dentro de la app**, qué parte **pediría datos del ERP** del cliente,
> y una estimación de esfuerzo (S: un día · M: una semana · L: más) e impacto.
>
> Lo que ya se hizo el 16/09/2026 y NO está acá: dashboard con gráficos (ventas + actividad, las
> tres pantallas), buscador y filtros de Pedidos, estado de entrega y marca ERP en la fila, historial
> de correcciones y condiciones en el detalle del pedido, forma de pago en la ficha del cliente,
> **Faltante** con datos reales, y respaldo de las tablas maestras.

---

## Nivel 1 — Operación diaria (S/M · sin ERP)

Lo que el equipo usa todos los días y hoy se resuelve a mano o no se resuelve.

### 1. Hoja de reparto del administrador · **M · impacto alto**
- **Hoy:** el repartidor se asigna **pedido por pedido** desde el detalle (`features/pedidos/DetallePedido.jsx`, bloque "Reparto"). No hay una vista "qué sale hoy y con quién". El repartidor ve sus pedidos por **`created_at` del día**, no por fecha de reparto (`features/repartidor/useEntregas.js:51-55`, el propio comentario lo dice: *"un pedido tomado ayer y asignado hoy no aparece"*). `fecha_entrega` se captura al confirmar (db/62) y **nadie la usa**. El orden de la ruta se recalcula en cada apertura y no se guarda (`RepartidorView.jsx:37-44`; la tabla `rutas` está vacía desde el día uno). El estado `No entregado` existe en el CHECK y en el mapa de estados (`useEntregas.js:40`) pero **ningún botón lo produce**. La firma de conformidad no sube (`RepartidorView.jsx:346-352`; `firmas_ins` sin alcance por empresa).
- **En la app:** pantalla "Reparto" en gestión: día + repartidor → lista de pedidos con selección múltiple y **asignación masiva**; el repartidor filtra por `fecha_entrega` (con `created_at` de respaldo); el orden se persiste en `rutas`; botón "No pude entregar" con motivo; arreglar `firmas_ins`.
- **Del ERP:** nada.

### 2. Plan de visitas por día · **M · impacto alto**
- **Hoy:** la ficha del cliente carga `dias_visita` (LU…DO) y `frecuencia` (`features/admin/tabs/FichaCliente.jsx:207-231`) y la planilla los exporta/importa, pero **ningún código del vendedor los lee**: `RutaTab.jsx` ordena TODOS los pendientes por distancia. El KPI "cobertura" de `features/metas/metas.js` no tiene base real.
- **En la app:** "Los de hoy" en la ruta del vendedor a partir de `dias_visita`/`frecuencia` (con la última visita para la quincenal/mensual); el supervisor ve **visitados / planificados** por persona; alerta al cierre del día para los planificados sin visitar (ver 4).
- **Del ERP:** nada.

### 3. Ficha del cliente con historial comercial · **S/M · impacto alto**
- **Hoy:** la ficha (`FichaCliente.jsx`) no muestra ni un pedido: ni el último, ni el monto acumulado, ni hace cuánto no compra. La lógica ya existe del lado del vendedor (`clientes_dormidos`, db/57:166; `productos_sugeridos_cliente`, db/44) pero no del lado de gestión.
- **En la app:** en la ficha: último pedido, monto del mes y del año, frecuencia real (días promedio entre compras), "hace N días que no compra", lista de los últimos 10 pedidos con acceso al detalle. Una RPC `historial_cliente(p_id_cliente)` con scope adentro, como las de db/68.
- **Del ERP:** el saldo (ver 13).

### 4. Alertas comerciales · **S · impacto medio**
- **Hoy:** los avisos al supervisor son dos y los dos de GPS: `sin_reportar` y `quieto` (`db/26_alertas_equipo.sql:223`, `supabase/functions/alertas-equipo/index.ts`).
- **En la app:** tipos nuevos en la misma tabla y el mismo cron, dedupe por el índice único (regla 33): **pedido sin repartidor** pasadas N horas, **pedido pendiente de exportar** más de N horas (`exportado_ts is null`), **cliente planificado sin visitar** al cierre (depende de 2), **entrega sin cerrar** al final de la ventana de rastreo. Umbrales en `EmpresasView` junto a los de GPS.
- **Del ERP:** nada.

### 5. Bitácora de exportaciones al ERP, con pantalla · **S · impacto medio**
- **Hoy:** `exportaciones_pedidos` (db/62:289) registra cada lote automático (cuántos, cuándo, bytes, error) y `reponer_pedidos_para_export` (db/62:419) permite repetir un lote — **sólo por SQL**. El botón manual "Exportar para facturar" **no marca** `exportado_ts` (`exportarPedidos.js:26-29`), así que un pedido bajado a mano sigue figurando "sin exportar".
- **En la app:** pestaña "Exportaciones" en Pedidos: lotes con fecha, cantidad, origen (cron / manual) y error; botón "reponer lote"; y que el manual marque `exportado_ts` + lote (con confirmación, porque congela el pedido).
- **Del ERP:** nada.

### 6. Constantes del ERP editables desde Empresas · **S · impacto medio (destraba el 13 y el selector de forma de pago)**
- **Hoy:** `empresas.export_erp` (formas de pago, constantes del layout) sólo se carga por SQL. Mientras `formas_pago` esté vacío el vendedor no ve el selector (`features/vendedor/ConfirmarPedidoSheet.jsx:20-29`) y la ficha del cliente ofrece texto libre.
- **En la app:** sección "Facturación" en `EmpresasView`: tabla código → etiqueta de formas de pago, constantes del archivo, con vista previa de una línea exportada.
- **Del ERP:** la tabla de códigos (el cliente la tiene; nunca llegó).

---

## Nivel 2 — Control y administración (M)

### 7. Auditoría de acciones administrativas · **M · impacto alto para un SaaS**
- **Hoy:** no existe. Las únicas huellas son `app_config_historial` (db/07), `pedido_ediciones` (db/55), `exportaciones_pedidos` (db/62) y `purgas_pedidos` (db/63). Nadie sabe quién cambió un rol, archivó 200 clientes, borró un producto o cambió un precio a mano.
- **En la app:** tabla `auditoria (ts, id_usuario, id_empresa, tabla, id_fila, accion, antes, despues)` llenada por triggers en `perfiles` (rol, activo, permisos, nivel), `clientes` (archivado, borrado, zona, vendedor), `productos` (precio, habilitado, borrado), `empresas` y `zonas`. Pantalla "Actividad" para admin con filtro por persona/tabla/fecha y CSV. Retención: 12 meses.
- **Del ERP:** nada.

### 8. Metas fijadas por la empresa · **S/M · impacto medio**
- **Hoy:** la meta de **$900.000 está escrita a mano** (`features/vendedor/useJornada.js:358`, `InicioTab.jsx:122`) para todos los vendedores de todas las empresas. `metas` (db/56) existe pero sólo la carga el propio vendedor en su tablero.
- **En la app:** pantalla "Metas" en gestión: por vendedor y período (diaria/mensual/anual), las 7 métricas de `metas.js`; el dashboard muestra **avance vs. meta** (barra con "dónde deberías estar hoy", que `TableroSheet.Barra` ya dibuja); el vendedor ve la que le fijaron.
- **Del ERP:** nada.

### 9. Usuarios: buscar, editar datos, resetear contraseña · **S · impacto medio**
- **Hoy:** lista plana sin búsqueda; nombre/email/teléfono sólo se muestran (`features/admin/UsuariosView.jsx:211-216`); `codigo_erp` (db/62:129) no se edita acá; no hay reset de contraseña por admin — y el circuito de recuperación está roto en producción (HANDOFF 🔴 #2).
- **En la app:** buscador, edición de nombre/teléfono/`codigo_erp`, "Enviar link para cambiar contraseña" (Edge Function con service_role, como `crear-usuario`).
- **Del ERP:** nada.

### 10. Duplicados: fusión y decisión persistente · **M · impacto medio**
- **Hoy:** "Son distintos" vive en estado de sesión y se pierde al recargar (`features/admin/RevisarDuplicados.jsx:27`); "archivar N y dejar una" no mueve pedidos ni visitas de las fichas archivadas a la que queda, así el historial del comercio queda partido.
- **En la app:** RPC `fusionar_clientes(p_destino, p_origenes[])` que reasigna `pedidos.id_cliente`, `visitas.id_cliente` y archiva; tabla `clientes_no_duplicados (a, b)` para el "son distintos".
- **Del ERP:** nada.

### 11. Paginación, orden y filtros en Clientes y Catálogo · **M · impacto medio (crece con la cartera)**
- **Hoy:** Clientes (~2.000) y Catálogo (~600) se renderizan enteros en memoria (`ClientesTab.jsx:59-61`, `CatalogoTab.jsx:112`); no hay orden por columna ni filtro por zona/vendedor/frecuencia/categoría (sólo texto).
- **En la app:** virtualización de la lista, encabezados ordenables, chips de zona/vendedor/día de visita en Clientes y de categoría/marca en Catálogo. Mismo patrón de chips que Pedidos (16/09/2026).
- **Del ERP:** nada.

### 12. `empresas.activo` con efecto real · **S · impacto alto para cobrar**
- **Hoy:** se escribe y se muestra, pero ninguna policy ni el gate de `App.jsx` lo consultan (CLAUDE.md §1, DOCUMENTACION_FUNCIONAL.md §10). La UI de Empresas dice *"deja sin acceso a todos sus usuarios"* y es falso.
- **En la app:** gate en `App.jsx` (pantalla "Cuenta suspendida" con el teléfono de soporte) + `mi_empresa_activa()` en las policies de escritura. **Cuidado:** no cortar la subida de posiciones/pedidos encolados de golpe — dejar una ventana de gracia para que el teléfono vacíe la cola.
- **Del ERP:** nada.

---

## Nivel 3 — Módulos nuevos (L · diseñados sin asumir el ERP)

### 13. Cobranzas en campo y cuenta corriente · **L · impacto muy alto (es lo primero que pide cualquier distribuidora)**
- **Hoy:** **no existe nada**: ni tabla de cobros, ni saldos, ni remitos (grep de `cobr|saldo|cuenta corriente|deuda` en `web/src` y `db/`: cero resultados fuera de comentarios). Lo más cercano es `pedidos.forma_pago` (texto libre) y `clientes.forma_pago_default`.
- **En la app (sin ERP):** tabla `cobros (id_empresa, id_cliente, id_pedido?, id_usuario, monto, medio, comprobante_url, lat, lng, ts, rendido_ts)`; el vendedor o el repartidor registra un cobro en la visita o en la entrega (con foto del comprobante y GPS, como el pedido); **rendición del día** por persona (lo cobrado por medio de pago, con cierre y diferencia); exportación ASCII al ERP con el mismo canal que los pedidos (`export-pedidos`); dona "cobrado por medio" en el dashboard.
- **Del ERP:** el **saldo del cliente** (deuda, vencidos). Se puede ingestar por token como los precios (`ingest-precios`, db/48) en una tabla `saldos_clientes (id_cliente, saldo, vencido, actualizado_ts)`, y mostrarlo en la ficha y en la visita ("debe $X, vencido $Y"). Sin eso, la app muestra lo que cobró, no lo que falta cobrar.

### 14. Stock · **L · impacto alto (cierra el círculo de Faltante)**
- **Hoy:** no hay columna de stock (`db/51:19` lo dice explícito). El vendedor vende lo que el catálogo tiene, el repartidor descubre en el depósito que no está, y recién ahí marca `Sin stock` (que desde el 16/09/2026 se ve en Faltante).
- **Opción A (sin ERP):** `productos.stock_informativo` cargado por planilla por marketing/admin (misma importación que precios) + aviso en la vidriera y en el carrito ("quedan 12"). No descuenta: informa.
- **Opción B (con ERP):** ingesta de existencias por token, con `stock_ts` y semáforo por antigüedad del dato.
- En ambas: Faltante compara "sin stock declarado por el repartidor" contra "stock que decía el sistema" — es el reporte que le muestra al dueño dónde miente el inventario.

### 15. Promociones y listas de precio · **L · impacto medio (depende de cómo vende el cliente)**
- **Hoy:** una lista por empresa; escalas por cantidad ya existen (db/48); oferta por producto (`oferta`, `precio_oferta`). No hay listas por cliente/zona ni promociones con vigencia (2×1, combos, descuento por marca).
- **En la app:** `listas_precio` + `clientes.id_lista`; `promociones (vigencia, regla jsonb)` aplicadas en el carrito con el motivo visible en el ticket.
- **Del ERP:** si el ERP ya maneja listas, ingestarlas por token en vez de duplicar la lógica.

### 16. Devoluciones · **M · impacto medio**
- **Hoy:** el faltante es "no llegó"; no hay forma de registrar "llegó y volvió" (vencido, roto, rechazado en mostrador) ni separado del pedido.
- **En la app:** `devoluciones (id_pedido?, id_cliente, id_producto, cantidad, motivo, foto_url, ts, id_usuario)` cargadas por el repartidor en la entrega o por el vendedor en la visita; reporte junto a Faltante; exportación al ERP como nota de crédito (layout a definir con el cliente).
- **Del ERP:** el formato de la nota de crédito.

---

## Deuda técnica que apareció al hacer el dashboard (para no perderla)

- **`mi_empresa()` por fila en RPC SECURITY DEFINER.** `metricas_actividad` la evaluaba 135.000 veces por semana (db/69 lo arregló: 7 días de > 8 s a ~1 s). Revisar con el mismo `explain analyze` las otras que recorren `posiciones`: `ultimo_punto_equipo` (db/37), `vigilancia_equipo` (db/26/33), `ultimas_posiciones_compartidas` (db/35). La receta es una línea: `v_empresa := mi_empresa()` en el `declare`.
- **Materializar el agregado diario de actividad.** Cada día de la empresa son ~18.000 filas de `posiciones` para producir 60 de salida, y se recalcula por cada usuario que abre el panel (la caché por día de `useMetricasActividad` lo amortigua, no lo resuelve). Un cron a la madrugada que llene `metricas_actividad_dia` para el día cerrado, y que la RPC sólo calcule HOY, saca el 95 % del costo y de paso conserva los km más allá de los 45 días de retención de posiciones.
- **`comercios con compra` del dashboard** es "distintos por vendedor y día" sumados, no clientes únicos del período (la RPC devuelve una fila por día × vendedor). Si se quiere el número exacto, agregar `count(distinct id_cliente)` del período a `metricas_venta_equipo` como una fila aparte o una cuarta RPC.
- **Leaflet tira `clearRect` sobre un mapa destruido** al cambiar de horizonte en `PanelDireccion` (el mini-mapa se re-renderiza): es la excepción asincrónica de la regla 47, preexistente, no la tapa ningún ErrorBoundary. No rompe nada visible; conviene cancelar el `_redraw` pendiente en el cleanup de `LeafletMap`.
