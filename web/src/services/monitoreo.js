/**
 * Monitoreo de dispositivos designados por el superadmin (plan 54, db/116).
 *
 * Solo corre en teléfonos con APK piloto (>= 1.46.1): la señal es que el plugin nativo devuelva
 * `ahorroEnergia`, que el APK del parque no trae. El servidor aplica la misma regla
 * (`monitoreo_vigente`), así que un teléfono sin piloto no ve carteles ni abre alertas.
 */
import { supabase, hasSupabase } from './supabase'
import { isNative } from './platform'
import { BatteryOptimization } from './battery'

const KEY_CFG = 'lu-monitoreo-cfg'
const KEY_PEND = 'lu-monitoreo-pend'
const KEY_ABIERTAS = 'lu-monitoreo-abiertas'

export const TIPOS = {
  ahorro: { orden: 0 },
  bateria_critica: { orden: 1 },
  ubicacion_apagada: { orden: 2 },
  temperatura: { orden: 3 },
  sin_subir: { orden: 4 },
  version_vieja: { orden: 5 },
}

function leerLS(k, def) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def } catch (_) { return def }
}
function guardarLS(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch (_) { /* modo privado */ }
}

/** Config del monitoreo del usuario. Sin red devuelve la última conocida; null = no monitoreado. */
export async function leerMonitoreo(userId) {
  const cache = leerLS(KEY_CFG, null)
  const local = cache && cache.id === userId ? cache.cfg : null
  if (!hasSupabase || !userId) return local
  try {
    const { data, error } = await supabase.from('dispositivo_monitoreo')
      .select('activo, bateria_min, aviso_ahorro, avisos_extra, temp_max')
      .eq('id_usuario', userId).maybeSingle()
    if (error) return local
    const cfg = data && data.activo ? data : null
    guardarLS(KEY_CFG, { id: userId, cfg })
    return cfg
  } catch (_) {
    return local
  }
}

/** Suscripción a la batería del WebView. Devuelve una función para desuscribirse. */
export function escucharBateria(cb) {
  let bat = null
  let vivo = true
  const leer = () => {
    if (!vivo || !bat) return
    cb({ nivel: Math.round(bat.level * 100), cargando: !!bat.charging })
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function') {
      navigator.getBattery().then((b) => {
        bat = b
        b.addEventListener('levelchange', leer)
        b.addEventListener('chargingchange', leer)
        leer()
      }).catch(() => {})
    }
  } catch (_) { /* sin API → el nivel sale del nativo si lo trae */ }
  return () => {
    vivo = false
    if (bat) {
      bat.removeEventListener('levelchange', leer)
      bat.removeEventListener('chargingchange', leer)
    }
  }
}

/**
 * Entrada/salida de una alerta. Va a una cola en localStorage y se sube con `subirPendientes`:
 * sin señal no se pierde (y el orden se respeta).
 */
export function marcarAlerta(tipo, abierta, bateria = null, detalle = null) {
  const abiertas = leerLS(KEY_ABIERTAS, {})
  if (!!abiertas[tipo] === !!abierta) return
  if (abierta) abiertas[tipo] = Date.now(); else delete abiertas[tipo]
  guardarLS(KEY_ABIERTAS, abiertas)
  const pend = leerLS(KEY_PEND, [])
  pend.push({ tipo, abierta: !!abierta, bateria, detalle, ts: Date.now() })
  guardarLS(KEY_PEND, pend.slice(-200))
  subirPendientes()
}

/** Alertas que el teléfono cree tener abiertas (para cerrarlas si se apaga el monitoreo). */
export function alertasAbiertas() {
  return Object.keys(leerLS(KEY_ABIERTAS, {}))
}

let subiendo = false
export async function subirPendientes() {
  if (subiendo || !hasSupabase) return
  subiendo = true
  try {
    let pend = leerLS(KEY_PEND, [])
    while (pend.length) {
      const p = pend[0]
      const { error } = await supabase.rpc('monitoreo_marcar', {
        p_tipo: p.tipo, p_abierta: p.abierta, p_bateria: p.bateria, p_detalle: p.detalle,
      })
      if (error) break
      pend = leerLS(KEY_PEND, []).slice(1)
      guardarLS(KEY_PEND, pend)
    }
  } catch (_) { /* sin red → reintenta en la próxima pasada */ }
  subiendo = false
}

/** Sube nivel/carga/temperatura a la fila propia de `estado_dispositivo` (columnas de db/116). */
export async function subirBateria(id, datos) {
  if (!hasSupabase || !id) return false
  try {
    const { error } = await supabase.from('estado_dispositivo')
      .update({ ...datos, bateria_ts: new Date().toISOString() })
      .eq('id_usuario', id)
    return !error
  } catch (_) {
    return false
  }
}

/** Abre el ajuste del ahorro de energía (APK piloto modificaciones). false si el APK no lo trae. */
export async function abrirAjusteAhorro() {
  if (!isNative()) return false
  try {
    const r = await BatteryOptimization.abrirAhorro()
    return !!(r && r.abierto)
  } catch (_) {
    return false
  }
}

/** Abre el ajuste de ubicación del sistema (APK piloto modificaciones). */
export async function abrirAjusteUbicacion() {
  if (!isNative()) return false
  try {
    const r = await BatteryOptimization.abrirUbicacion()
    return !!(r && r.abierto)
  } catch (_) {
    return false
  }
}

export function esMayor(nueva, actual) {
  const a = String(nueva || '').split('.').map((n) => parseInt(n, 10) || 0)
  const b = String(actual || '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  }
  return false
}
