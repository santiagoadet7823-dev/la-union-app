import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import persistence from '../services/persistence'
import { publicar } from '../services/sync'

/**
 * Store compartido de ventas — la columna vertebral del flujo
 * Vendedor → Admin → Repartidor. Persistido vía el puerto `persistence`
 * (localStorage en web, SQLite en nativo) y propagado en vivo por `sync`.
 *
 * Un pedido viaja: 'Pendiente' → 'En camino' → 'Entregado'. Al entregar, el
 * Repartidor declara `cantidad_entregada` por ítem (+ `motivo_faltante` si
 * entrega menos): eso alimenta el Reporte de Faltante (features/reportes).
 */

const KEY_PEDIDOS = 'launion:pedidos'
const VentasContext = createContext(null)

export function VentasProvider({ children }) {
  const [pedidos, setPedidos] = useState([])
  const [listo, setListo] = useState(false)

  // Hidratar desde persistencia al montar.
  useEffect(() => {
    persistence.get(KEY_PEDIDOS, []).then((p) => {
      setPedidos(Array.isArray(p) ? p : [])
      setListo(true)
    })
  }, [])

  // Persistir + propagar en cada cambio (después de la hidratación inicial).
  useEffect(() => {
    if (!listo) return
    persistence.set(KEY_PEDIDOS, pedidos)
    publicar('pedidos-actualizados', { count: pedidos.length })
  }, [pedidos, listo])

  function agregarPedido(pedido) {
    setPedidos((prev) => [...prev, { estado: 'Pendiente', ...pedido }])
  }

  function marcarEnCamino(idPedido) {
    setPedidos((prev) =>
      prev.map((p) =>
        p.id_pedido === idPedido && p.estado === 'Pendiente'
          ? { ...p, estado: 'En camino', timestamp_en_camino: new Date().toISOString() }
          : p
      )
    )
  }

  /**
   * Confirma entrega con evidencia y cantidades reales.
   * @param {string} idPedido
   * @param {{ firmaDataUrl?:string, itemsEntregados?: Record<string,{cantidad:number,motivo?:string}> }} data
   */
  function confirmarEntrega(idPedido, { firmaDataUrl, itemsEntregados = {} } = {}) {
    setPedidos((prev) =>
      prev.map((p) => {
        if (p.id_pedido !== idPedido || p.estado !== 'En camino') return p
        const items = (p.items || []).map((it) => {
          const info = itemsEntregados[it.id_producto]
          const entregada = info ? Number(info.cantidad) : it.cantidad
          const item = { ...it, cantidad_entregada: entregada }
          if (entregada < it.cantidad) item.motivo_faltante = info?.motivo || 'Sin stock'
          return item
        })
        return {
          ...p,
          items,
          estado: 'Entregado',
          timestamp_entregado: new Date().toISOString(),
          firma_dataurl: firmaDataUrl,
        }
      })
    )
  }

  const totales = useMemo(() => {
    const monto = pedidos.reduce((a, p) => a + (p.monto_total || 0), 0)
    const entregados = pedidos.filter((p) => p.estado === 'Entregado').length
    return { pedidos: pedidos.length, monto, entregados }
  }, [pedidos])

  const value = {
    pedidos,
    setPedidos,
    agregarPedido,
    marcarEnCamino,
    confirmarEntrega,
    totales,
    listo,
  }

  return <VentasContext.Provider value={value}>{children}</VentasContext.Provider>
}

export function useVentas() {
  const ctx = useContext(VentasContext)
  if (!ctx) throw new Error('useVentas debe usarse dentro de <VentasProvider>')
  return ctx
}
