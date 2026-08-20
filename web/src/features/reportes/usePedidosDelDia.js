import { useEffect, useState } from 'react'
import { supabase } from '../../services/supabase'
import { useTenant } from '../../context/TenantContext'

/**
 * Los pedidos de una fecha, para el informe.
 *
 * 🩸 ESTA VISTA SÍ CONSULTA, Y ES LA EXCEPCIÓN. `ReportesView` recibe `byUser` por prop y no
 * consulta nada — eso está escrito ahí y tiene un motivo fuerte: los kilómetros del informe tienen
 * que ser DÍGITO POR DÍGITO los del mapa, y la única forma de garantizarlo es que salgan del mismo
 * objeto ya limpio. Los pedidos no tienen esa restricción (no hay un "mapa de pedidos" con el que
 * puedan discrepar) y ningún host los tiene a mano, así que pedirle a las tres supervisiones que
 * los carguen y los pasen sería tres copias de lo mismo para nada.
 *
 * 🔴 `.eq('id_empresa')` EXPLÍCITO. RLS no filtra para superadmin (Fase 1 del SaaS): sin esto, el
 * informe de una distribuidora incluiría los pedidos de las otras.
 *
 * ⚠️ Devuelve `desdeCuando` además de las filas. El informe TIENE que poder decir desde qué fecha
 * hay datos: con la purga a 45 días, un reporte de hace dos meses no está vacío porque no se vendió
 * nada — está vacío porque los datos ya no existen, y esas dos cosas no se pueden mostrar igual.
 */
export function usePedidosDelDia(fecha) {
  const { idEmpresaActiva, esTodas } = useTenant()
  const [estado, setEstado] = useState({ pedidos: [], cargando: true, error: null })

  useEffect(() => {
    if (!fecha || !idEmpresaActiva) return
    let vivo = true
    setEstado((e) => ({ ...e, cargando: true }))
    ;(async () => {
      try {
        // El día local, no UTC: Salta es UTC−3 y un rango en UTC se comería las primeras tres
        // horas del día siguiente (es la regla 23 aplicada a un rango en vez de a un `slice`).
        const [a, m, d] = fecha.split('-').map(Number)
        const desde = new Date(a, m - 1, d).toISOString()
        const hasta = new Date(a, m - 1, d + 1).toISOString()

        let q = supabase
          .from('pedidos')
          .select('id, numero, id_vendedor, id_cliente, estado, monto_total, created_at, distancia_m, origen, intencion')
          .gte('created_at', desde).lt('created_at', hasta)
          .order('created_at', { ascending: true })
        // El centinela de "todas las empresas" es el string '*', no null.
        if (!esTodas) q = q.eq('id_empresa', idEmpresaActiva)

        const { data, error } = await q
        if (!vivo) return
        setEstado({ pedidos: data || [], cargando: false, error: error?.message || null })
      } catch (e) {
        if (vivo) setEstado({ pedidos: [], cargando: false, error: e?.message || String(e) })
      }
    })()
    return () => { vivo = false }
  }, [fecha, idEmpresaActiva, esTodas])

  return estado
}

/**
 * Desde qué fecha hay recorridos guardados. Es la advertencia honesta del informe: la purga corre
 * todos los días y lo anterior a esa fecha no está vacío, está borrado.
 */
export function usePrimerDiaConDatos() {
  const [dia, setDia] = useState(undefined) // undefined = cargando, null = no hay nada
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('posiciones').select('ts').order('ts', { ascending: true }).limit(1)
      if (vivo) setDia(data?.[0]?.ts || null)
    })()
    return () => { vivo = false }
  }, [])
  return dia
}
