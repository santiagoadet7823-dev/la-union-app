import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, hasSupabase } from '../services/supabase'
import { hoyStr } from '../lib/format'

/**
 * Los tramos de transporte de la empresa en un día (`tramos_transporte`, db/72), para el panel:
 * pintar ese lapso del trazo en tinta, ponerle hitos de hora y decir "🚚 En transporte desde las
 * 10:30" en la tarjeta del pin.
 *
 * Polling cada minuto como `useAlertasEquipo`: un tramo se abre y se cierra un puñado de veces por
 * día, no vale un canal realtime. RLS ya recorta por empresa/jerarquía (`tramos_sel`); el `.eq`
 * explícito es por el superadmin, que ve todos los tenants y necesita el scope de la pantalla.
 *
 * Un tramo que arrancó ayer y sigue abierto (el cron lo cierra a las 14 h como mucho) igual entra
 * en el día de hoy: se pide por `inicio_ts` en el día O `fin_ts` nulo. Para un día pasado se piden
 * los que EMPEZARON ese día; el que cruzó la medianoche se dibuja en el día en que empezó.
 *
 * @param {string} fecha   'YYYY-MM-DD'
 * @param {string|null} idEmpresa  scope de la pantalla (`'*'` o null = todas)
 * @returns {{ porUsuario: Object<string, Array<{desde:number, hasta:number|null}>>,
 *             abiertos: Object<string, {desde:number, origen:string}>, recargar: Function }}
 */
const REFRESH_MS = 60000

export default function useTramosTransporte(fecha, idEmpresa) {
  const [filas, setFilas] = useState([])
  const esHoy = fecha === hoyStr()

  const recargar = useCallback(async () => {
    // `null` = "todavía no cargó el scope"; el centinela de "todas las empresas" es `'*'` (regla 32).
    if (!hasSupabase || !fecha || !idEmpresa) return
    const desde = new Date(fecha + 'T00:00:00').toISOString()
    const hasta = new Date(fecha + 'T23:59:59').toISOString()
    let q = supabase
      .from('tramos_transporte')
      .select('id, id_usuario, inicio_ts, fin_ts, origen')
      .order('inicio_ts', { ascending: true })
    // Hoy: lo que empezó hoy más lo que sigue abierto de ayer. Otro día: lo que empezó ese día.
    q = esHoy
      ? q.or(`and(inicio_ts.gte.${desde},inicio_ts.lte.${hasta}),fin_ts.is.null`)
      : q.gte('inicio_ts', desde).lte('inicio_ts', hasta)
    if (idEmpresa !== '*') q = q.eq('id_empresa', idEmpresa)
    const { data, error } = await q
    if (error) return // se mantiene lo anterior; el próximo tick reintenta
    setFilas(data || [])
  }, [fecha, idEmpresa, esHoy])

  useEffect(() => { recargar() }, [recargar])
  useEffect(() => {
    if (!esHoy) return
    const iv = setInterval(recargar, REFRESH_MS)
    const onVis = () => { if (document.visibilityState === 'visible') recargar() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [recargar, esHoy])

  return useMemo(() => {
    const porUsuario = {}
    const abiertos = {}
    for (const f of filas) {
      const desde = new Date(f.inicio_ts).getTime()
      const hasta = f.fin_ts ? new Date(f.fin_ts).getTime() : null
      ;(porUsuario[f.id_usuario] ||= []).push({ desde, hasta })
      if (hasta == null) abiertos[f.id_usuario] = { desde, origen: f.origen }
    }
    return { porUsuario, abiertos, recargar }
  }, [filas, recargar])
}
