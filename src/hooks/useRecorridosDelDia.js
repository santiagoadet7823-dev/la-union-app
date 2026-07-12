import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabase'

const REFRESH_MS = 60000
const hoyStr = () => new Date().toISOString().slice(0, 10)

/**
 * Carga las posiciones del día (todas las de la empresa, agrupadas por
 * id_usuario) y se refresca sola cada 60s de forma INCREMENTAL si `fecha` es hoy
 * (solo trae los puntos nuevos, para no gastar egress). Antes esta lógica estaba
 * duplicada entre RecorridosView y SupervisionMovil, y ya habían divergido (solo
 * RecorridosView tenía la carga incremental).
 *
 * @param {string} fecha 'YYYY-MM-DD'
 * @param {string} idEmpresa
 * @param {boolean} [conRol] si true, selecciona también `rol` por punto (lo usa
 *   SupervisionMovil para filtrar los chips Vend./Rep.); si no, el llamador debe
 *   resolver el rol por su cuenta (p.ej. con usePerfilesEquipo).
 */
export default function useRecorridosDelDia(fecha, idEmpresa, conRol = false) {
  const [byUser, setByUser] = useState({}) // { id_usuario: { rol?, points:[{lat,lng}] } }
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(false)
  const lastTsRef = useRef(null)
  const esHoy = fecha === hoyStr()

  const load = useCallback(async (incremental) => {
    if (!idEmpresa) return
    const cols = conRol ? 'id_usuario, rol, lat, lng, ts' : 'id_usuario, lat, lng, ts'
    const desde = new Date(fecha + 'T00:00:00').toISOString()
    const hasta = new Date(fecha + 'T23:59:59').toISOString()
    if (!incremental) setLoading(true)
    let q = supabase.from('posiciones').select(cols)
      .eq('id_empresa', idEmpresa).lte('ts', hasta).order('ts', { ascending: true })
    q = incremental && lastTsRef.current ? q.gt('ts', lastTsRef.current) : q.gte('ts', desde)
    const { data } = await q
    if (!incremental) setLoading(false)
    if (!data) return
    if (data.length) {
      setByUser((prev) => {
        const next = incremental ? { ...prev } : {}
        data.forEach((p) => {
          if (!p.id_usuario) return
          const rolVal = conRol ? p.rol : next[p.id_usuario]?.rol
          const prevPoints = next[p.id_usuario]?.points || []
          next[p.id_usuario] = { rol: rolVal, points: [...prevPoints, { lat: p.lat, lng: p.lng }] }
        })
        return next
      })
      lastTsRef.current = data[data.length - 1].ts
    } else if (!incremental) {
      setByUser({})
    }
    setUpdatedAt(Date.now())
  }, [idEmpresa, fecha, conRol])

  // Carga inicial y al cambiar de fecha/empresa.
  useEffect(() => { lastTsRef.current = null; load(false) }, [load])

  // Auto-refresh incremental cada 60s (solo si la fecha es HOY; el pasado no cambia).
  useEffect(() => {
    if (!esHoy) return
    const iv = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(iv)
  }, [esHoy, load])

  return { byUser, updatedAt, loading, esHoy, reload: () => load(false) }
}
