import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'

const VACIO = { ids: new Set(), porCliente: new Map() }

/**
 * Los clientes dormidos de TODA la empresa (RPC `clientes_dormidos_empresa`, db/70): a quién hace
 * más de `dias` que NADIE le vende. Es el rojo del mapa de monitoreo.
 *
 * Hermano de `useDormidos` (por vendedor, para el tablero y el mapa del vendedor). No se reusa
 * ese porque su RPC pide `p_id_usuario` y para la empresa serían tantas llamadas como vendedores,
 * y encima un comercio que cambió de vendedor saldría "dormido" por error. Ver el encabezado de
 * db/70.
 *
 * `idEmpresa` viaja como `p_empresa` sólo para el superadmin con una empresa elegida; para el resto
 * la RPC ignora el parámetro y usa `mi_empresa()`. El centinela '*' (todas) no manda nada.
 *
 * ⚠️ Es "dormido respecto de HOY" aunque el mapa esté mirando una fecha pasada: la RPC mide contra
 * `now()`. Un comercio que hace 40 días no compra se pinta rojo también sobre el mapa del martes
 * pasado, y eso es correcto —la alarma es de ahora— pero conviene saberlo.
 *
 * Un fallo NO se propaga: sin red o sin permiso, queda vacío y el mapa pierde un matiz, no la
 * pantalla.
 */
export default function useDormidosEmpresa(idEmpresa, activo = true, { dias = 30, limite = 300 } = {}) {
  const [res, setRes] = useState(VACIO)

  useEffect(() => {
    if (!activo || !idEmpresa) { setRes(VACIO); return }
    let vivo = true
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('clientes_dormidos_empresa', {
          p_dias: dias, p_limite: limite, p_empresa: idEmpresa === '*' ? null : idEmpresa,
        })
        if (!vivo || error) return
        const porCliente = new Map()
        for (const d of data || []) {
          porCliente.set(d.id_cliente, {
            dias: d.dias_sin_comprar,
            ultima: d.ultima_compra,
            compras: Number(d.compras) || 0,
            monto: Number(d.monto_historico) || 0,
          })
        }
        setRes({ ids: new Set(porCliente.keys()), porCliente })
      } catch (_) { /* el mapa funciona igual sin esto */ }
    })()
    return () => { vivo = false }
  }, [idEmpresa, activo, dias, limite])

  return res
}
