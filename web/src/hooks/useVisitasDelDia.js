import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { hoyStr } from '../lib/format'
import { fechaLocal } from '../lib/diasVisita'

/** Cada cuánto se refresca mientras la pestaña está a la vista. Mismo pulso que el resto del mapa. */
const REFRESCO_MS = 60000

/**
 * Las visitas de UN DÍA de la empresa, por comercio:
 * `Map<id_cliente, { estado, idUsuario, checkIn, checkOut, monto }>`.
 *
 * Es lo que le falta a la supervisión para poder pintar la cartera por estado: del lado del
 * vendedor "visitado" sale de su propia jornada en memoria (`useJornada.visitState`), pero el
 * supervisor mira a TODO el equipo, así que la única fuente es la tabla.
 *
 * Nació como `useVisitasDeHoy` (sólo hoy). Pasó a recibir la FECHA el 17/09/2026 porque la pregunta
 * de control real no es "cómo viene hoy" sino "¿el martes se visitó lo que tocaba?", y mirando el
 * martes la capa se apagaba. El rango es `[fecha 00:00, fecha+1 00:00)` en hora LOCAL (regla 23:
 * con `toISOString()` de 21 a 24 h se pediría el día siguiente).
 *
 * 🔑 EL ALCANCE LO PONE LA RLS, NO ESTE HOOK. `visitas_sel` (verificada en la base viva el 17/09):
 * superadmin todo, admin su empresa, y **encargado sólo `ids_a_mi_cargo()`**. Eso último no es una
 * limitación a corregir: un encargado que ve "sin visitar" un comercio que visitó alguien de otro
 * equipo estaría leyendo un dato que no le corresponde. El `id_empresa` va igual en el filtro para
 * no traer de más cuando quien mira es superadmin con una empresa activa elegida.
 *
 * Una visita `en_curso` de un día PASADO es una que nunca se cerró. Se devuelve igual —es lo que
 * pasó— y la tarjeta lo dice ("quedó abierta").
 *
 * `activo` en false no consulta nada: la supervisión lo apaga cuando la capa está en modo zona.
 */
export default function useVisitasDelDia(idEmpresa, fecha, activo = true) {
  const [porCliente, setPorCliente] = useState(() => new Map())
  const [ciclo, setCiclo] = useState(0)
  const recargar = useCallback(() => setCiclo((n) => n + 1), [])
  const esHoy = fecha === hoyStr()

  useEffect(() => {
    // El centinela de "todas las empresas" es el string '*', no null (regla 32): con '*' se
    // consulta sin filtro y la RLS decide; con null todavía no cargó y no hay nada que pedir.
    if (!activo || !idEmpresa || !fecha) { setPorCliente(new Map()); return }
    let vivo = true
    ;(async () => {
      try {
        const desde = fechaLocal(fecha)
        const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
        let q = supabase
          .from('visitas')
          .select('id_cliente, estado, id_usuario, check_in_ts, check_out_ts, monto')
          .gte('check_in_ts', desde.toISOString())
          .lt('check_in_ts', hasta.toISOString())
          .in('estado', ['visitado', 'sin_pedido', 'en_curso'])
        if (idEmpresa !== '*') q = q.eq('id_empresa', idEmpresa)
        const { data, error } = await q
        if (!vivo || error) return
        const m = new Map()
        for (const v of data || []) {
          if (!v.id_cliente) continue
          // Una visita CERRADA gana sobre una en curso del mismo comercio: si alguien volvió a
          // entrar, lo que ya se registró es lo que pasó.
          const previo = m.get(v.id_cliente)
          if (previo && previo.estado !== 'en_curso') continue
          m.set(v.id_cliente, {
            estado: v.estado,
            idUsuario: v.id_usuario || null,
            checkIn: v.check_in_ts || null,
            checkOut: v.check_out_ts || null,
            monto: v.monto != null ? Number(v.monto) : null,
          })
        }
        setPorCliente(m)
      } catch (_) { /* el mapa funciona igual sin esto: se ve la cartera sin estado */ }
    })()
    return () => { vivo = false }
  }, [idEmpresa, fecha, activo, ciclo])

  // Refresco periódico sólo con el documento VISIBLE y mirando HOY: un día pasado no cambia, y en
  // segundo plano nadie mira el mapa (misma regla que el tick de `GpsGate`).
  useEffect(() => {
    if (!activo || !esHoy) return
    const iv = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      recargar()
    }, REFRESCO_MS)
    return () => clearInterval(iv)
  }, [activo, esHoy, recargar])

  return { visitas: porCliente, recargarVisitas: recargar }
}
