import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { persistence } from '../services/persistence'

/**
 * DESDE QUÉ NÚMERO SE BUSCAN HUECOS PARA UN CLIENTE NUEVO (db/86). Sale de
 * `empresas.export_erp.cliente_codigo_min` y se cambia con un `update`, sin release — igual que las
 * formas de pago (`useFormasPago`, del que este hook es gemelo).
 *
 * 🔴 SIN SEÑAL NO PUEDE CAER EN 1. El piso arranca en "último código + 1" porque muchos huecos de hoy
 * son clientes que el ERP todavía tiene inhabilitados: hasta que su programador los depure, reusar
 * uno choca en SU sistema, y eso el trigger de db/86 no lo puede ver (sólo resuelve choques dentro
 * de dist-at). Por eso:
 *   · el último valor que se leyó con red queda guardado en el dispositivo y se usa offline;
 *   · si este teléfono NUNCA lo supo, devuelve `null`, que `NuevoCliente` traduce como "después del
 *     último código cargado" — la opción que no reutiliza nada.
 *
 * @returns {number|null}
 */
const clave = (idEmpresa) => `lu-codigo-cliente-min-${idEmpresa}`

export default function useCodigoClienteMin(idEmpresa) {
  const [piso, setPiso] = useState(null)
  useEffect(() => {
    if (!idEmpresa) return
    let vivo = true
    ;(async () => {
      const guardado = await persistence.get(clave(idEmpresa))
      if (vivo && Number.isFinite(guardado)) setPiso(guardado)
      const { data, error } = await supabase.from('empresas').select('export_erp').eq('id', idEmpresa).maybeSingle()
      if (!vivo || error) return
      const n = Number(data?.export_erp?.cliente_codigo_min)
      if (!Number.isFinite(n) || n < 1) return
      setPiso(n)
      persistence.set(clave(idEmpresa), n)
    })()
    return () => { vivo = false }
  }, [idEmpresa])
  return piso
}
