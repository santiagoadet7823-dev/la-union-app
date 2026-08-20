import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { useTenant } from '../../context/TenantContext'

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
  id, numero, id_vendedor, id_cliente, id_visita, estado, monto_total, peso_total,
  created_at, lat, lng, accuracy, distancia_m, origen, motivo_anulacion, anulado_por, anulado_ts,
  cliente:clientes!pedidos_id_cliente_fkey ( id, codigo, nombre_comercio, localidad, lat, lng ),
  vendedor:perfiles!pedidos_id_vendedor_fkey ( id, nombre )
`

/** Fila de `clientes` → la forma que ya consumen `TicketPedido` y el resto de las vistas. */
export function mapComercio(c) {
  if (!c) return null
  return { id: c.id, codigo: c.codigo, name: c.nombre_comercio, loc: c.localidad || '', lat: c.lat, lng: c.lng }
}

/** Un pedido de la base → la forma de la pantalla, con el comercio ya mapeado. */
function mapPedido(p) {
  return { ...p, comercio: mapComercio(p.cliente), nombreVendedor: p.vendedor?.nombre || null }
}

/**
 * Los pedidos de un rango, con filtros opcionales.
 *
 * @param {string} desde  ISO inclusive
 * @param {string} hasta  ISO exclusivo
 * @param {string|null} idVendedor  filtra por persona (lo usa "Mis pedidos" y el selector de gestión)
 * @param {boolean} incluirAnulados  false esconde los anulados de la lista
 */
export function usePedidos({ desde, hasta, idVendedor = null, incluirAnulados = true }) {
  const { idEmpresaActiva, esTodas } = useTenant()
  const [estado, setEstado] = useState({ pedidos: [], cargando: true, error: null })
  // Cambiarlo fuerza una relectura. Es lo que usa la pantalla después de anular o borrar: la lista
  // tiene que reflejar lo que quedó en la base, no lo que creemos que quedó.
  const [ciclo, setCiclo] = useState(0)
  const recargar = useCallback(() => setCiclo((n) => n + 1), [])

  useEffect(() => {
    if (!desde || !hasta || !idEmpresaActiva) return
    let vivo = true
    setEstado((e) => ({ ...e, cargando: true }))
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
          if (!incluirAnulados) q = q.neq('estado', 'Anulado')

          const { data, error } = await q
          if (error) throw error
          filas.push(...(data || []))
          if (!data || data.length < PAGE) break
        }
        if (!vivo) return
        setEstado({ pedidos: filas.map(mapPedido), cargando: false, error: null })
      } catch (e) {
        if (vivo) setEstado({ pedidos: [], cargando: false, error: e?.message || String(e) })
      }
    })()
    return () => { vivo = false }
  }, [desde, hasta, idVendedor, incluirAnulados, idEmpresaActiva, esTodas, ciclo])

  return useMemo(() => ({ ...estado, recargar }), [estado, recargar])
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
    .select('id, id_producto, descripcion, cantidad, precio_unitario, peso_kg')
    .eq('id_pedido', idPedido)
    .order('descripcion', { ascending: true })
  if (error) throw error
  return data || []
}

/** Las personas que tienen pedidos en el rango, para el selector. Sale de lo ya cargado. */
export function vendedoresDe(pedidos) {
  const m = new Map()
  for (const p of pedidos) if (p.id_vendedor) m.set(p.id_vendedor, p.nombreVendedor || '—')
  return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
}
