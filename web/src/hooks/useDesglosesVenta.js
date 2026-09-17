import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useTenant } from '../context/TenantContext'
import { hoyStr } from '../lib/format'
import { sumarDias } from '../lib/comparar'

/**
 * Las dos tortas del dashboard: pedidos por estado y ventas por categoría/marca, sobre el
 * período que se está mirando (hoy / semana / mes). Dos RPC de db/68, una consulta cada una,
 * sin caché ni refresco automático: son desgloses de un período, no un pulso en vivo, y se
 * vuelven a pedir al cambiar de horizonte o al tocar "reintentar".
 *
 * Devuelve las filas tal cual las manda la base; agrupar por categoría o por marca (el toggle de
 * la tarjeta) es una suma en el cliente sobre ~decenas de filas.
 */
const DIAS = { hoy: 1, semana: 7, mes: 30 }

export default function useDesglosesVenta(horizonte = 'hoy', activo = true) {
  const { idEmpresaActiva, esOverride, esTodas } = useTenant()
  const pEmpresa = esOverride && !esTodas ? idEmpresaActiva : null
  const activoReal = activo && !esTodas

  const [estados, setEstados] = useState([])       // [{ estado, cantidad, monto }]
  const [categorias, setCategorias] = useState([]) // [{ categoria, marca, monto, unidades, pedidos }]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const hasta = hoyStr()
  const desde = sumarDias(hasta, -((DIAS[horizonte] || 1) - 1))

  const cargar = useCallback(async () => {
    if (!activoReal) { setLoading(false); return }
    setLoading(true)
    const args = { p_desde: desde, p_hasta: hasta, p_empresa: pEmpresa }
    const [e1, e2] = await Promise.all([
      supabase.rpc('pedidos_por_estado', args),
      supabase.rpc('ventas_por_categoria', args),
    ])
    const err = e1.error || e2.error
    if (err) {
      console.error('[desgloses] la RPC falló', { desde, hasta, msg: err.message }, err)
      setError(err)
    } else {
      setError(null)
      setEstados(e1.data || [])
      setCategorias(e2.data || [])
    }
    setLoading(false)
  }, [activoReal, desde, hasta, pEmpresa])

  useEffect(() => { cargar() }, [cargar])

  return { estados, categorias, loading, error, desde, hasta, reload: cargar }
}
