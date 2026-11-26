import { useCallback, useEffect, useRef, useState } from 'react'
import { estadoUploaderNativo } from '../services/uploaderNativo'
import { getAppConfig } from '../services/data/appConfig'
import { APP_VERSION } from '../version'
import {
  leerMonitoreo, escucharBateria, marcarAlerta, alertasAbiertas, subirPendientes, subirBateria, esMayor, TIPOS,
} from '../services/monitoreo'

const NAT_MS = 30000
const CFG_MS = 600000
const VERSION_MS = 1800000
const BATERIA_MS = 300000
const SIN_SUBIR_COLA = 100
const SIN_SUBIR_MS = 20 * 60000
const KEY_CRITICA = 'lu-monitoreo-critica'

function leerCritica() {
  try { return localStorage.getItem(KEY_CRITICA) === '1' } catch (_) { return false }
}
function guardarCritica(v) {
  try { localStorage.setItem(KEY_CRITICA, v ? '1' : '0') } catch (_) { /* modo privado */ }
}

/**
 * Carteles del monitoreo (plan 54). Devuelve `{ carteles, bateria, cargando, cfg }`; `carteles` es la
 * lista de tipos activos en orden de prioridad. Vacía si el usuario no está designado o si el teléfono
 * no tiene APK piloto.
 *
 * Batería: entra en crítico con nivel < `bateria_min` y sale SOLO con nivel >= `bateria_min` (enchufar
 * el teléfono no alcanza: lo pidió así el usuario). El estado sobrevive al cierre de la app.
 */
export function useMonitoreoDispositivo({ enabled, id, gpsError }) {
  const [cfg, setCfg] = useState(null)
  const [nat, setNat] = useState(null)
  const [bat, setBat] = useState({ nivel: null, cargando: null })
  const [critica, setCritica] = useState(leerCritica)
  const [hayVersion, setHayVersion] = useState(false)
  const subidaRef = useRef({ ts: 0, clave: '' })

  const refrescarCfg = useCallback(async () => {
    if (!enabled || !id) return
    setCfg(await leerMonitoreo(id))
  }, [enabled, id])

  const refrescarNat = useCallback(async () => {
    if (!enabled) return
    setNat(await estadoUploaderNativo())
    subirPendientes()
  }, [enabled])

  useEffect(() => {
    if (!enabled || !id) return undefined
    refrescarCfg()
    refrescarNat()
    const ivCfg = setInterval(refrescarCfg, CFG_MS)
    const ivNat = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') refrescarNat()
    }, NAT_MS)
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      refrescarNat()
      refrescarCfg()
    }
    document.addEventListener('visibilitychange', alVolver)
    const desuscribir = escucharBateria(setBat)
    return () => {
      clearInterval(ivCfg)
      clearInterval(ivNat)
      document.removeEventListener('visibilitychange', alVolver)
      desuscribir()
    }
  }, [enabled, id, refrescarCfg, refrescarNat])

  const piloto = !!nat && typeof nat.ahorroEnergia === 'boolean'
  const vigente = enabled && piloto && !!cfg

  useEffect(() => {
    if (!vigente || !cfg.avisos_extra) { setHayVersion(false); return undefined }
    let vivo = true
    const chequear = async () => {
      const c = await getAppConfig().catch(() => null)
      if (vivo && c?.latest_version) setHayVersion(esMayor(c.latest_version, APP_VERSION))
    }
    chequear()
    const iv = setInterval(chequear, VERSION_MS)
    return () => { vivo = false; clearInterval(iv) }
  }, [vigente, cfg])

  const nivel = typeof bat.nivel === 'number' ? bat.nivel
    : (nat && typeof nat.bateriaPct === 'number' && nat.bateriaPct >= 0 ? nat.bateriaPct : null)
  const cargando = typeof bat.cargando === 'boolean' ? bat.cargando
    : (nat && typeof nat.cargando === 'boolean' ? nat.cargando : null)
  const temp = nat && typeof nat.bateriaTemp === 'number' && nat.bateriaTemp > -100 ? nat.bateriaTemp : null
  const min = cfg?.bateria_min ?? 40

  useEffect(() => {
    if (!vigente || nivel == null) return
    let sig = critica
    if (nivel < min) sig = true
    else if (nivel >= min) sig = false
    if (sig !== critica) { setCritica(sig); guardarCritica(sig) }
  }, [vigente, nivel, min, critica])

  const activos = []
  if (vigente) {
    if (cfg.aviso_ahorro && nat.ahorroEnergia) activos.push('ahorro')
    if (critica) activos.push('bateria_critica')
    if (cfg.avisos_extra) {
      if (nat.ubicacionActiva === false || gpsError?.code === 2) activos.push('ubicacion_apagada')
      if (temp != null && temp >= Number(cfg.temp_max || 45)) activos.push('temperatura')
      const cola = typeof nat.cola === 'number' ? nat.cola : 0
      if (cola >= SIN_SUBIR_COLA && nat.ultimaOk && Date.now() - nat.ultimaOk > SIN_SUBIR_MS) activos.push('sin_subir')
      if (hayVersion) activos.push('version_vieja')
    }
  }
  activos.sort((a, b) => TIPOS[a].orden - TIPOS[b].orden)
  const clave = activos.join(',')

  useEffect(() => {
    if (!enabled || nat == null) return
    const set = new Set(clave ? clave.split(',') : [])
    for (const t of Object.keys(TIPOS)) {
      const detalle = t === 'temperatura' ? { temp } : t === 'sin_subir' ? { cola: nat?.cola } : null
      if (set.has(t)) marcarAlerta(t, true, nivel, detalle)
    }
    for (const t of alertasAbiertas()) {
      if (!set.has(t)) marcarAlerta(t, false, nivel, null)
    }
  }, [enabled, nat, clave]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!vigente || nivel == null) return
    const k = `${critica}|${cargando}`
    const vence = Date.now() - subidaRef.current.ts >= BATERIA_MS
    if (k === subidaRef.current.clave && !vence) return
    subidaRef.current = { ts: Date.now(), clave: k }
    subirBateria(id, { bateria_pct: nivel, cargando, bateria_critica: critica, ...(temp != null ? { bateria_temp: temp } : {}) })
  }, [vigente, id, nivel, cargando, critica, temp])

  return { carteles: activos, bateria: nivel, cargando, temp, min, cfg: vigente ? cfg : null }
}
