import { useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { isNative } from '../../services/platform'
import { abrirAjustesUbicacion } from '../../services/geolocation'
import { estaExento, pedirExencion, abrirAutostart } from '../../services/battery'
import { diaUltimoBg } from '../../hooks/useEstadoDispositivo'
import Overlay from '../../components/Overlay'
import { Check } from '../../components/icons'

/**
 * Aviso de un paso para que el móvil active "Permitir siempre" la ubicación y quite la
 * restricción de batería. Android 11+ NO deja pedir "Permitir siempre" por diálogo: solo se
 * activa desde los Ajustes del teléfono. Este aviso lo explica y lleva de un toque a esa pantalla.
 *
 * No bloquea: es un cartel encima de la app que se puede posponer. Solo en nativo.
 *
 * 🩸 05/08/2026 — ANTES SE MOSTRABA UNA SOLA VEZ EN LA VIDA, aunque la persona lo cerrara sin
 * conceder absolutamente nada (`localStorage` guardaba el literal `'1'`). O sea que el único camino
 * hacia la exención de batería se gastaba en un toque distraído, para siempre.
 *
 * Y esa exención no es un "estaría bueno": es la palanca de la que cuelga que el rastreo arranque
 * al horario. Un teléfono exento queda fuera de la restricción de Android 12+ que bloquea arrancar
 * un foreground service desde background —el motivo por el que el GPS a veces no arrancaba en TODO
 * el día hasta que alguien abría la app— y, desde el APK 1.11.0, obtiene además la alarma exacta
 * sin tener que entrar a "Alarmas y recordatorios".
 *
 * Ahora la clave guarda un TIMESTAMP y el aviso vuelve cada `REPETIR_MS`, pero SOLO a quien no
 * está exento. Al que ya concedió no se le insiste nunca más.
 *
 * Compatibilidad con el valor viejo: `Number('1')` es 1 (epoch 1970), o sea "hace muchísimo" →
 * todos los que ya lo vieron vuelven a ser elegibles, que es exactamente lo que se busca.
 */
const VISTO_KEY = 'lu-permiso-siempre-visto'
const REPETIR_MS = 7 * 24 * 60 * 60 * 1000

function ultimoVisto() {
  try { return Number(localStorage.getItem(VISTO_KEY)) || 0 } catch (_) { return 0 }
}

/**
 * 🩸 EL AVISO MIRABA UNA SOLA DE LAS DOS COSAS QUE PIDE (18/08/2026). Este cartel sirve para
 * "Permitir siempre" **y** para la exención de batería, pero para decidir si REAPARECER consultaba
 * únicamente la batería. O sea que quien concedía la batería y no el permiso de fondo dejaba de ver
 * el cartel para siempre — y su teléfono seguía marcando solo con la app abierta.
 *
 * Le pasó a Zura: exención concedida, `bg_ok` en false, el servicio nativo sin entregar un fix en
 * 14 h con el latido del JS fresco, y **2.250 m de recorrido dibujados como una línea recta** entre
 * el depósito y el destino, porque guardó el teléfono en el bolsillo y el WebView se congeló.
 *
 * Se mide en DÍAS y no en horas porque el dato que hay es el día de la última captura en segundo
 * plano. Tres días cubren un fin de semana largo sin sonar de gusto: alguien que no trabajó el
 * sábado y el domingo no tiene por qué recibir el cartel el lunes.
 */
const DIAS_SIN_FONDO = 3

function elFondoAnda() {
  const d = diaUltimoBg()
  if (!d) return false // nunca capturó en segundo plano: es exactamente el caso que hay que avisar
  const t = new Date(d + 'T00:00:00').getTime()
  if (!Number.isFinite(t)) return false
  return Date.now() - t < DIAS_SIN_FONDO * 24 * 60 * 60 * 1000
}

export default function PermisoSiemprePrompt() {
  // Tres modos, y mezclarlos rompía la animación de salida:
  //   - 'nunca'   : no corresponde el aviso (no es nativo, o se mostró hace poco). No se renderiza
  //                 NADA, ni siquiera el Overlay.
  //   - 'primera' : nunca se mostró → se abre YA, sin esperar el chequeo de batería. Es el
  //                 comportamiento de siempre y no se toca: en un alta nueva el aviso también sirve
  //                 para "Permitir siempre", que es independiente de la exención.
  //   - 'repetir' : ya se mostró hace más de una semana → se abre SOLO si resulta NO exento.
  //                 Insistirle a quien ya concedió sería ruido, y ruido es lo que hace que la gente
  //                 aprenda a cerrar el cartel sin leerlo.
  const [modo] = useState(() => {
    if (!isNative()) return 'nunca'
    const visto = ultimoVisto()
    if (!visto) return 'primera'
    return Date.now() - visto < REPETIR_MS ? 'nunca' : 'repetir'
  })
  const [abierto, setAbierto] = useState(modo === 'primera')
  const [abriendo, setAbriendo] = useState(false)
  const [exento, setExento] = useState(null) // null = aún no chequeado (no renderiza para evitar flash)
  // El auto-abrir de 'repetir' ocurre UNA sola vez. Sin este guard, cerrar el cartel sin conceder
  // nada lo haría reaparecer en el próximo `visibilitychange`: el chequeo seguiría dando `false` y
  // volvería a abrirlo. Un aviso que no se puede cerrar es peor que uno que no aparece.
  const autoAbiertoRef = useRef(false)

  // Estado de exención de batería: refresca al montar y al volver a foreground (el
  // usuario responde el diálogo del sistema en otra pantalla).
  useEffect(() => {
    if (modo === 'nunca') return
    let vivo = true
    const chequear = () => estaExento().then((v) => {
      if (!vivo) return
      setExento(v)
      // Reaparece si falta CUALQUIERA de las dos, no solo la batería (ver `elFondoAnda`). Sin el
      // segundo término, un teléfono con la batería concedida y sin permiso de fondo no volvía a
      // ver este cartel nunca.
      if (modo === 'repetir' && (v === false || !elFondoAnda()) && !autoAbiertoRef.current) {
        autoAbiertoRef.current = true
        setAbierto(true)
      }
    }).catch(() => {})
    chequear()
    const onVis = () => { if (document.visibilityState === 'visible') chequear() }
    document.addEventListener('visibilitychange', onVis)
    return () => { vivo = false; document.removeEventListener('visibilitychange', onVis) }
  }, [modo])

  if (modo === 'nunca') return null

  const cerrar = () => setAbierto(false)
  // El "ya lo vio" se persiste cuando el overlay terminó de irse, no antes. Guarda el INSTANTE, que
  // es lo que hace que el aviso pueda volver dentro de una semana si sigue sin estar exento.
  const marcarVisto = () => { try { localStorage.setItem(VISTO_KEY, String(Date.now())) } catch (_) {} }
  const abrir = async () => {
    setAbriendo(true)
    await abrirAjustesUbicacion()
    setAbriendo(false)
    cerrar() // al volver de ajustes, no repetir el aviso
  }
  const pedirBateria = async () => {
    await pedirExencion() // el estado real llega por el visibilitychange al volver del diálogo del sistema
  }
  const abrirInicioAuto = async () => {
    await abrirAutostart() // abre la lista de autostart del OEM (o el detalle de la app como fallback)
  }

  return (
    <Overlay open={abierto} onClose={marcarVisto} variant="sheet" maxWidth={460}>
        <div style={sx('display:flex;align-items:center;gap:12px;margin-bottom:12px')}>
          <div style={sx('width:46px;height:46px;flex:none;border-radius:var(--r-lg);background:var(--warning-tint);color:var(--warning);display:grid;place-items:center')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
          </div>
          <div style={sx('flex:1;min-width:0')}>
            <div style={sx('font-family:var(--font-display);font-weight:700;font-size:var(--fs-lg)')}>Activá "Permitir siempre"</div>
            <div style={sx('font-size:var(--fs-xs);color:var(--muted);font-family:var(--font-mono);margin-top:1px')}>Ubicación en segundo plano</div>
          </div>
        </div>
        <div style={sx('font-size:13.5px;color:var(--muted);line-height:1.55;margin-bottom:12px')}>
          Para que tu recorrido no se corte cuando bloqueás la pantalla o cambiás de app, la ubicación
          tiene que estar en <b style={sx('color:var(--text)')}>Permitir siempre</b>. Tocá abajo y en la
          pantalla de Android elegí: <b style={sx('color:var(--text)')}>Ubicación → Permitir siempre</b>.
        </div>
        <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5;margin-bottom:12px;padding:10px 12px;background:var(--warning-tint);border:1px solid var(--warning);border-radius:12px')}>
          <b style={sx('color:var(--text)')}>Clave:</b> quitá la restricción de batería. Sin esto el
          teléfono corta el GPS a los pocos segundos de bloquear la pantalla.
        </div>
        {exento === true && (
          <div style={sx('display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:50px;background:var(--success-tint,var(--warning-tint));color:var(--success,var(--text));border:1px solid var(--success,var(--line2));border-radius:14px;font-weight:600;font-size:14px;margin-bottom:8px')}>
            <Check size={18} />
            Batería sin restricciones
          </div>
        )}
        {exento === false && (
          <button onClick={pedirBateria} style={sx('width:100%;min-height:50px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--warning);color:var(--on-primary,#fff);border:none;border-radius:14px;font-weight:600;font-size:15px;cursor:pointer;margin-bottom:8px')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="6" width="18" height="12" rx="2" /><path d="M23 10v4" /></svg>
            Quitar restricción de batería
          </button>
        )}
        {/* Inicio automático (autostart): lista APARTE de la batería en Xiaomi/Huawei/Oppo/Vivo.
            Sin esto el SO mata el proceso y el GPS deja de grabar aunque la batería esté sin
            restricciones. Se muestra siempre (no sabemos la marca desde JS de forma fiable). */}
        <button onClick={abrirInicioAuto} className="lu-press" style={sx('width:100%;min-height:50px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:14px;font-weight:600;font-size:15px;cursor:pointer;margin-bottom:8px')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" /></svg>
          Permitir inicio automático
        </button>
        <div style={sx('font-size:11.5px;color:var(--faint);line-height:1.5;margin-bottom:10px;text-align:center')}>
          En Xiaomi, Huawei y similares, activá <b style={sx('color:var(--muted)')}>Inicio automático</b> para la app.
        </div>
        <button onClick={abrir} disabled={abriendo} style={sx('width:100%;min-height:50px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border:none;border-radius:14px;font-weight:600;font-size:15px;cursor:pointer')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></svg>
          {abriendo ? 'Abriendo ajustes…' : 'Abrir ajustes de ubicación'}
        </button>
        <button type="button" onClick={cerrar} className="lu-press" style={sx('width:100%;min-height:44px;margin-top:8px;background:transparent;color:var(--muted);border:none;font-weight:600;font-size:13.5px;cursor:pointer')}>
          Más tarde
        </button>
    </Overlay>
  )
}
