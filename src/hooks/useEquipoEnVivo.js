import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../services/supabase'
import { suscribirPosiciones, suscribirAlertas, estadoConexion } from '../services/sync/realtime'

/**
 * Equipo en vivo de la empresa (para paneles de solo lectura como el del propietario
 * o el mapa del admin). Encapsula lo que antes vivía suelto en AdminView:
 *   - nombres: { [id]: nombre } de los perfiles de la empresa (para etiquetar móviles).
 *   - movers: { [id]: {id, rol, lat, lng, ts} } — última posición conocida de cada móvil,
 *     sembrada con los últimos 15 min y actualizada en vivo por Realtime.
 *   - gpsOff: { [id]: {nombre, rol, ts} } — móviles que DESACTIVARON su GPS (alerta efímera).
 *   - mqttOn: estado de la conexión de telemetría.
 *
 * No publica nada ni escribe: es solo lectura. El aislamiento por empresa lo da RLS.
 */
export default function useEquipoEnVivo() {
  const { idEmpresa } = useAuth()
  const [nombres, setNombres] = useState({}) // { [id_usuario]: nombre }
  const [movers, setMovers] = useState({})   // { [id]: {id, rol, lat, lng, ts} }
  const [gpsOff, setGpsOff] = useState({})   // { [id]: {nombre, rol, ts} }
  const [mqttOn, setMqttOn] = useState(false)

  // Nombres de los usuarios de la empresa (para etiquetar los móviles en el mapa).
  useEffect(() => {
    supabase.from('perfiles').select('id, nombre').then(({ data }) => {
      const m = {}
      ;(data || []).forEach((u) => { m[u.id] = u.nombre })
      setNombres(m)
    })
  }, [])

  // Sembrar con la ÚLTIMA posición conocida de cada móvil (últimos 15 min), así
  // aparecen de inmediato sin esperar un fix nuevo.
  useEffect(() => {
    const desde = new Date(Date.now() - 15 * 60000).toISOString()
    supabase.from('posiciones').select('id_usuario, rol, lat, lng, ts').gte('ts', desde).order('ts', { ascending: false })
      .then(({ data }) => {
        const seen = {}
        const seed = {}
        ;(data || []).forEach((p) => {
          if (!p.id_usuario || seen[p.id_usuario]) return
          seen[p.id_usuario] = true
          seed[p.id_usuario] = { id: p.id_usuario, rol: p.rol, lat: p.lat, lng: p.lng, ts: new Date(p.ts).getTime() }
        })
        setMovers((m) => ({ ...seed, ...m })) // no pisar los que ya llegaron en vivo
      })
  }, [idEmpresa])

  // Telemetría en vivo (Supabase Realtime): posición de los móviles + alertas GPS on/off.
  useEffect(() => {
    const offPos = suscribirPosiciones((p) => {
      if (!p || !p.id_usuario) return
      setMovers((m) => ({ ...m, [p.id_usuario]: { id: p.id_usuario, rol: p.rol, lat: p.lat, lng: p.lng, ts: new Date(p.ts).getTime() } }))
    })
    const offConn = estadoConexion(setMqttOn)
    const offAlert = suscribirAlertas((a) => {
      if (!a || !a.id) return
      const off = a.tipo === 'gps-off'
      setGpsOff((g) => {
        const n = { ...g }
        if (off) n[a.id] = { nombre: a.nombre, rol: a.rol, ts: a.ts }
        else delete n[a.id]
        return n
      })
    }, idEmpresa)
    return () => { offPos(); offConn(); offAlert() }
  }, [idEmpresa])

  return { nombres, movers, gpsOff, mqttOn }
}
