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
 * No publica nada ni escribe: es solo lectura.
 *
 * Aislamiento por empresa: filtro EXPLÍCITO en cada query, además de RLS. RLS solo
 * no alcanza porque para el superadmin no filtra nada (ve todos los tenants por
 * diseño), así que sin el .eq() estas queries le mezclaban los datos de todas las
 * empresas en el mismo mapa. Ver PLAN_SAAS.md §3.4.
 */
export default function useEquipoEnVivo() {
  const { idEmpresa } = useAuth()
  const [nombres, setNombres] = useState({}) // { [id_usuario]: nombre }
  const [fotos, setFotos] = useState({})     // { [id_usuario]: foto_url } para la burbuja del mapa
  const [movers, setMovers] = useState({})   // { [id]: {id, rol, lat, lng, ts} }
  const [gpsOff, setGpsOff] = useState({})   // { [id]: {nombre, rol, ts} }
  const [mqttOn, setMqttOn] = useState(false)

  // Nombres + foto de perfil de los usuarios de la empresa (para etiquetar/ilustrar los
  // móviles en el mapa). La foto es opcional: si no hay, la burbuja cae a iniciales.
  useEffect(() => {
    if (!idEmpresa) return // el perfil todavía no cargó: no disparar la query sin filtro
    supabase.from('perfiles').select('id, nombre, foto_url').eq('id_empresa', idEmpresa).then(({ data }) => {
      const nom = {}
      const fot = {}
      ;(data || []).forEach((u) => { nom[u.id] = u.nombre; if (u.foto_url) fot[u.id] = u.foto_url })
      setNombres(nom)
      setFotos(fot)
    })
  }, [idEmpresa])

  // Sembrar con la ÚLTIMA posición conocida de CADA móvil (sin corte de tiempo), vía el RPC
  // ultimas_posiciones (distinct on). Antes se cortaba a los últimos 15 min: al cerrar la app
  // el móvil desaparecía del mapa y había que revisar cartel por cartel el horario. Ahora la
  // burbuja queda en su última posición y la UI marca la frescura (fresco/hace rato/viejo).
  useEffect(() => {
    if (!idEmpresa) return
    supabase.rpc('ultimas_posiciones', { p_empresa: idEmpresa }).then(({ data }) => {
      const seed = {}
      ;(data || []).forEach((p) => {
        if (!p.id_usuario) return
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
    }, idEmpresa)
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

  return { nombres, fotos, movers, gpsOff, mqttOn }
}
