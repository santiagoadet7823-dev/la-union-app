import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { calcularMetricas } from './metas'
import { rangosDeHoy } from './useMetas'

/**
 * LOS DATOS DEL TABLERO: qué vendo, qué no vendo, y a quién dejé de ver.
 *
 * 🩸 POR QUÉ SE SEPARÓ DE `useMetas` (04/09/2026). `useMetas` responde una sola pregunta —"cuánto
 * llevo contra lo que me propuse"— y la contesta con tres llamadas baratas que la pantalla necesita
 * de entrada. Esto es lo caro: agrega el detalle por producto y cruza el historial del equipo. Si
 * viviera en el mismo hook, abrir "Mis metas" pagaría las seis consultas aunque nadie toque las
 * pestañas nuevas.
 *
 * Por eso arranca APAGADO: `activo` lo prende la pantalla cuando la persona entra a la pestaña.
 *
 * ⚠️ TODO ESTO VA A ESTAR VACÍO POR SEMANAS y no es un bug. Al 04/09/2026 hay **6 pedidos en toda
 * la base** (los pedidos se empezaron a guardar el 19/08). El hook devuelve `hayDatos` justamente
 * para que la pantalla pueda decirlo con palabras: un cero acá se lee como "no vendiste nada".
 */

/** El mes ANTERIOR completo, en fechas locales (nunca `toISOString`, regla 23). */
export function rangoMesAnterior(ahora = new Date()) {
  const primeroDeEste = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
  const ultimoDelAnterior = new Date(primeroDeEste.getTime() - 86400000)
  const primeroDelAnterior = new Date(ultimoDelAnterior.getFullYear(), ultimoDelAnterior.getMonth(), 1)
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { desde: f(primeroDelAnterior), hasta: f(ultimoDelAnterior) }
}

/**
 * Agrupa el detalle por producto en una dimensión (categoría o marca).
 *
 * Se hace ACÁ y no en SQL a propósito: son ~100 filas, y una segunda función de base tendría que
 * repetir exactamente los mismos filtros de la primera — dos verdades que se desincronizan a la
 * primera corrección, que es la regla 36 aplicada a un `group by`.
 */
export function agruparPor(filas, campo) {
  const m = new Map()
  for (const f of filas) {
    // Un producto sin categoría no se cuenta como categoría "null": se agrupa bajo un nombre que
    // dice la verdad. Hoy hay productos sin rubro por la ingesta que mandó códigos numéricos.
    const k = f[campo] || 'Sin clasificar'
    const a = m.get(k) || { nombre: k, monto: 0, unidades: 0 }
    a.monto += Number(f.monto) || 0
    a.unidades += Number(f.unidades) || 0
    m.set(k, a)
  }
  const total = [...m.values()].reduce((a, x) => a + x.monto, 0)
  return [...m.values()]
    .map((x) => ({ ...x, pct: total > 0 ? (x.monto / total) * 100 : 0 }))
    .sort((a, b) => b.monto - a.monto)
}

export default function useTablero({ activo, periodo = 'mensual', idUsuario = null }) {
  const { user } = useAuth()
  const id = idUsuario || user?.id || null

  const [productos, setProductos] = useState([])
  const [oportunidades, setOportunidades] = useState([])
  const [dormidos, setDormidos] = useState([])
  const [mesAnterior, setMesAnterior] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  const rangos = useMemo(() => rangosDeHoy(), [])
  const anterior = useMemo(() => rangoMesAnterior(), [])
  const rango = rangos[periodo] || rangos.mensual

  useEffect(() => {
    if (!activo || !id) return
    let vivo = true
    setCargando(true)
    ;(async () => {
      try {
        const [prod, opor, dorm, mesPrevio] = await Promise.all([
          supabase.rpc('productos_del_vendedor', { p_id_usuario: id, p_desde: rango.desde, p_hasta: rango.hasta }),
          supabase.rpc('oportunidades_vendedor', { p_id_usuario: id, p_limite: 10 }),
          supabase.rpc('clientes_dormidos', { p_id_usuario: id, p_dias: 30, p_limite: 20 }),
          supabase.rpc('metricas_venta', { p_id_usuario: id, p_desde: anterior.desde, p_hasta: anterior.hasta }),
        ])
        // Las RPC tiran excepción si se les pide una persona fuera de `ids_a_mi_cargo()`. Ese error
        // se propaga en vez de tragarse: quien llegue acá sin permiso tiene que enterarse, no ver
        // listas vacías que se leen como "no vendiste nada".
        for (const r of [prod, opor, dorm, mesPrevio]) if (r.error) throw r.error
        if (!vivo) return
        setProductos(prod.data || [])
        setOportunidades(opor.data || [])
        setDormidos(dorm.data || [])
        setMesAnterior(calcularMetricas(mesPrevio.data?.[0]))
        setError(null)
      } catch (e) {
        if (vivo) setError(e?.message || String(e))
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [activo, id, rango.desde, rango.hasta, anterior.desde, anterior.hasta])

  const porCategoria = useMemo(() => agruparPor(productos, 'categoria'), [productos])
  const porMarca = useMemo(() => agruparPor(productos, 'marca'), [productos])

  return {
    productos, oportunidades, dormidos, mesAnterior,
    porCategoria, porMarca,
    cargando, error,
    // La pantalla lo usa para elegir entre "todavía no hay con qué" y una lista vacía de verdad.
    hayDatos: productos.length > 0,
  }
}
