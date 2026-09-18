import { useEffect, useState } from 'react'
import { supabase } from '../../services/supabase'
import { useTenant } from '../../context/TenantContext'

/**
 * Los LOTES de exportación al ERP de la empresa (`exportaciones_pedidos`, db/62-64): número,
 * cuándo se bajó y cuántos pedidos llevó. Alimenta el filtro "Lote ERP" de la lista de pedidos
 * (18/09/2026): la administración pidió poder ver "lo que ya solicitamos" por bajada, no sólo la
 * pill `ERP #3` en cada fila.
 *
 * La policy `exportaciones_pedidos_sel` (db/62) la lee `admin` (y superadmin); para un `encargado`
 * la consulta devuelve cero filas sin error, y el filtro simplemente no lista lotes — conserva
 * "sin exportar" y "retenidos", que salen de la fila del pedido y no de acá.
 *
 * Sólo lotes reales (`lote is not null`): las reposiciones y los "no había nada" van con lote null.
 *
 * @returns {{ lote: number, ts: string, pedidos: number }[]} de más nuevo a más viejo
 */
export default function useLotesExport(activo = true) {
  const { idEmpresaActiva: idEmpresa } = useTenant()
  const [lotes, setLotes] = useState([])
  useEffect(() => {
    if (!activo || !idEmpresa) { setLotes([]); return }
    let vivo = true
    supabase.from('exportaciones_pedidos')
      .select('lote, ts, pedidos')
      .eq('id_empresa', idEmpresa)
      .not('lote', 'is', null)
      .order('lote', { ascending: false })
      .limit(60)
      .then(({ data }) => { if (vivo) setLotes(data || []) })
    return () => { vivo = false }
  }, [idEmpresa, activo])
  return lotes
}
