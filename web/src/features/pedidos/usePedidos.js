import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { useTenant } from '../../context/TenantContext'
import { EVENTO_CUARENTENA } from '../../services/sync/writeQueue'
import { codigoVendedorErp } from '../../lib/asciiPedidos'

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
const EN_PARALELO = 3  // páginas pedidas a la vez después de la primera (plan 50)

/** Orden de la lista: lo más nuevo arriba, con desempate por id (el mismo de la consulta). */
const masNuevoPrimero = (a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

// Las columnas del pedido + el comercio y la persona por relación. Se nombran una por una y no con
// `*`: es la misma disciplina del ticket — una columna nueva en `pedidos` no debería aparecer sola
// en una pantalla sin que alguien lo haya decidido.
const SELECT = `
  id, numero, id_empresa, id_vendedor, id_cliente, id_repartidor, id_visita, estado, monto_total, peso_total,
  created_at, lat, lng, accuracy, distancia_m, origen, motivo_anulacion, anulado_por, anulado_ts,
  anulado_srv_ts, forma_pago, fecha_entrega, observaciones, exportado_ts, export_lote,
  cliente:clientes!pedidos_id_cliente_fkey ( id, codigo, nombre_comercio, localidad, direccion, lat, lng, telefono, contacto, exportado_ts ),
  vendedor:perfiles!pedidos_id_vendedor_fkey ( id, nombre, codigo_erp, numero )
`

/** Fila de `clientes` → la forma que ya consumen `TicketPedido` y el resto de las vistas. */
export function mapComercio(c) {
  if (!c) return null
  return {
    id: c.id, codigo: c.codigo, name: c.nombre_comercio, loc: c.localidad || '', direccion: c.direccion || '', lat: c.lat, lng: c.lng,
    telefono: c.telefono || '', contacto: c.contacto || '',
    // db/92: ¿el ERP ya recibió a este comercio? Tri-estado a propósito: `undefined` cuando la fila
    // no trajo la columna (otro select), para que `motivoRetencion` no lo confunda con "no salió".
    exportado: c.exportado_ts === undefined ? undefined : !!c.exportado_ts,
  }
}

/** Un pedido de la base → la forma de la pantalla, con el comercio ya mapeado. */
function mapPedido(p) {
  return {
    ...p,
    comercio: mapComercio(p.cliente),
    nombreVendedor: p.vendedor?.nombre || null,
    // El código con el que el ERP conoce a este vendedor (campo 3 del archivo): `codigo_erp` o el
    // "Código de vendedor" de Usuarios a 3 dígitos. `null` = el pedido queda retenido (db/74) y la
    // lista lo dice; ver `codigoVendedorErp`.
    codigoVendedor: codigoVendedorErp(p.vendedor),
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
  // `cargando`: todavía no hay NADA que mostrar. `completo`: llegaron todas las páginas (lo que
  // necesitan el consolidado y la exportación). `total`: cuántos dice la base (para "1.000 de 4.519").
  const [estado, setEstado] = useState({ pedidos: [], cargando: true, completo: false, total: null, error: null })
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
    setEstado((e) => (e.pedidos.length ? { ...e, completo: false } : { ...e, cargando: true, completo: false }))

    function pagina(vuelta, conConteo = false) {
      let q = supabase.from('pedidos').select(SELECT, conConteo ? { count: 'exact' } : undefined)
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
      return q.then(({ data, error, count }) => { if (error) throw error; return { data: data || [], count } })
    }

    /* 🩸 LA PRIMERA PÁGINA SE MUESTRA SOLA (19/11/2026, plan 50). Antes las páginas iban una detrás de
     * otra y nada se veía hasta la última: 30 días son 4 519 pedidos ≈ 2,5 MB, y con 4G la pantalla
     * quedaba en "Cargando pedidos…" como tildada (la base contesta cada página en ≈ 30 ms; el tiempo
     * es todo de red). Ahora la página 1 —lo más nuevo, lo que se viene a mirar— trae además el conteo
     * y se pinta apenas llega; las demás salen de a `EN_PARALELO` y se van sumando. Mientras tanto
     * `completo` es false y la pantalla no deja sacar el consolidado ni exportar sobre una lista a
     * medias. Cada página se SUMA a lo que hay (sin repetir ids) en vez de reemplazar: así una
     * anulación aplicada mientras carga no se pisa con la llegada de la página siguiente. */
    const agregar = (data) => setEstado((e) => {
      const ya = new Set(e.pedidos.map((p) => p.id))
      const nuevos = []
      for (const p of data) if (!ya.has(p.id)) nuevos.push(mapPedido(p))
      return nuevos.length ? { ...e, pedidos: [...e.pedidos, ...nuevos].sort(masNuevoPrimero) } : e
    })

    ;(async () => {
      try {
        const primera = await pagina(0, true)
        if (!vivo) return
        const total = Number.isFinite(primera.count) ? primera.count : null
        const termina = primera.data.length < PAGE
        // La primera página REEMPLAZA (una relectura no debe arrastrar filas que ya no corresponden).
        setEstado({ pedidos: primera.data.map(mapPedido), cargando: false, completo: termina, total: termina ? primera.data.length : total, error: null })
        if (termina) return

        // Las que dice el conteo, de a varias. Si mientras tanto entraron pedidos nuevos, las páginas
        // se corren: la deduplicación por id evita repetidos y el bucle de abajo junta la cola.
        const paginas = Math.min(MAX_VUELTAS, Math.ceil((total ?? PAGE * 2) / PAGE))
        const cola = []
        for (let v = 1; v < paginas; v++) cola.push(v)
        let ultimaLlena = false
        let maxVuelta = 0
        async function trabajador() {
          while (cola.length && vivo) {
            const v = cola.shift()
            const { data } = await pagina(v)
            if (!vivo) return
            agregar(data)
            if (v > maxVuelta) { maxVuelta = v; ultimaLlena = data.length === PAGE }
          }
        }
        await Promise.all(Array.from({ length: Math.min(EN_PARALELO, cola.length) }, trabajador))
        // Si la última página prevista vino llena, hay más de lo que dijo el conteo: se sigue de a una.
        for (let v = paginas; ultimaLlena && v < MAX_VUELTAS && vivo; v++) {
          const { data } = await pagina(v)
          if (!vivo) return
          agregar(data)
          ultimaLlena = data.length === PAGE
        }
        if (vivo) setEstado((e) => ({ ...e, completo: true, total: e.pedidos.length }))
      } catch (e) {
        // Sin red se CONSERVA lo que había: vaciar la lista por un fallo de lectura hacía que un
        // pedido recién anulado offline "desapareciera" de la pantalla con la mutación en cola.
        // `completo` queda en false: lo que hay puede estar a medias, y el error lo dice.
        if (vivo) setEstado((prev) => ({ ...prev, cargando: false, error: e?.message || String(e) }))
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
 * IDS (un `in` con mil uuid también hace explotar la URL) y, adentro de cada lote, por `range()` de
 * a 500: el lote de ids solo no alcanza (25/10/2026: 100 pedidos seguidos llegaron a 690 líneas).
 *
 * 🔑 EL CÓDIGO DEL PRODUCTO SALE DE LA LÍNEA (db/62). Desde el 10/09/2026 se copia al confirmar,
 * igual que `descripcion` y `precio_unitario`: es el campo 18 del archivo del ERP, y con la relación
 * viva un producto borrado del catálogo dejaba la celda VACÍA — en un comprobante que ya se vendió,
 * y que su importador rechaza. La relación se conserva sólo como respaldo para los pedidos
 * anteriores a la migración, y por eso el orden del `||` no es intercambiable.
 *
 * `conProducto` (plan 42, consolidado): trae además del catálogo de HOY las unidades por bulto,
 * categoría, marca y unidad de venta — no hay copia de eso en el renglón.
 *
 * @returns {Promise<Map<string, object[]>>} id de pedido → sus líneas
 */
export async function itemsDePedidos(ids, { conProducto = false } = {}) {
  const porPedido = new Map()
  if (!ids?.length) return porPedido
  const LOTE = 100
  const PAGINA = 500
  const producto = conProducto ? 'codigo, unidades, categoria, marca, unidad_venta' : 'codigo'
  for (let i = 0; i < ids.length; i += LOTE) {
    const trozo = ids.slice(i, i + LOTE)
    for (let desde = 0; ; desde += PAGINA) {
      const { data, error } = await supabase
        .from('pedido_items')
        .select(`id, id_pedido, id_producto, codigo_producto, descripcion, cantidad, cantidad_entregada, motivo_faltante, precio_unitario, peso_kg, pedidos!inner(id_empresa), producto:productos ( ${producto} )`)
        .in('id_pedido', trozo)
        .order('descripcion', { ascending: true })
        .order('id', { ascending: true }) // desempate estable: sin él, `range` puede repetir o saltear
        .range(desde, desde + PAGINA - 1)
      if (error) throw error
      for (const l of data || []) {
        const arr = porPedido.get(l.id_pedido) || []
        arr.push({ ...l, codigoProducto: l.codigo_producto || l.producto?.codigo || null })
        porPedido.set(l.id_pedido, arr)
      }
      if ((data || []).length < PAGINA) break
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
