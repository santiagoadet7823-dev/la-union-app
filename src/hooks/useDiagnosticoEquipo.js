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
 * Y ese es el punto delicado del panel de dirección: **"sin señal" no es "no trabajó"**. Puede
 * ser batería, permisos o zona sin cobertura. La app no puede distinguir un franco de un teléfono
 * descargado, así que no lo interpreta: expone el diagnóstico y la conversación la tiene una persona.
 *
 * Solo lectura. Filtra por empresa de forma explícita además de RLS — que para el superadmin no
 * filtra: sin el `.eq()` le aparecían acá los móviles de todos los tenants.
 */
/**
 * 🩸 DOS RELOJES, Y EL PANEL MIRABA EL EQUIVOCADO (12/08/2026, auditoría de GPS).
 *
 * `estado_dispositivo.ts` es el LATIDO DEL JS y se congela con el WebView en Doze. Las posiciones
 * las sube el SERVICIO NATIVO, que sobrevive. Este hook leía solo el latido, así que un teléfono
 * con el WebView muerto y el uploader trabajando aparecía como **"Sin actividad hoy"**.
 *
 * Medido el 12/08, que es el caso que lo destapó: **Nelson rojas tenía el último latido del 11/08
 * a las 00:51 y su último punto a las 17:34 del 12 — 41 horas de desfase**, con 1.666 posiciones
 * ese día. El panel lo daba por apagado mientras estaba en la calle. Luis 5,5 h de desfase,
 * Gabriel 1,5 h.
 *
 * Desde hoy el estado lo decide `ultimo_punto_equipo` (db/36) y el latido pasa a ser lo que de
 * verdad es: la prueba de que la APP está viva, no de que el teléfono esté reportando.
 *
 * ⚠️ Y por eso los campos que vienen del latido —`gps_ok`, `permiso`, `app_version`, la cola— **son
 * tan viejos como él**. Sobre un latido rancio no se pueden afirmar: `gps_ok` de Nelson decía
 * `false` mientras subía puntos. Se usan solo si `latidoFresco`.
 */
const RECIENTE_MS = 5 * 60000 // sin un punto (ni un latido) más nuevo que esto = "sin señal"
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
  const [puntos, setPuntos] = useState({})   // por usuario: los dos relojes de `ultimo_punto_equipo`
  const [latestOta, setLatestOta] = useState(null) // app_config.latest_version, para marcar OTA atrasada
  const [, forzar] = useState(0)

  const cargarEstados = useCallback(async () => {
    if (!idEmpresa) return
    let q = supabase.from('estado_dispositivo')
      .select('id_usuario, ts, gps_ok, gps_desde, permiso, bg_ok, cola_pendiente, cuarentena_pendiente, app_version, apk_version, instalado_ts, red, red_desde, arranque_ts')
    if (idEmpresa !== TODAS) q = q.eq('id_empresa', idEmpresa)
    // Las dos consultas van en paralelo: son carriles independientes y ninguna puede demorar a la
    // otra. Si `posiciones` falla, el panel degrada al latido (lo de siempre) en vez de quedar vacío.
    const [{ data: e }, { data: pts, error: ePts }] = await Promise.all([
      q,
      // `p_desde` = arranque del día LOCAL, nunca `toISOString().slice(0,10)` (regla 23): Salta es
      // UTC−3 y de 21:00 a 24:00 el corte en UTC ya cayó en mañana.
      supabase.rpc('ultimo_punto_equipo', {
        p_empresa: idEmpresa === TODAS ? null : idEmpresa,
        p_desde: new Date(`${hoyStr()}T00:00:00`).toISOString(),
      }),
    ])
    if (e) { const m = {}; e.forEach((r) => { m[r.id_usuario] = r }); setEstados(m) }
    // El error se MIRA: sin esto, una RPC que falla dejaba a todo el equipo en "sin actividad" —
    // que es justo el falso negativo que este cambio viene a eliminar.
    if (ePts) console.error('[diagnostico] ultimo_punto_equipo falló', ePts)
    else if (pts) { const m = {}; pts.forEach((r) => { m[r.id_usuario] = r }); setPuntos(m) }
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
    const p = puntos[u.id]

    // ── Los dos relojes, que son de dos procesos distintos (ver el 🩸 de RECIENTE_MS) ──────────
    const ultimoLatidoMs = e && e.ts ? new Date(e.ts).getTime() : null
    const latidoFresco = ultimoLatidoMs != null && now - ultimoLatidoMs <= RECIENTE_MS
    const latioHoy = ultimoLatidoMs != null && hoyStr(new Date(ultimoLatidoMs)) === hoy
    const ultimoPuntoMs = p && p.ultimo_ts ? new Date(p.ultimo_ts).getTime() : null
    const ultimoConfiableMs = p && p.ultimo_ts_confiable ? new Date(p.ultimo_ts_confiable).getTime() : null
    // "Reportando" = nos llegó un punto hace poco. Es lo que prueba que el TELÉFONO nos alcanza, y
    // no depende de que el WebView esté vivo — que es todo el punto de este cambio.
    const reportando = ultimoPuntoMs != null && now - ultimoPuntoMs <= RECIENTE_MS
    // Y "sabe dónde está" es OTRA pregunta. Un equipo que se ubica por antenas llega puntual con
    // fixes de ±120 m: sin esta distinción se vería sano, que es el modo de falla de la regla
    // 18-bis y la población de teléfonos rotos del informe §3 H2.
    const gpsConfiable = ultimoConfiableMs != null && now - ultimoConfiableMs <= RECIENTE_MS

    // 🩸 `bg_ok` TAMBIÉN sale del latido, así que sobre uno rancio no se puede afirmar. Y hay un
    // caso donde el dato viejo dice justo lo contrario de la verdad: si están ENTRANDO PUNTOS con
    // el latido muerto, la captura en 2º plano no es que esté sin confirmar — está **probada**,
    // porque esos puntos solo los pudo mandar el servicio nativo con el WebView congelado. Es mejor
    // evidencia que el propio flag.
    // Sin esto, Nelson —que subía 1.666 puntos con el latido de hacía 41 horas— salía con
    // "aún NO grabó en 2º plano → revisá el permiso", mandando a revisar algo que ya funciona.
    const bgConfirmado = !!(e && e.bg_ok) || (reportando && !latidoFresco)

    /**
     * 🩸 EL GNSS QUE NO ENGANCHA, Y POR QUÉ NO SE MIDE CON UN UMBRAL DE PRECISIÓN (12/08/2026).
     *
     * `sin-gps-confiable` no alcanza para detectar un chip muerto: esos teléfonos se ubican a
     * 15-25 m, o sea que **pasan** el techo de 30 y se ven sanos. Lo que de verdad los separa es
     * que NUNCA consiguen un fix de GPS real. Medido sobre la jornada del 12/08, % de fixes ≤ 5 m:
     *
     *   Nelson 0,0 (2.116 pts) · Gabriel 0,0 (1.024) │ Javier 7,8 · Luis 56,4 · Orlando 91,2 · Agustin 98,4
     *
     * El corte es un salto limpio entre 0,0 y 7,8, y por eso la condición es **exactamente cero**
     * y no un porcentaje: en 200 puntos, no haber bajado ni una vez de 5 m no es mala suerte.
     *
     * ⚠️ Y NO sirve `min(accuracy)` con un umbral, que fue el primer intento: Gabriel tiene su
     * mejor fix en 5,8 m —debajo de cualquier corte razonable— y aun así tiene CERO fixes buenos en
     * mil puntos. El mínimo lo salva un único fix afortunado; el conteo no.
     *
     * La muestra mínima existe porque un teléfono recién prendido todavía no enganchó, y eso no es
     * una falla: es el arranque en frío del chip.
     */
    const MUESTRA_MIN = 200
    const puntosHoy = (p && p.puntos) || 0
    const sub5 = (p && p.puntos_sub5) || 0
    const mejorAccuracy = p && p.mejor_accuracy != null ? Number(p.mejor_accuracy) : null
    const gpsNoEngancha = puntosHoy >= MUESTRA_MIN && sub5 === 0

    let estado = 'sin-actividad', motivo = 'Sin actividad hoy', color = 'var(--faint)'
    if (ultimoPuntoMs == null && !latioHoy) {
      // Ni un punto ni un latido hoy: queda el default.
    } else if (reportando && !gpsConfiable) {
      estado = 'sin-gps-confiable'
      motivo = `Reporta, pero SIN GPS confiable${ultimoConfiableMs ? ` (el último bueno, ${hhmm(ultimoConfiableMs)})` : ' en todo el día'}`
        + ' · se ubica por antenas → poné "alta precisión" y probá a cielo abierto'
      color = 'var(--danger)'
    } else if (reportando && gpsNoEngancha) {
      // Reporta puntual y ninguno es GPS de verdad: el chip no está posicionando por satélite y lo
      // está ubicando la red. Es hardware/ajuste, no algo que se arregle desde acá (informe §3 H2).
      estado = 'gps-no-engancha'
      motivo = `El GPS no engancha: en ${puntosHoy} puntos no bajó ni una vez de 5 m`
        + `${mejorAccuracy != null ? ` (lo mejor del día, ${mejorAccuracy.toFixed(1)} m)` : ''}`
        + ' · se ubica por antenas → revisá el equipo'
      color = 'var(--danger)'
    } else if (reportando && !bgConfirmado) {
      // Manda puntos pero nunca confirmó captura en 2º plano: si guarda el celular, el recorrido
      // se pierde. Aviso ámbar aunque ahora mismo "esté bien".
      estado = 'bg-sin-confirmar'
      motivo = 'Reportando, pero aún NO grabó en 2º plano → revisá permiso "Siempre" y batería'
      color = 'var(--warning)'
    } else if (reportando) {
      estado = 'ok'
      motivo = `OK · 2º plano confirmado · hace ${Math.max(0, Math.round((now - ultimoPuntoMs) / 1000))}s`
      color = 'var(--success)'
    } else if (latidoFresco && e && !e.gps_ok) {
      // La app está en pantalla AHORA, así que a este flag SÍ se le puede creer. Con el latido
      // rancio no: el `gps_ok=false` de Nelson convivía con 1.666 puntos subidos ese día.
      estado = 'gps-off'
      motivo = `GPS apagado${e.gps_desde ? ` desde ${hhmm(new Date(e.gps_desde).getTime())}` : ''}`
      color = 'var(--warning)'
    } else if (ultimoPuntoMs != null) {
      estado = 'sin-senal'
      // Distinguir la causa: sin permiso "Siempre" (no captura en 2º plano) vs. permiso OK pero
      // el SO lo suspendió (optimización de batería) vs. datos/app cerrada.
      motivo = `Sin señal desde ${hhmm(ultimoPuntoMs)}` + (bgConfirmado
        ? ' · posible optimización de batería (excluí la app) o datos/app cerrada'
        : ' · permiso "solo mientras uso" → ponelo en "Siempre"')
      color = 'var(--danger)'
    } else {
      // Latió hoy y NO mandó un solo punto. No es lo mismo que "sin señal": el teléfono habla,
      // pero no tiene nada que contar — mirá el permiso y si el GPS del aparato está prendido.
      estado = 'sin-puntos'
      motivo = `La app dio señales${ultimoLatidoMs ? ` a las ${hhmm(ultimoLatidoMs)}` : ''}, pero no mandó ninguna posición hoy`
      color = 'var(--danger)'
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
      // Los dos relojes, expuestos por separado a propósito: `ultimoLatidoMs` dice cuándo habló la
      // APP y `ultimoPuntoMs` cuándo reportó el TELÉFONO. Confundirlos era el bug.
      ultimoPuntoMs, ultimoConfiableMs, reportando, gpsConfiable,
      // 🩸 Todo lo que sale del latido (`permiso`, `gps_ok`, `ota`, `apk`, la cola) es tan viejo
      // como él. Quien lo muestre tiene que aclarar la antigüedad si esto viene en false.
      latidoFresco,
      puntosHoy,
      puntosConfiables: (p && p.puntos_confiables) || 0,
      // La vara que detecta un chip muerto, para quien quiera mostrarla (ver el 🩸 de gpsNoEngancha).
      mejorAccuracy, puntosSub5: sub5, gpsNoEngancha,
    }
  }).sort((a, b) => (a.estado === 'ok' ? 1 : 0) - (b.estado === 'ok' ? 1 : 0)) // problemas primero

  return {
    filas,
    problemas: filas.filter((f) => f.estado !== 'ok' || f.colaTrabada).length,
    recargar: cargarEstados,
  }
}
