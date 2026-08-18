import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { useTenant, TODAS } from '../context/TenantContext'
import { suscribirPosiciones, suscribirAlertas, estadoConexion } from '../services/sync/realtime'

/**
 * Equipo en vivo de la empresa (para paneles de lectura como el panel de dirección
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
/**
 * Quiénes SE ESPERA que reporten posiciones — o sea, quiénes salen a la calle con un teléfono.
 *
 * 🩸 08/08/2026 — nace de un informe que mentía el primer día que se usó. El bloque "no reportó ni
 * un punto" listaba 9 personas de un plantel de 21, y ninguna de las 9 era un problema real:
 *   · 3 perfiles con `activo = false` (bajas que siguen en la tabla),
 *   · el `admin` y el `superadmin`, que supervisan desde una PC y nunca llevaron un teléfono,
 *   · y varias cuentas DUPLICADAS de la misma persona (misma gente cargada dos veces con distinta
 *     mayúscula), donde la que rastrea reporta y la gemela figura ausente para siempre.
 * Un aviso que siempre está encendido es un aviso que nadie mira: al tercer día de ver los mismos
 * nueve nombres, el bloque entero deja de leerse y con él se pierden los que sí importan.
 *
 * Los gestores (admin/superadmin) tampoco entran: miran, no se los rastrea.
 *
 * ⚠️ Lo que esto NO puede arreglar son las cuentas duplicadas: dos perfiles activos con rol de
 * vendedor son, para el sistema, dos vendedores. Eso se limpia en `Usuarios`, no acá.
 */
const ROLES_RASTREADOS = ['vendedor', 'repartidor', 'encargado']

export default function useEquipoEnVivo() {
  const { idEmpresaActiva } = useTenant()
  const idEmpresa = idEmpresaActiva
  // Ver AuthContext: sube al salir de un arranque con el token vencido, y obliga a volver a pedir
  // lo que se cayó con 401. Las dos consultas de abajo corren UNA sola vez al montar, así que sin
  // esto un arranque degradado dejaba el mapa sin nombres y sin burbujas hasta cerrar sesión.
  const { authEpoch } = useAuth()
  const [nombres, setNombres] = useState({}) // { [id_usuario]: nombre }
  const [fotos, setFotos] = useState({})     // { [id_usuario]: foto_url } para la burbuja del mapa
  const [roles, setRoles] = useState({})     // { [id_usuario]: rol }
  const [plantel, setPlantel] = useState([]) // ids de quienes SE ESPERA que reporten (ver abajo)
  const [movers, setMovers] = useState({})   // { [id]: {id, rol, lat, lng, ts} }
  const [gpsOff, setGpsOff] = useState({})   // { [id]: {nombre, rol, ts} }
  const [mqttOn, setMqttOn] = useState(false)

  // Nombres + foto de perfil de los usuarios de la empresa (para etiquetar/ilustrar los
  // móviles en el mapa). La foto es opcional: si no hay, la burbuja cae a iniciales.
  useEffect(() => {
    if (!idEmpresa) return // el perfil todavía no cargó: no disparar la query sin filtro
    let q = supabase.from('perfiles').select('id, nombre, foto_url, rol, activo')
    if (idEmpresa !== TODAS) q = q.eq('id_empresa', idEmpresa)
    q.then(({ data, error }) => {
      // 🩸 El error se MIRA (18/08/2026). Hasta hoy esto era `.then(({ data }) => …)` y descartaba
      // `error`: un 401 por token vencido dejaba `data` en null, el mapa se quedaba sin nombres,
      // sin plantel y sin burbujas, y **no había una sola línea en consola**. Fue lo que hizo que
      // "no se ven las ubicaciones" tardara semanas en diagnosticarse. Mismo criterio que
      // `useRecorridosDelDia`: los fallos tienen que ser ruidosos.
      if (error) { console.error('[equipo] no se pudieron leer los perfiles', { idEmpresa, msg: error.message }, error); return }
      const nom = {}
      const fot = {}
      const rol = {}
      const espera = []
      ;(data || []).forEach((u) => {
        nom[u.id] = u.nombre
        if (u.foto_url) fot[u.id] = u.foto_url
        rol[u.id] = u.rol
        if (u.activo !== false && ROLES_RASTREADOS.includes(u.rol)) espera.push(u.id)
      })
      setNombres(nom)
      setFotos(fot)
      setRoles(rol)
      setPlantel(espera)
    })
  }, [idEmpresa, authEpoch])

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
  }, [idEmpresa, authEpoch])

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

  return { nombres, fotos, roles, plantel, movers, gpsOff, mqttOn }
}
