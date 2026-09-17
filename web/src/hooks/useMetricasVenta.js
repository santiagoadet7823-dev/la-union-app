import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../services/supabase'
import { persistence } from '../services/persistence'
import { useAuth } from '../context/AuthContext'
import { useTenant } from '../context/TenantContext'
import { hoyStr } from '../lib/format'
import { sumarDias } from '../lib/comparar'

/**
 * Ventas agregadas del equipo para el dashboard: el hermano de `useMetricasActividad`, con la
 * misma firma, las mismas ventanas y la misma caché — a propósito. Lo que sale de acá tiene la
 * forma que `lib/comparar.js` ya sabe leer (`serie = { 'YYYY-MM-DD': valor }`), así el delta
 * contra el período anterior, la sparkline y la regla "sin registro ≠ 0" son las mismas para
 * kilómetros y para pesos, sin una segunda implementación que después diverja.
 *
 * Los datos los agrega la RPC `metricas_venta_equipo` (db/68): una fila por día × vendedor con
 * monto, pedidos, clientes, visitas, visitas con pedido y anulados. Acá no baja un pedido.
 *
 * Igual que en el hook de actividad: el histórico (hasta ayer) se pide UNA vez por día y
 * horizonte y se guarda en `persistence`; sólo `hoy` se refresca cada 60 s. Para ventas el costo
 * de la RPC es mucho menor (agrupa `pedidos`, no recorre `posiciones`), pero el patrón se conserva
 * porque es el que la pantalla ya sabe manejar y porque el volumen de pedidos crece.
 *
 * Scope: la RPC decide adentro (rol, `mi_empresa()`, `ids_a_mi_cargo()`). `p_empresa` sólo viaja
 * cuando un superadmin está mirando OTRA empresa (`useTenant().esOverride`); para "todas las
 * empresas" (`esTodas`) el hook se apaga, como `useMetricasActividad` con `multiEmpresa`.
 *
 * @param {'hoy'|'semana'|'mes'} horizonte
 * @param {boolean} activo
 */
const VENTANAS = {
  hoy:    { dias: 1,  barras: 8,  atras: 28 },
  semana: { dias: 7,  barras: 7,  atras: 28 },
  mes:    { dias: 30, barras: 30, atras: 120 },
}

const REFRESH_MS = 60000
const CACHE_KEY = 'lu-ventas-cache'

export default function useMetricasVenta(horizonte = 'hoy', activo = true) {
  const { user } = useAuth()
  const { idEmpresaActiva, esOverride, esTodas } = useTenant()
  const uid = user?.id || null
  const pEmpresa = esOverride && !esTodas ? idEmpresaActiva : null
  const activoReal = activo && !esTodas

  const [historico, setHistorico] = useState([])
  const [hoyFilas, setHoyFilas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  const cfg = VENTANAS[horizonte] || VENTANAS.hoy
  const hasta = hoyStr()
  const desde = sumarDias(hasta, -(cfg.dias - 1))
  const desdeConsulta = sumarDias(desde, -cfg.atras)

  const rpc = useCallback(async (p_desde, p_hasta) => {
    const { data, error: e } = await supabase.rpc('metricas_venta_equipo', { p_desde, p_hasta, p_empresa: pEmpresa })
    if (e) {
      console.error('[ventas] la RPC falló', { p_desde, p_hasta, horizonte, msg: e.message }, e)
      setError(e)
      return null
    }
    setError(null)
    return data || []
  }, [horizonte, pEmpresa])

  const cargarHoy = useCallback(async () => {
    if (!activoReal) return
    const data = await rpc(hasta, hasta)
    if (!data) return
    setHoyFilas(data)
    setUpdatedAt(Date.now())
  }, [activoReal, hasta, rpc])

  const cargarHistorico = useCallback(async (forzar) => {
    if (!activoReal) return
    const ayer = sumarDias(hasta, -1)
    const clave = `${uid}|${pEmpresa || ''}|${horizonte}|${hasta}`
    if (!forzar) {
      const cache = await persistence.get(CACHE_KEY)
      if (cache && cache.clave === clave && Array.isArray(cache.filas)) {
        setHistorico(cache.filas)
        return
      }
    }
    const data = await rpc(desdeConsulta, ayer)
    if (!data) return
    setHistorico(data)
    persistence.set(CACHE_KEY, { clave, filas: data })
  }, [activoReal, hasta, horizonte, uid, pEmpresa, desdeConsulta, rpc])

  const cargar = useCallback(async (silencioso, forzar = false) => {
    if (!activoReal) { setLoading(false); return }
    if (!silencioso) setLoading(true)
    await Promise.all([cargarHistorico(forzar), cargarHoy()])
    if (!silencioso) setLoading(false)
  }, [activoReal, cargarHistorico, cargarHoy])

  useEffect(() => { cargar(false) }, [cargar])

  useEffect(() => {
    if (!activoReal || hasta !== hoyStr()) return
    const iv = setInterval(cargarHoy, REFRESH_MS)
    return () => clearInterval(iv)
  }, [activoReal, hasta, cargarHoy])

  const filas = useMemo(() => [...historico.filter((f) => f.dia !== hasta), ...hoyFilas], [historico, hoyFilas, hasta])

  const derivado = useMemo(() => {
    const porDia = {}       // equipo por día (toda la ventana): alimenta comparaciones y series
    const porVendedor = {}  // acumulado por persona dentro del período mostrado
    const porDiaVendedor = {} // { dia: { idVendedor: monto } } dentro del período: barras apiladas

    for (const f of filas) {
      const dia = f.dia
      const monto = Number(f.monto) || 0
      const pedidos = Number(f.pedidos) || 0
      const clientes = Number(f.clientes) || 0
      const visitas = Number(f.visitas) || 0
      const vcp = Number(f.visitas_con_pedido) || 0
      const anulados = Number(f.anulados) || 0

      const d = porDia[dia] || (porDia[dia] = { monto: 0, pedidos: 0, clientes: 0, visitas: 0, visitasConPedido: 0, anulados: 0 })
      d.monto += monto; d.pedidos += pedidos; d.clientes += clientes
      d.visitas += visitas; d.visitasConPedido += vcp; d.anulados += anulados

      if (dia >= desde && dia <= hasta) {
        const u = porVendedor[f.id_vendedor] || (porVendedor[f.id_vendedor] = {
          id: f.id_vendedor, monto: 0, pedidos: 0, clientes: 0, visitas: 0, visitasConPedido: 0, anulados: 0, dias: 0,
        })
        u.monto += monto; u.pedidos += pedidos; u.clientes += clientes
        u.visitas += visitas; u.visitasConPedido += vcp; u.anulados += anulados
        u.dias++
        const dv = porDiaVendedor[dia] || (porDiaVendedor[dia] = {})
        dv[f.id_vendedor] = (dv[f.id_vendedor] || 0) + monto
      }
    }

    // Series planas: sólo días CON registro (un día ausente es "no sabemos", ver comparar.js).
    // Un día en el que hubo visitas pero cero pedidos SÍ es un registro: monto 0 de verdad.
    const serieMonto = {}
    const seriePedidos = {}
    const serieVisitas = {}
    for (const [dia, v] of Object.entries(porDia)) {
      serieMonto[dia] = v.monto
      seriePedidos[dia] = v.pedidos
      serieVisitas[dia] = v.visitas
    }

    const total = Object.values(porVendedor).reduce(
      (a, u) => ({
        monto: a.monto + u.monto, pedidos: a.pedidos + u.pedidos, visitas: a.visitas + u.visitas,
        visitasConPedido: a.visitasConPedido + u.visitasConPedido, anulados: a.anulados + u.anulados,
      }),
      { monto: 0, pedidos: 0, visitas: 0, visitasConPedido: 0, anulados: 0 }
    )
    // `clientes` por día es "distintos ese día"; sumarlos entre días contaría dos veces al que
    // compró lunes y jueves. Como aproximación honesta se toma el MÁXIMO diario cuando el período
    // es un día, y la suma por vendedor (distintos por vendedor-día) queda como techo. Se etiqueta
    // como "comercios con compra" y no como "clientes únicos" por esto mismo.
    total.clientes = Object.values(porVendedor).reduce((a, u) => a + u.clientes, 0)
    total.ticket = total.pedidos ? total.monto / total.pedidos : null
    total.efectividad = total.visitas ? total.visitasConPedido / total.visitas : null

    return { porDia, porVendedor, porDiaVendedor, serieMonto, seriePedidos, serieVisitas, total }
  }, [filas, desde, hasta])

  return {
    ...derivado,
    desde, hasta, barras: cfg.barras,
    loading, error, updatedAt,
    activo: activoReal,
    reload: () => cargar(false, true),
  }
}
