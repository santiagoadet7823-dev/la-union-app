import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { persistence } from '../services/persistence'

/**
 * LO QUE LA APP NECESITA SABER DEL ENVÍO DE CLIENTES AL ERP (db/92). Sale de `empresas.export_erp`
 * y se cambia con un `update`, sin release — igual que las formas de pago (`useFormasPago`, del que
 * este hook es gemelo):
 *   · `piso`   = `cliente_codigo_min`: desde qué número se buscan huecos para un cliente nuevo;
 *   · `activo` = `clientes_activo`: la llave de la retención. Prendida, un pedido no sale al ERP
 *     hasta que su cliente llegó (`pedido_exportable`); apagada, sale como siempre.
 *
 * 🔴 SIN SEÑAL EL PISO NO PUEDE CAER EN 1. Debajo del piso están los códigos que el ERP ya conoce:
 * reusar uno choca en SU sistema, y eso el trigger de db/92 no lo puede ver. Por eso:
 *   · el último valor que se leyó con red queda guardado en el dispositivo y se usa offline;
 *   · si este teléfono NUNCA lo supo, `piso` es `null`, que `primerCodigoLibre` traduce como
 *     "después del último código cargado" — la opción que no reutiliza nada.
 *
 * @returns {{ piso: number|null, activo: boolean }}
 */
const clave = (idEmpresa) => `lu-codigo-cliente-min-${idEmpresa}`
const claveActivo = (idEmpresa) => `lu-clientes-erp-activo-${idEmpresa}`

export function useEnvioClientesErp(idEmpresa) {
  const [piso, setPiso] = useState(null)
  const [activo, setActivo] = useState(false)
  useEffect(() => {
    if (!idEmpresa) return
    let vivo = true
    ;(async () => {
      const guardado = await persistence.get(clave(idEmpresa))
      if (vivo && Number.isFinite(guardado)) setPiso(guardado)
      const guardadoActivo = await persistence.get(claveActivo(idEmpresa))
      if (vivo && typeof guardadoActivo === 'boolean') setActivo(guardadoActivo)
      const { data, error } = await supabase.from('empresas').select('export_erp').eq('id', idEmpresa).maybeSingle()
      if (!vivo || error || !data) return
      const a = data.export_erp?.clientes_activo === true
      setActivo(a)
      persistence.set(claveActivo(idEmpresa), a)
      const n = Number(data.export_erp?.cliente_codigo_min)
      if (!Number.isFinite(n) || n < 1) return
      setPiso(n)
      persistence.set(clave(idEmpresa), n)
    })()
    return () => { vivo = false }
  }, [idEmpresa])
  return { piso, activo }
}

/** Sólo el piso, para el alta de cliente. */
export default function useCodigoClienteMin(idEmpresa) {
  return useEnvioClientesErp(idEmpresa).piso
}
