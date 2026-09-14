import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { useTenant } from '../../context/TenantContext'
import { EVENTO_CUARENTENA } from '../../services/sync/writeQueue'

/**
 * LOS PEDIDOS, PARA REVISARLOS.
 *
 * 🩸 POR QUÉ EXISTE (20/08/2026). `db/43` hizo que el pedido se guardara y `TicketPedido` que se
 * imprimiera, pero NADIE los volvía a leer nunca: no había una sola consulta a `pedidos` en toda la
 * app fuera del informe de jornada. El reporte del dueño fue literal — "acabo de hacer un pedido y
 * no encuentro dónde eliminarlo". Este hook es la mitad de datos de esa pantalla.
 *
 * 🔴 `.eq('id_empresa')` EXPLÍCITO, igual que en todas las lecturas. RLS **no filtra para
 * superadmin** (Fase 1 del SaaS): sin esto, la pantalla de una distribuidora mostraría los pedidos
 * de las otras. La policy es el piso, no el filtro.
 *
 * ⚠️ PAGINADO OBLIGATORIO. PostgREST corta en 1.000 filas y **devuelve 200 igual**, sin ninguna
 * señal de que faltan — el bug que ya se pagó con los recorridos truncados y con media cartera. Un
 * mes de nueve vendedores pasa las 1.000 filas sin esfuerzo, así que acá no es hipotético.
 *
 * LO QUE **NO** HACE, Y ES A PROPÓSITO:
 *
 *  · **No trae las líneas.** La lista muestra número, comercio, persona y monto; las líneas se
 *    piden recién al abrir un pedido (`itemsDePedido`). Traerlas todas serían diez filas por pedido
 *    para dibujar un renglón que no las usa.
 *  · **No filtra por rol.** Quién ve qué lo decide `pedidos_sel` en el servidor (`db/45`), que desde
 *    hoy obedece la jerarquía de `ids_a_mi_cargo()`. Repetir esa regla acá sería tener dos verdades
 *    y que una se olvide de actualizarse.
 *
 * El comercio y la persona vienen EMBEBIDOS en la misma consulta en vez de cruzarse contra
 * `useCatalog()`: con el scope de superadmin puesto en otra empresa, el catálogo cargado puede no
 * ser el de los pedidos que se están mirando, y ahí el cruce daría nombres vacíos o —peor— el
 * comercio equivocado.
 */

const PAGE = 1000
const MAX_VUELTAS = 50 // 50.000 pedidos: techo de seguridad, nunca un bucle infinito

// Las columnas del pedido + el comercio y la persona por relación. Se nombran una por una y no con
// `*`: es la misma disciplina del ticket — una columna nueva en `pedidos` no debería aparecer sola
// en una pantalla sin que alguien lo haya decidido.
const SELECT = `
  id, numero, id_empresa, id_vendedor, id_cliente, id_repartidor, id_visita, estado, monto_total, peso_total,
  created_at, lat, lng, accuracy, distancia_m, origen, motivo_anulacion, anulado_por, anulado_ts,
  anulado_srv_ts, forma_pago, fecha_entrega, observaciones, exportado_ts, export_lote,
  cliente:clientes!pedidos_id_cliente_fkey ( id, codigo, nombre_comercio, localidad, lat, lng, telefono, contacto ),
  vendedor:perfiles!pedidos_id_vendedor_fkey ( id, nombre, codigo_erp )
`

/** Fila de `clientes` → la forma que ya consumen `TicketPedido` y el resto de las vistas. */
export function mapComercio(c) {
  if (!c) return null
  return {
    id: c.id, codigo: c.codigo, name: c.nombre_comercio, loc: c.localidad || '', lat: c.lat, lng: c.lng,
    telefono: c.telefono || '', contacto: c.contacto || '',
  }
}

/** Un pedido de la base → la forma de la pantalla, con el comercio ya mapeado. */
function mapPedido(p) {
  return {
    ...p,
    comercio: mapComercio(p.cliente),
    nombreVendedor: p.vendedor?.nombre || null,
    // El código con el que el ERP conoce a este vendedor (campo 3 del archivo, db/62). Puede venir
    // vacío: si nadie lo cargó, el exportador cae en la constante de la empresa.
    codigoVendedor: p.vendedor?.codigo_erp || null,
  }
}

/**
 * Los pedidos de un rango, con filtros opcionales.
 *
 * @param {string} desde  ISO inclusive
 * @param {string} hasta  ISO exclusivo
 * @param {string|null} idVendedor  filtra por persona (lo usa "Mis pedidos" y el selector de gestión)
 * @param {boolean} papelera  `false` (por defecto) trae los pedidos VIVOS; `true` trae SOLO los anulados
 */
/* 🩸 ANTES ESTE PARÁMETRO ERA `incluirAnulados` Y VENÍA EN `true` (11/09/2026).
 *
 * O sea que la lista de gestión mezclaba por defecto los anulados con los vivos, tachados y en
 * gris, y quien quisiera verlos aparte tenía que acordarse de destildar un checkbox. El dueño pidió
 * lo contrario: que lo anulado quede APARTADO, no atenuado. Y hay una razón más dura que el gusto —
 * con la purga de `db/63` esos pedidos ahora tienen fecha de vencimiento, y algo que va a
 * desaparecer solo en 30 días no puede estar mezclado con lo que no.
 *
 * El cambio de nombre es a propósito y no es cosmético: `incluirAnulados` era binario entre "todo" y
 * "sin anulados", y la papelera necesita el tercer caso —**sólo** anulados— que con aquel nombre no
 * se podía pedir. Son dos vistas distintas de la misma tabla, no un filtro opcional.
 */
export function usePedidos({ desde, hasta, idVendedor = null, papelera = false }) {
  const { idEmpresaActiva, esTodas } = useTenant()
  const [estado, setEstado] = useState({ pedidos: [], cargando: true, error: null })
  // Cambiarlo fuerza una relectura (botón "Reintentar", cambio de rango). Después de anular,
  // corregir o asignar ya NO se usa: la pantalla aplica la fila resultante con `aplicar`/`quitar`.
  const [ciclo, setCiclo] = useState(0)
  const recargar = useCallback(() => setCiclo((n) => n + 1), [])

  /* 🩸 LOCAL PRIMERO, LA RED DESPUÉS (13/09/2026).
   *
   * Hasta hoy cada acción sobre un pedido —anular, corregir, asignar repartidor, borrar— terminaba
   * con `recargar()` de las DOS listas (activos y papelera): dos consultas paginadas con el embed
   * de cliente y vendedor, la lista reemplazada por "Cargando pedidos…" mientras tanto, y sin red
   * la lista quedaba VACÍA con un error, aunque la mutación estuviera bien guardada en la cola. El
   * motivo era honesto (un UPDATE que RLS rechaza afecta cero filas sin error) pero la relectura
   * no lo resolvía offline y le costaba a cada acción dos viajes por datos móviles.
   *
   * Ahora las mutaciones ya devuelven la fila como queda (`anularPedido`, `editarPedido`,
   * `asignarRepartidor`) y la pantalla la APLICA acá. El rechazo silencioso lo detecta la cola
   * (`verificar: true` → cuarentena `SIN_FILAS`, ver writeQueue.js), que es donde corresponde:
   * es la cola la que sabe si el servidor aceptó o no. */

  /**
   * Aplica a la lista un pedido tal como queda después de una acción. Si su estado ya no
   * corresponde a esta lista (anulado en la de vivos, o al revés) lo quita; si corresponde y no
   * estaba, lo agrega adelante; si estaba, lo reemplaza. Acepta la fila en la forma de la pantalla
   * (con `comercio`) o cruda de la base (con `cliente`): `mapPedido` es idempotente sobre la primera.
   */
  const aplicar = useCallback((pedido) => {
    if (!pedido?.id) return
    const fila = pedido.comercio !== undefined ? pedido : mapPedido(pedido)
    const vaAca = papelera ? fila.estado === 'Anulado' : fila.estado !== 'Anulado'
    setEstado((e) => {
      const sin = e.pedidos.filter((p) => p.id !== fila.id)
      if (!vaAca) return sin.length === e.pedidos.length ? e : { ...e, pedidos: sin }
      const estaba = e.pedidos.some((p) => p.id === fila.id)
      const pedidos = estaba ? e.pedidos.map((p) => (p.id === fila.id ? { ...p, ...fila } : p)) : [fila, ...sin]
      return { ...e, pedidos }
    })
  }, [papelera])

  /** Saca un pedido de la lista (borrado definitivo). */
  const quitar = useCallback((id) => {
    setEstado((e) => (e.pedidos.some((p) => p.id === id) ? { ...e, pedidos: e.pedidos.filter((p) => p.id !== id) } : e))
  }, [])

  useEffect(() => {
    if (!desde || !hasta || !idEmpresaActiva) return
    let vivo = true
    // `cargando` sólo si no hay nada que mostrar (mismo criterio que CatalogContext.recargar del
    // 10/09): una relectura con lista en pantalla es una revalidación silenciosa, no un spinner.
    setEstado((e) => (e.pedidos.length ? e : { ...e, cargando: true }))
    ;(async () => {
      try {
        const filas = []
        for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
          let q = supabase.from('pedidos').select(SELECT)
            .gte('created_at', desde).lt('created_at', hasta)
            // Descendente: lo último que pasó es lo que se viene a revisar. El desempate por `id`
            // no es decorativo — sin un orden TOTAL, dos pedidos con el mismo `created_at` pueden
            // repartirse entre dos páginas y perderse o repetirse.
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(vuelta * PAGE, vuelta * PAGE + PAGE - 1)
          // El centinela de "todas las empresas" es el string '*', no null.
          if (!esTodas) q = q.eq('id_empresa', idEmpresaActiva)
          if (idVendedor) q = q.eq('id_vendedor', idVendedor)
          q = papelera ? q.eq('estado', 'Anulado') : q.neq('estado', 'Anulado')

          const { data, error } = await q
          if (error) throw error
          filas.push(...(data || []))
          if (!data || data.length < PAGE) break
        }
        if (!vivo) return
        setEstado({ pedidos: filas.map(mapPedido), cargando: false, error: null })
      } catch (e) {
        // Sin red se CONSERVA lo que había: vaciar la lista por un fallo de lectura hacía que un
        // pedido recién anulado offline "desapareciera" de la pantalla con la mutación en cola.
        if (vivo) setEstado((prev) => ({ pedidos: prev.pedidos, cargando: false, error: e?.message || String(e) }))
      }
    })()
    return () => { vivo = false }
  }, [desde, hasta, idVendedor, papelera, idEmpresaActiva, esTodas, ciclo])

  // Si la cola apartó una mutación de pedidos (RLS la rechazó, regla de negocio, etc.), lo que se
  // aplicó en local ya no es lo que hay en la base: se revalida en silencio (la lista se conserva
  // mientras llega). Es el único caso en que una acción termina en una relectura.
  useEffect(() => {
    const onCuarentena = (ev) => {
      const t = ev?.detail?.table
      if (t === 'pedidos' || t === 'pedido_items') recargar()
    }
    window.addEventListener(EVENTO_CUARENTENA, onCuarentena)
    return () => window.removeEventListener(EVENTO_CUARENTENA, onCuarentena)
  }, [recargar])

  return useMemo(() => ({ ...estado, recargar, aplicar, quitar }), [estado, recargar, aplicar, quitar])
}

/**
 * Las líneas de UN pedido. Se piden al abrirlo, no con la lista.
 *
 * `descripcion` y `precio_unitario` vienen COPIADOS en la línea desde que se tomó el pedido (db/43):
 * el detalle de hace seis meses tiene que seguir diciendo lo que se vendió y a cuánto, aunque
 * marketing haya renombrado el producto o le haya cambiado el precio.
 */
export async function itemsDePedido(idPedido) {
  const { data, error } = await supabase
    .from('pedido_items')
    .select('id, id_producto, codigo_producto, descripcion, cantidad, precio_unitario, peso_kg')
    .eq('id_pedido', idPedido)
    .order('descripcion', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Las líneas de VARIOS pedidos, en lote. La usa el export: con `itemsDePedido` sería una consulta
 * por pedido — un día de nueve vendedores son decenas de idas y vueltas por un archivo.
 *
 * ⚠️ **`pedido_items` NO tiene `id_empresa`.** El alcance de tenant lo pone la lista de ids, que
 * viene de una consulta ya filtrada por empresa; el `pedidos!inner(id_empresa)` es el cinturón
 * además de los tirantes, para que una llamada futura con ids de otro lado no cruce distribuidoras.
 * Es el mismo truco que usa `RespaldoDatos` con esta tabla.
 *
 * ⚠️ Paginado por partida: PostgREST corta en 1.000 filas y **devuelve 200 igual**. Diez líneas por
 * pedido hacen que 100 pedidos ya pasen el techo, así que acá no es hipotético. Se parte por LOTE DE
 * IDS y no por `range()`: un `in` con mil uuid también hace explotar la URL.
 *
 * 🔑 EL CÓDIGO DEL PRODUCTO SALE DE LA LÍNEA (db/62). Desde el 10/09/2026 se copia al confirmar,
 * igual que `descripcion` y `precio_unitario`: es el campo 18 del archivo del ERP, y con la relación
 * viva un producto borrado del catálogo dejaba la celda VACÍA — en un comprobante que ya se vendió,
 * y que su importador rechaza. La relación se conserva sólo como respaldo para los pedidos
 * anteriores a la migración, y por eso el orden del `||` no es intercambiable.
 *
 * @returns {Promise<Map<string, object[]>>} id de pedido → sus líneas
 */
export async function itemsDePedidos(ids) {
  const porPedido = new Map()
  if (!ids?.length) return porPedido
  const LOTE = 100
  for (let i = 0; i < ids.length; i += LOTE) {
    const trozo = ids.slice(i, i + LOTE)
    const { data, error } = await supabase
      .from('pedido_items')
      .select('id, id_pedido, id_producto, codigo_producto, descripcion, cantidad, cantidad_entregada, motivo_faltante, precio_unitario, peso_kg, pedidos!inner(id_empresa), producto:productos ( codigo )')
      .in('id_pedido', trozo)
      .order('descripcion', { ascending: true })
    if (error) throw error
    for (const l of data || []) {
      const arr = porPedido.get(l.id_pedido) || []
      arr.push({ ...l, codigoProducto: l.codigo_producto || l.producto?.codigo || null })
      porPedido.set(l.id_pedido, arr)
    }
  }
  return porPedido
}

/** Las personas que tienen pedidos en el rango, para el selector. Sale de lo ya cargado. */
export function vendedoresDe(pedidos) {
  const m = new Map()
  for (const p of pedidos) if (p.id_vendedor) m.set(p.id_vendedor, p.nombreVendedor || '—')
  return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
}
