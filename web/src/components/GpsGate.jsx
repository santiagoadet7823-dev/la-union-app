import { useEffect, useRef, useState } from 'react'
import { sx } from '../lib/sx'
import { useGps } from '../context/GpsContext'
import { publicarAlerta } from '../services/sync/realtime'
import PermisoSiemprePrompt from '../features/movil/PermisoSiemprePrompt'
import { Pin } from './icons'

const STALE_MS = 120000 // sin fix nuevo por 2 min => se considera GPS desactivado
                        // (el latido de useLivePosition refresca cada 60s aunque esté quieto)
const GRACE_MS = 15000  // fase 1: buscar el primer fix con un loader neutro ("Buscando señal…")
const GUIA_MS = 35000   // fase 2: si sigue sin fix, sumar la guía "salí a cielo abierto" + reintento

/**
 * Puerta de GPS obligatorio para las vistas móviles. Al abrir, PRIMERO busca la
 * ubicación en silencio (loader neutro). El cartel rojo de alarma ("GPS desactivado")
 * se reserva para el ÚNICO caso realmente accionable: permiso denegado o ubicación
 * apagada. Mientras el GPS solo está tardando en enganchar, se muestra un loader calmo.
 *
 * ⚠️ Por qué NO todo error va al cartel rojo (22/07/2026): en una tablet barata (o
 * cualquier device de GPS lento, bajo techo), el primer lock en frío tarda 30-60 s y
 * `request()` tira TIMEOUT (code 3) antes. El cartel decía "Permiso denegado o ubicación
 * apagada" siendo que el permiso estaba concedido y la ubicación encendida — se leía como
 * "la app no funciona". Ahora un timeout/posición-no-disponible mantiene el loader de
 * "Buscando señal…" y sigue reintentando; solo un permiso denegado real corta y alarma.
 */

// Un error de geolocalización NO es siempre "permiso denegado". La distinción decide el
// mensaje Y si conviene seguir reintentando:
//  - Permiso denegado / ubicación apagada = ACCIONABLE, irrecuperable sin el usuario.
//    · Web (navigator.geolocation, lo usa `request()`): GeolocationPositionError.code === 1.
//    · Nativo (background-geolocation watcher): error.code === 'NOT_AUTHORIZED'.
//  - Timeout (code 3) / posición no disponible (code 2) = TODAVÍA sin fix: arranque en frío
//    o bajo techo. Recuperable → seguir buscando, NO gritar "permiso denegado".
function esPermisoDenegado(e) {
  if (!e) return false
  return e.code === 1 || e.code === 'NOT_AUTHORIZED' || e.code === 'PERMISSION_DENIED'
}

export default function GpsGate({ children }) {
  const { pos, error, request, id, nombre, rol, idEmpresa, enHorario } = useGps()
  const [now, setNow] = useState(Date.now())
  const [mountedAt] = useState(() => Date.now())

  // Tick para re-evaluar la frescura del fix aunque no lleguen posiciones nuevas.
  // Solo con la app visible: en 2º plano nadie mira el cartel y el tick costaba 1200
  // re-renders/hora al pedo. Al volver a foreground se re-arma y se refresca `now` en
  // el acto, así la frescura se recalcula sin esperar al primer tick.
  useEffect(() => {
    let iv = null
    const armar = () => {
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible'
      if (visible && !iv) {
        setNow(Date.now())
        iv = setInterval(() => setNow(Date.now()), 3000)
      } else if (!visible && iv) {
        clearInterval(iv)
        iv = null
      }
    }
    armar()
    document.addEventListener('visibilitychange', armar)
    return () => {
      document.removeEventListener('visibilitychange', armar)
      if (iv) clearInterval(iv)
    }
  }, [])

  const activo = !!pos && !error && now - pos.ts < STALE_MS
  // Único caso de alarma: permiso denegado / ubicación apagada. Todo lo demás (sin fix
  // todavía) es "buscando", no una falla.
  const permisoDenegado = esPermisoDenegado(error)

  // Auto-recupero: reintenta pedir la ubicación mientras no haya fix. Antes cortaba ante
  // CUALQUIER error; ahora sigue reintentando ante timeout/posición-no-disponible (el GPS
  // puede enganchar en cualquier momento) y solo se detiene si el permiso está denegado
  // (reintentar no sirve sin acción del usuario) o fuera de horario (sensor apagado a
  // propósito, no re-preguntar ni gastar batería).
  //
  // Guard de "request en vuelo": el reintento es cada 8 s pero el timeout de
  // getCurrentPosition es de 20 s, así que sin señal se apilaban 2-3 pedidos de alta
  // precisión concurrentes. Ahora no se dispara otro hasta que el anterior resuelva.
  const enVueloRef = useRef(false)
  useEffect(() => {
    if (activo || permisoDenegado || !enHorario) return
    const pedir = () => {
      if (enVueloRef.current) return
      enVueloRef.current = true
      request()
        .catch(() => {})
        .finally(() => { enVueloRef.current = false })
    }
    pedir()
    const iv = setInterval(pedir, 8000)
    return () => clearInterval(iv)
  }, [activo, permisoDenegado, enHorario, request])

  // Alerta al Admin solo en transiciones reales (no durante la búsqueda inicial ni
  // por el apagado esperado fuera de horario).
  const prev = useRef(activo)
  useEffect(() => {
    if (!enHorario) { prev.current = activo; return }
    if (prev.current && !activo) publicarAlerta({ id, nombre, rol, idEmpresa, tipo: 'gps-off', ts: Date.now() })
    if (!prev.current && activo) publicarAlerta({ id, nombre, rol, idEmpresa, tipo: 'gps-on', ts: Date.now() })
    prev.current = activo
  }, [activo, enHorario, id, nombre, rol, idEmpresa])

  // GPS OK → mostramos la app y, encima, el aviso de "Permitir siempre" (una vez, solo nativo).
  if (activo) return <>{children}<PermisoSiemprePrompt /></>

  // Fuera del horario de rastreo configurado: el GPS está apagado A PROPÓSITO
  // (ahorro de batería). No es una falla — no hay que bloquear la app.
  if (!enHorario) return <>{children}</>

  // Permiso denegado / ubicación apagada → cartel ACCIONABLE (el único caso de alarma roja).
  if (permisoDenegado) {
    return (
      <div style={sx('height:100%;min-height:600px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px;padding:28px 22px;background:var(--bg-app);color:var(--text)')}>
        <div style={sx('width:76px;height:76px;border-radius:99px;display:grid;place-items:center;background:var(--danger-tint);border:1px solid var(--danger)')}>
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><path d="m4.5 4.5 15 15" />
          </svg>
        </div>
        <div style={sx('font-family:var(--font-display);font-weight:700;font-size:20px;color:var(--danger)')}>GPS desactivado</div>
        <div style={sx('font-size:13.5px;color:var(--muted);max-width:300px;line-height:1.5')}>
          La app <b>requiere la ubicación activada</b> para operar. Habilitá la ubicación en los
          ajustes del teléfono y tocá "Activar GPS". El panel fue notificado de que tu GPS está apagado.
        </div>
        <button
          onClick={() => request().catch(() => {})}
          style={sx('margin-top:6px;min-height:52px;padding:0 22px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border:none;border-radius:14px;font-weight:600;font-size:15px;cursor:pointer')}
        >
          <Pin size={18} /> Activar GPS
        </button>
        <div style={sx('margin-top:8px;font-family:var(--font-mono);font-size:10.5px;color:var(--faint)')}>{nombre} · {rol}</div>
      </div>
    )
  }

  // Sin fix todavía (arranque en frío / bajo techo / sin cobertura): loader CALMO, no alarma.
  // Fase 2 (tras GUIA_MS): sumamos la guía de cielo abierto + un reintento secundario, por si
  // en realidad la ubicación está apagada y el SO no devolvió un code de permiso (p.ej. code 2).
  const elapsed = now - mountedAt
  const conGuia = elapsed >= GUIA_MS
  return (
    <div style={sx('height:100%;min-height:600px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px;padding:28px 22px;background:var(--bg-app);color:var(--text)')}>
      <div style={sx('width:34px;height:34px;border-radius:99px;border:3px solid var(--line2);border-top-color:var(--primary)')} className="lu-spin" />
      <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Buscando señal GPS…</div>
      <div style={sx('font-size:12.5px;color:var(--muted);max-width:300px;line-height:1.5')}>
        {conGuia
          ? 'El primer enganche puede tardar. Salí a un lugar con vista al cielo, lejos de techos y paredes.'
          : 'Un momento, estamos ubicándote.'}
      </div>
      {conGuia && (
        <button
          onClick={() => request().catch(() => {})}
          style={sx('margin-top:4px;min-height:44px;padding:0 18px;display:flex;align-items:center;justify-content:center;gap:8px;background:transparent;color:var(--primary);border:1px solid var(--primary);border-radius:12px;font-weight:600;font-size:14px;cursor:pointer')}
        >
          <Pin size={16} /> Reintentar
        </button>
      )}
      <div style={sx('margin-top:8px;font-family:var(--font-mono);font-size:10.5px;color:var(--faint)')}>{nombre} · {rol}</div>
    </div>
  )
}
