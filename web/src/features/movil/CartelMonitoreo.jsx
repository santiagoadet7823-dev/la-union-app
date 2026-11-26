import { useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { abrirAjusteAhorro, abrirAjusteUbicacion } from '../../services/monitoreo'
import { abrirAjustesUbicacion } from '../../services/geolocation'

/**
 * Banda fija arriba de todo, sin botón de cerrar (plan 54). Se va sola cuando desaparece la causa:
 * la batería vuelve al umbral, se apaga el ahorro, etc. No bloquea la app: el vendedor o el
 * repartidor puede seguir trabajando debajo.
 */
function texto(tipo, { bateria, cargando, temp, min }) {
  switch (tipo) {
    case 'ahorro':
      return {
        icono: '⚠',
        titulo: 'Ahorro de energía prendido',
        cuerpo: 'Con la pantalla apagada el GPS no funciona. Desactivalo.',
        pasos: 'Deslizá desde arriba y tocá "Ahorro de energía" para apagarlo.',
        accion: 'Desactivar',
      }
    case 'bateria_critica':
      return cargando
        ? {
            icono: '🔌',
            titulo: `Cargando · ${bateria ?? '—'} %`,
            cuerpo: `El aviso se quita al llegar a ${min} %.`,
          }
        : {
            icono: '⚠',
            titulo: `Batería crítica: ${bateria ?? '—'} %`,
            cuerpo: `Entraste en período crítico de batería. Poné el teléfono a cargar. El aviso se quita al llegar a ${min} %.`,
          }
    case 'ubicacion_apagada':
      return {
        icono: '📍',
        titulo: 'Ubicación apagada',
        cuerpo: 'El teléfono no está dando la ubicación. Prendé la ubicación.',
        pasos: 'Deslizá desde arriba y tocá "Ubicación".',
        accion: 'Prender',
      }
    case 'temperatura':
      return {
        icono: '🌡',
        titulo: `Batería caliente: ${temp ?? '—'} °C`,
        cuerpo: 'Sacá el teléfono del sol o del tablero del auto.',
      }
    case 'sin_subir':
      return {
        icono: '📶',
        titulo: 'Recorrido sin subir',
        cuerpo: 'Hace rato que no se envían tus puntos. Revisá los datos móviles o el modo avión.',
      }
    case 'version_vieja':
      return {
        icono: '⬆',
        titulo: 'Versión desactualizada',
        cuerpo: 'Cerrá la app del todo y volvé a abrirla con señal para actualizar.',
      }
    default:
      return null
  }
}

function Banda({ tipo, datos }) {
  const [sinAjuste, setSinAjuste] = useState(false)
  const t = texto(tipo, datos)
  if (!t) return null
  const accionar = async () => {
    let ok = false
    if (tipo === 'ahorro') ok = await abrirAjusteAhorro()
    if (tipo === 'ubicacion_apagada') ok = (await abrirAjusteUbicacion()) || (await abrirAjustesUbicacion())
    if (!ok) setSinAjuste(true)
  }
  const fuerte = tipo === 'ahorro' || tipo === 'bateria_critica' || tipo === 'ubicacion_apagada'
  return (
    <div
      role="alert"
      data-cartel={tipo}
      style={sx(`display:flex;align-items:flex-start;gap:10px;padding:10px 14px;
        background:${fuerte ? 'var(--danger)' : 'var(--warning)'};
        color:${fuerte ? 'var(--on-danger)' : 'var(--on-warning)'};
        border-bottom:1px solid rgba(0,0,0,0.15)`)}
    >
      <div aria-hidden="true" style={sx('font-size:20px;line-height:1.2;flex:none')}>{t.icono}</div>
      <div style={sx('flex:1;min-width:0')}>
        <div style={sx('font-weight:700;font-size:14px;line-height:1.3')}>{t.titulo}</div>
        <div style={sx('font-size:12.5px;line-height:1.4;opacity:0.95')}>{t.cuerpo}</div>
        {sinAjuste && t.pasos && (
          <div style={sx('font-size:12.5px;line-height:1.4;margin-top:4px;font-weight:600')}>{t.pasos}</div>
        )}
      </div>
      {t.accion && (
        <button
          type="button"
          onClick={accionar}
          style={sx(`flex:none;align-self:center;min-height:36px;padding:0 12px;border-radius:10px;cursor:pointer;
            font-weight:700;font-size:13px;background:transparent;color:inherit;border:1.5px solid currentColor`)}
        >
          {t.accion}
        </button>
      )}
    </div>
  )
}

/** Publica el alto de la banda en `--cartel-h` para que el AppShell corra el contenido y no tape el encabezado. */
function usePublicarAlto(ref, hay) {
  useEffect(() => {
    const raiz = document.documentElement
    const el = ref.current
    if (!hay || !el) { raiz.style.removeProperty('--cartel-h'); return undefined }
    const medir = () => raiz.style.setProperty('--cartel-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    medir()
    let ro = null
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(medir); ro.observe(el) }
    window.addEventListener('resize', medir)
    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener('resize', medir)
      raiz.style.removeProperty('--cartel-h')
    }
  }, [ref, hay])
}

export default function CartelMonitoreo({ carteles, bateria, cargando, temp, min }) {
  const ref = useRef(null)
  const hay = !!carteles && carteles.length > 0
  usePublicarAlto(ref, hay)
  if (!hay) return null
  const datos = { bateria, cargando, temp, min }
  return (
    <div
      ref={ref}
      style={sx(`position:fixed;top:0;left:0;right:0;z-index:2147483000;
        padding-top:env(safe-area-inset-top);box-shadow:0 2px 10px rgba(0,0,0,0.25)`)}
    >
      {carteles.slice(0, 3).map((t) => <Banda key={t} tipo={t} datos={datos} />)}
    </div>
  )
}
