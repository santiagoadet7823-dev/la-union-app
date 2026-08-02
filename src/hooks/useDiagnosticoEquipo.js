import { useCallback, useEffect, useState } from 'react'
import { useTenant, TODAS } from '../context/TenantContext'
import { supabase } from '../services/supabase'
import { hoyStr } from '../lib/format'
import { cmpVer } from '../lib/version'
import usePerfilesEquipo from './usePerfilesEquipo'

/**
 * Estado real de cada teléfono del equipo y, cuando no reporta, POR QUÉ.
 *
 * Esta lógica vivía dentro de `features/supervision/components/EstadoEquipo.jsx`, mezclada con su
 * UI. Se extrajo el 28/07/2026 porque el dashboard del dueño necesita exactamente los mismos datos
 * con una presentación distinta: el encargado quiere el informe técnico completo, el dueño quiere
 * saber si puede confiar en que la ausencia de un dato significa algo.
 *
 * Y ese es el punto delicado de todo el rol propietario: **"sin señal" no es "no trabajó"**. Puede
 * ser batería, permisos o zona sin cobertura. La app no puede distinguir un franco de un teléfono
 * descargado, así que no lo interpreta: expone el diagnóstico y la conversación la tiene una persona.
 *
 * Solo lectura. Filtra por empresa de forma explícita además de RLS — que para el superadmin no
 * filtra: sin el `.eq()` le aparecían acá los móviles de todos los tenants.
 */
const RECIENTE_MS = 5 * 60000 // un latido más viejo que esto = "sin señal"
// A partir de esta profundidad de cola local, avisamos "cola trabada": el móvil late pero
// no está drenando posiciones a la base (caso Agustín: conectado, pero dejó de enviar). Un
// puñado de puntos en cola es normal entre flushes; esto marca una acumulación real.
const UMBRAL_COLA = 10
// Primer APK que trae el plugin nativo de push (watchdog). Un equipo con APK < esto NO corre el
// watchdog por más OTA nueva que tenga: es el mismatch que conviene cazar (ver GUIA_PUSH_NATIVO...).
const APK_MIN_PUSH = '1.5.42'

export const DIAG_RECIENTE_MS = RECIENTE_MS

const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

/** "hace X" legible a partir de un ISO (fecha de instalación). Días/semanas/meses aproximados. */
function haceTexto(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const dias = Math.floor(ms / 86400000)
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 7) return `hace ${dias} días`
  if (dias < 30) { const s = Math.floor(dias / 7); return `hace ${s} semana${s === 1 ? '' : 's'}` }
  if (dias < 365) { const m = Math.floor(dias / 30); return `hace ${m} mes${m === 1 ? '' : 'es'}` }
  const a = Math.floor(dias / 365); return `hace ${a} año${a === 1 ? '' : 's'}`
}

/**
 * @param {{tick?: boolean}} opts  `tick: true` re-renderiza cada segundo para que el "hace Xs" del
 *   motivo avance solo. El dashboard del dueño NO lo usa: ahí la frescura la dibuja `HaceSegundos`,
 *   que encapsula su propio intervalo en el nodo de texto en vez de re-renderizar la pantalla entera.
 */
export default function useDiagnosticoEquipo({ tick: conTick = false } = {}) {
  // Ruta de LECTURA pura → scope del TenantContext (PLAN_SAAS §3.2, implementado el 30/07/2026).
  // Las rutas de escritura de GPS siguen con useAuth() — regla 11 de CLAUDE.md.
  const { idEmpresaActiva: idEmpresa } = useTenant()
  const users = usePerfilesEquipo()
  const [estados, setEstados] = useState({})
  const [latestOta, setLatestOta] = useState(null) // app_config.latest_version, para marcar OTA atrasada
  const [, forzar] = useState(0)

  const cargarEstados = useCallback(async () => {
    if (!idEmpresa) return
    let q = supabase.from('estado_dispositivo')
      .select('id_usuario, ts, gps_ok, gps_desde, permiso, bg_ok, cola_pendiente, cuarentena_pendiente, app_version, apk_version, instalado_ts, red, red_desde, arranque_ts')
    if (idEmpresa !== TODAS) q = q.eq('id_empresa', idEmpresa)
    const { data: e } = await q
    if (e) { const m = {}; e.forEach((r) => { m[r.id_usuario] = r }); setEstados(m) }
  }, [idEmpresa])

  // Versión OTA vigente, una sola vez: contra ella se marca "OTA atrasada" por usuario. Singleton.
  useEffect(() => {
    supabase.from('app_config').select('latest_version').maybeSingle()
      .then(({ data }) => { if (data?.latest_version) setLatestOta(data.latest_version) })
  }, [])

  useEffect(() => { cargarEstados() }, [cargarEstados])
  useEffect(() => { const iv = setInterval(cargarEstados, 45000); return () => clearInterval(iv) }, [cargarEstados])
  useEffect(() => {
    if (!conTick) return
    const t = setInterval(() => forzar((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [conTick])

  const hoy = hoyStr()
  const filas = users.map((u) => {
    const e = estados[u.id]
    const now = Date.now()
    // `bg_ok` se pone en true SOLO cuando el móvil recibió un fix estando en 2º plano (confirma
    // permiso "Siempre" + que el SO no lo mata). Si nunca lo confirmó, no graba con la app cerrada
    // → el recorrido "en el bolsillo" se pierde. Es la causa nº1 de "hice el recorrido y no aparece".
    const bgConfirmado = !!(e && e.bg_ok)
    let estado = 'sin-actividad', motivo = 'Sin actividad hoy', color = 'var(--faint)'
    let ultimoLatidoMs = null
    if (e && e.ts) {
      const tsMs = new Date(e.ts).getTime()
      ultimoLatidoMs = tsMs
      const esHoy = hoyStr(new Date(e.ts)) === hoy
      if (!esHoy) { estado = 'sin-actividad'; motivo = 'Sin actividad hoy'; color = 'var(--faint)' }
      else if (now - tsMs > RECIENTE_MS) {
        estado = 'sin-senal'
        // Distinguir la causa: sin permiso "Siempre" (no captura en 2º plano) vs. permiso OK pero
        // el SO lo suspendió (optimización de batería) vs. datos/app cerrada.
        motivo = `Sin señal desde ${hhmm(tsMs)}` + (bgConfirmado
          ? ' · posible optimización de batería (excluí la app) o datos/app cerrada'
          : ' · permiso "solo mientras uso" → ponelo en "Siempre"')
        color = 'var(--danger)'
      } else if (!e.gps_ok) {
        estado = 'gps-off'
        motivo = `GPS apagado${e.gps_desde ? ` desde ${hhmm(new Date(e.gps_desde).getTime())}` : ''}`
        color = 'var(--warning)'
      } else if (!bgConfirmado) {
        // Reporta OK AHORA (con la app en pantalla) pero nunca capturó en 2º plano: si guarda el
        // celular, el recorrido no se graba. Aviso ámbar aunque "esté bien" en este momento.
        estado = 'bg-sin-confirmar'
        motivo = 'En pantalla OK, pero aún NO grabó en 2º plano → revisá permiso "Siempre" y batería'
        color = 'var(--warning)'
      } else {
        estado = 'ok'
        motivo = `OK · 2º plano confirmado · hace ${Math.max(0, Math.round((now - tsMs) / 1000))}s`
        color = 'var(--success)'
      }
    }
    // Cola de posiciones sin subir (la publica el propio móvil en cada latido). Es un carril
    // distinto del GPS: un móvil puede latir "OK" y aun así NO estar drenando posiciones a la
    // base (regla 22 de CLAUDE.md). Esto lo destapa.
    const cola = (e && e.cola_pendiente) || 0
    const cuarentena = (e && e.cuarentena_pendiente) || 0
    const colaTrabada = cola >= UMBRAL_COLA || cuarentena > 0
    // Versiones del equipo. OTA (app_version) puede ir adelante del APK sin problema; lo peligroso es
    // un APK viejo sin el plugin de push (< APK_MIN_PUSH). apk_version es null en la PWA/escritorio
    // (no es un teléfono) → no se marca. La OTA atrasada solo se marca si conocemos la vigente.
    const ota = (e && e.app_version) || null
    const apk = (e && e.apk_version) || null
    const otaAtrasada = !!(ota && latestOta && cmpVer(ota, latestOta) < 0)
    const apkSinPush = !!(apk && cmpVer(apk, APK_MIN_PUSH) < 0)
    const instalada = haceTexto(e && e.instalado_ts) // "instalada hace X" (null en PWA / sin dato)
    return {
      id: u.id, nombre: u.nombre || 'Móvil', rol: u.rol,
      estado, motivo, color, cola, cuarentena, colaTrabada,
      ota, apk, otaAtrasada, apkSinPush, instalada,
      ultimoLatidoMs,
      // Permiso crudo: el sheet de detalle del dueño lo muestra por separado, porque "permiso
      // solo mientras uso" explica una ausencia mucho mejor que cualquier frase que escribamos.
      //
      // La BATERÍA no está acá: `estado_dispositivo` no la guarda (verificado en base viva
      // 28/07/2026). El % viaja en `posiciones.bateria`, así que el detalle de una persona la lee
      // de su último punto del día. Para quien no mandó ni un punto, no hay batería que mostrar —
      // que es, justamente, el caso en el que más se querría tenerla.
      permiso: (e && e.permiso) || null,
      bgOk: bgConfirmado,
    }
  }).sort((a, b) => (a.estado === 'ok' ? 1 : 0) - (b.estado === 'ok' ? 1 : 0)) // problemas primero

  return {
    filas,
    problemas: filas.filter((f) => f.estado !== 'ok' || f.colaTrabada).length,
    recargar: cargarEstados,
  }
}
