import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useTenant, TODAS } from '../context/TenantContext'
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
 * No publica nada ni escribe: es solo lectura, y por eso es de las primeras que pasan a leer el
 * SCOPE (`useTenant().idEmpresaActiva`) en vez de la empresa de identidad. La escritura de GPS
 * sigue con `useAuth()` — regla 11 de CLAUDE.md, y el comentario largo de TenantContext.jsx
 * explica por qué eso es irreversible si se rompe.
 *
 * Aislamiento por empresa: filtro EXPLÍCITO en cada query, además de RLS. RLS solo
 * no alcanza porque para el superadmin no filtra nada (ve todos los tenants por
 * diseño), así que sin el .eq() estas queries le mezclaban los datos de todas las
 * empresas en el mismo mapa. Ver PLAN_SAAS.md §3.4.
 *
 * Con scope `TODAS` ese filtro se saca A PROPÓSITO y la mezcla es lo buscado.
 */
export default function useEquipoEnVivo() {
  const { idEmpresaActiva } = useTenant()
  const idEmpresa = idEmpresaActiva
  const [nombres, setNombres] = useState({}) // { [id_usuario]: nombre }
  const [fotos, setFotos] = useState({})     // { [id_usuario]: foto_url } para la burbuja del mapa
  const [movers, setMovers] = useState({})   // { [id]: {id, rol, lat, lng, ts} }
  const [gpsOff, setGpsOff] = useState({})   // { [id]: {nombre, rol, ts} }
  const [mqttOn, setMqttOn] = useState(false)

  // Nombres + foto de perfil de los usuarios de la empresa (para etiquetar/ilustrar los
  // móviles en el mapa). La foto es opcional: si no hay, la burbuja cae a iniciales.
  useEffect(() => {
    if (!idEmpresa) return // el perfil todavía no cargó: no disparar la query sin filtro
    let q = supabase.from('perfiles').select('id, nombre, foto_url')
    if (idEmpresa !== TODAS) q = q.eq('id_empresa', idEmpresa)
    q.then(({ data }) => {
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
  //
  // Con scope TODAS hay que llamar la RPC UNA VEZ POR EMPRESA: su firma toma un uuid escalar
  // (`p_empresa`), no un conjunto. Cambiarla a un array tocaría una función que ya está en
  // producción y no hace falta — son un puñado de empresas, no miles.
  useEffect(() => {
    if (!idEmpresa) return
    let vivo = true
    const sembrar = (filas) => {
      const seed = {}
      ;(filas || []).forEach((p) => {
        if (!p.id_usuario) return
        seed[p.id_usuario] = { id: p.id_usuario, rol: p.rol, lat: p.lat, lng: p.lng, ts: new Date(p.ts).getTime() }
      })
      if (vivo) setMovers((m) => ({ ...seed, ...m })) // no pisar los que ya llegaron en vivo
    }
    if (idEmpresa !== TODAS) {
      supabase.rpc('ultimas_posiciones', { p_empresa: idEmpresa }).then(({ data }) => sembrar(data))
    } else {
      supabase.from('empresas').select('id').then(async ({ data: emps }) => {
        const todas = []
        for (const e of emps || []) {
          const { data } = await supabase.rpc('ultimas_posiciones', { p_empresa: e.id })
          todas.push(...(data || []))
        }
        sembrar(todas)
      })
    }
    return () => { vivo = false }
  }, [idEmpresa])

  // Telemetría en vivo (Supabase Realtime): posición de los móviles + alertas GPS on/off.
  //
  // El scope viaja tal cual, incluido el `'*'`: realtime.js lo entiende y en ese caso arma el
  // canal sin `filter`, dejando que RLS decida (ver el comentario de suscribirPosiciones).
  useEffect(() => {
    const scope = idEmpresa
    const offPos = suscribirPosiciones((p) => {
      if (!p || !p.id_usuario) return
      setMovers((m) => ({ ...m, [p.id_usuario]: { id: p.id_usuario, rol: p.rol, lat: p.lat, lng: p.lng, ts: new Date(p.ts).getTime() } }))
    }, scope)
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
    }, scope)
    return () => { offPos(); offConn(); offAlert() }
  }, [idEmpresa])

  // Al cambiar de empresa mirada hay que VACIAR: si no, los móviles del tenant anterior quedan
  // dibujados en el mapa hasta que alguno del nuevo publique una posición encima. Es la misma
  // clase de fuga que el plan marca para las cachés (PLAN_SAAS §3.3), pero en memoria.
  useEffect(() => { setMovers({}); setGpsOff({}) }, [idEmpresa])

  // ---- Ubicaciones COMPARTIDAS con esta empresa (gente de OTRO tenant que decidió mostrarse).
  //
  // Va por una RPC aparte y NO por `posiciones_sel`: agregarle un `exists(...)` a esa policy la
  // haría correr una subconsulta POR FILA sobre la tabla más grande del sistema, y la paginación
  // de recorridos (1.000 filas × N páginas) quedaría inusable — es exactamente lo que prohíbe la
  // regla 10. La RPC es aditiva y se elimina borrando una función.
  //
  // Solo la ÚLTIMA posición, nunca el recorrido del día: es lo que se acordó compartir.
  useEffect(() => {
    if (!idEmpresa || idEmpresa === TODAS) return
    let vivo = true
    const cargar = () => {
      supabase.rpc('ultimas_posiciones_compartidas').then(({ data }) => {
        if (!vivo) return
        const extra = {}
        const nom = {}
        ;(data || []).forEach((p) => {
          if (!p.id_usuario) return
          extra[p.id_usuario] = {
            id: p.id_usuario, rol: p.rol, lat: p.lat, lng: p.lng,
            ts: new Date(p.ts).getTime(),
            // El flag lo usa la UI para marcarlo distinto: confundir a un invitado con un empleado
            // rastreado sería peor que no mostrarlo.
            compartido: true,
          }
          if (p.nombre) nom[p.id_usuario] = p.nombre
        })
        if (!Object.keys(extra).length) return
        setMovers((m) => ({ ...extra, ...m }))
        setNombres((n) => ({ ...nom, ...n }))
      }).catch(() => { /* sin permisos o sin red: no es un error de esta pantalla */ })
    }
    cargar()
    const iv = setInterval(cargar, 60000)
    return () => { vivo = false; clearInterval(iv) }
  }, [idEmpresa])

  return { nombres, fotos, movers, gpsOff, mqttOn }
}
