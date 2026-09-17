import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { hoyStr } from '../lib/format'
import { fechaLocal } from '../lib/diasVisita'

const REFRESCO_MS = 60000

/**
 * Los pedidos que tomó EL BOT DE WHATSAPP en un día, por comercio:
 * `Map<id_cliente, { hora, monto, numero }>`. Es lo que pinta el pin verde-WhatsApp.
 *
 * El bot todavía no existe (17/09/2026); esto es la mitad de la app del contrato: un pedido del
 * bot es una fila de `pedidos` con `origen = 'whatsapp'` (db/71) y nada más. Cuando el bot ande,
 * el mapa lo muestra solo. Ver "Pedidos del bot" en DOCUMENTACION_FUNCIONAL.md.
 *
 * El alcance lo pone la RLS de `pedidos`: el vendedor ve los suyos (el bot pone `id_vendedor` =
 * el dueño del comercio, justamente para esto), el supervisor su empresa / su gente. Si dos
 * pedidos del bot caen en el mismo comercio el mismo día, gana el último (es el que se ve en la
 * tarjeta); el estado es el mismo.
 *
 * `fecha` en 'YYYY-MM-DD' local (regla 23). Sin `activo` no consulta.
 */
export default function usePedidosBotDelDia(idEmpresa, fecha, activo = true) {
  const [porCliente, setPorCliente] = useState(() => new Map())
  const [ciclo, setCiclo] = useState(0)
  const esHoy = fecha === hoyStr()

  useEffect(() => {
    if (!activo || !fecha) { setPorCliente(new Map()); return }
    let vivo = true
    ;(async () => {
      try {
        const desde = fechaLocal(fecha)
        const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
        let q = supabase
          .from('pedidos')
          .select('id_cliente, created_at, monto_total, numero')
          .eq('origen', 'whatsapp')
          .neq('estado', 'Anulado')
          .gte('created_at', desde.toISOString())
          .lt('created_at', hasta.toISOString())
          .order('created_at', { ascending: true })
        // El vendedor no pasa empresa (la RLS ya lo limita a los suyos); el supervisor sí, salvo
        // con el centinela '*' (todas).
        if (idEmpresa && idEmpresa !== '*') q = q.eq('id_empresa', idEmpresa)
        const { data, error } = await q
        if (!vivo || error) return
        const m = new Map()
        for (const p of data || []) {
          if (!p.id_cliente) continue
          m.set(p.id_cliente, { hora: p.created_at, monto: Number(p.monto_total) || 0, numero: p.numero || null })
        }
        setPorCliente(m)
      } catch (_) { /* sin esto el mapa pierde un matiz, no la pantalla */ }
    })()
    return () => { vivo = false }
  }, [idEmpresa, fecha, activo, ciclo])

  useEffect(() => {
    if (!activo || !esHoy) return
    const iv = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      setCiclo((n) => n + 1)
    }, REFRESCO_MS)
    return () => clearInterval(iv)
  }, [activo, esHoy])

  return porCliente
}
