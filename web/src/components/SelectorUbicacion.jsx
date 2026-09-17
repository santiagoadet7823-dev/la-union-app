import { useEffect, useRef, useState } from 'react'
import { sx } from '../lib/sx'
import LeafletMap from './LeafletMap'
import ErrorBoundary from './ErrorBoundary'
import { Crosshair } from './icons'
import { useTheme } from '../context/ThemeContext'
import { CENTRO } from '../data/demoGeo'

/**
 * ELEGIR UN PUNTO EN EL MAPA, como en Google Maps: el pin queda CLAVADO en el centro y lo que se
 * mueve es el mapa. Donde quedó el pin al soltar es la ubicación.
 *
 * 🩸 POR QUÉ ESTE PATRÓN Y NO "TOCÁ EL MAPA" (17/09/2026). Hasta hoy las tres pantallas que ubican
 * un comercio (`EditarClienteVendedor`, `NuevoCliente`, `FichaCliente`) ponían el punto donde se
 * tocaba el mapa (`onMapClick`). Con el dedo eso tiene ±15 px de error y ninguna forma de afinar:
 * el segundo toque mueve el punto a OTRO lugar impreciso. Y el check-in guardaba el GPS del
 * teléfono sin mostrarlo — *"el GPS de varios teléfonos de La Unión falla"* (el cliente), así que
 * se cargaban ubicaciones malas sin que nadie las viera. Acá se ve el punto azul del GPS con su
 * círculo de precisión al lado del pin: si el GPS dice ±120 m, se ve.
 *
 * No es un marker arrastrable de Leaflet: arrastrar un marker con el dedo lo tapa justo cuando
 * hay que mirarlo, y un mapa que se mueve debajo de un pin fijo es lo que la gente ya sabe usar.
 *
 * props:
 *   inicial    {lat,lng} | null — dónde arranca el pin (la ubicación actual del comercio, o el
 *              resultado de "usar mi ubicación")
 *   live       {lat,lng,accuracy} | null — posición GPS de la persona; punto azul + círculo
 *   onCambio   ({lat,lng}) en cada fin de movimiento
 *   alto       px del mapa
 *   nombre     del comercio, para el `title` del pin
 *   centroPorDefecto  {lat,lng} donde abre el mapa si no hay `inicial` ni `live` (la base de la
 *              empresa en la ficha del admin). NO cuenta como punto elegido: hasta que no se mueve
 *              el mapa no se emite nada.
 *
 * NO tiene botón de confirmar: lo pone quien lo usa, porque el texto del botón depende de la
 * pantalla ("Guardar ubicación", "Confirmar ubicación", "Crear cliente").
 */

// El pin del centro: misma gota que `pinComercioIcon` (LeafletMap) y `Muestra`. Si cambia la
// silueta del pin, son tres lugares y están enlazados por este comentario.
const W = 30
const H = Math.round(W * 1.207)

export default function SelectorUbicacion({ inicial = null, live = null, onCambio, alto = 260, nombre = '', centroPorDefecto = null }) {
  const { theme } = useTheme()
  const [focus, setFocus] = useState(null)
  const enfocar = (p) => setFocus({ points: [p], nonce: Date.now() })
  const onCambioRef = useRef(onCambio)
  onCambioRef.current = onCambio

  // Un `inicial` nuevo (p. ej. "usar mi ubicación") lleva el mapa ahí; el `moveend` del vuelo
  // emite el punto solo, así que el padre se entera por el mismo camino que un arrastre.
  const inicialKey = inicial ? `${inicial.lat},${inicial.lng}` : ''
  useEffect(() => { if (inicial) enfocar(inicial) }, [inicialKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const centro = inicial || live || centroPorDefecto || CENTRO
  const acc = live?.accuracy != null ? Math.round(live.accuracy) : null
  const gpsMalo = acc != null && acc > 50

  return (
    <div>
      <div style={{ position: 'relative', height: alto, borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid var(--line)', isolation: 'isolate' }}>
        <ErrorBoundary compact message="No se pudo cargar el mapa.">
          <LeafletMap
            theme={theme}
            height="100%"
            radius={0}
            center={centro}
            zoom={17}
            fit={false}
            focus={focus}
            live={live}
            // El círculo de precisión sólo cuando vale la pena verlo: con ±10 m es un puntito.
            circle={live && acc != null && acc > 30 ? { lat: live.lat, lng: live.lng, radiusM: acc, color: gpsMalo ? '#F59E0B' : '#0EA5E9' } : null}
            onMoveEnd={(c) => onCambioRef.current?.(c)}
          />
        </ErrorBoundary>

        {/* EL PIN, clavado al centro. `pointer-events:none` en todo: el arrastre es del mapa. La
            punta cae exactamente en el centro del contenedor (translate(-50%,-100%) sobre un
            recuadro de alto 1,207·w — ver la explicación en `pinComercioIcon`). */}
        <div aria-hidden="true" title={nombre} style={{ position: 'absolute', left: '50%', top: '50%', width: W, height: H, transform: 'translate(-50%,-100%)', pointerEvents: 'none', zIndex: 'var(--z-chrome)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: W, background: 'var(--primary)', border: '2px solid #fff', borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)', boxShadow: '0 2px 6px rgba(0,0,0,.4)', boxSizing: 'border-box' }} />
          <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: W, display: 'grid', placeItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: '#fff' }} />
          </div>
        </div>
        {/* La sombra bajo la punta: dice "acá" aunque el pin tape el mapa. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: 10, height: 4, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: 'rgba(0,0,0,.35)', pointerEvents: 'none', zIndex: 'var(--z-chrome)' }} />

        {/* Ir a mi ubicación: mismo botón y misma esquina que `MapaComercios`. */}
        <button
          type="button"
          onClick={() => { if (live) enfocar({ lat: live.lat, lng: live.lng }) }}
          disabled={!live}
          className="lu-press"
          aria-label="Ir a mi ubicación"
          title={live ? 'Ir a mi ubicación' : 'Sin señal GPS todavía'}
          style={{ ...sx('position:absolute;right:10px;bottom:10px;width:40px;height:40px;display:grid;place-items:center;border-radius:var(--r-md);border:0.5px solid var(--glass-brd);background:var(--glass-bg);box-shadow:var(--shadow-lg);cursor:pointer;z-index:var(--z-chrome)'), color: live ? 'var(--text)' : 'var(--faint)', opacity: live ? 1 : 0.6 }}
        >
          <Crosshair size={17} />
        </button>
      </div>

      {/* El renglón que hoy no existía: cuánto vale el GPS que se está mirando. */}
      <div style={{ ...sx('display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;font-family:var(--font-mono)'), color: live ? (gpsMalo ? 'var(--warning)' : 'var(--muted)') : 'var(--faint)' }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, flex: 'none', background: live ? (gpsMalo ? 'var(--warning)' : '#0EA5E9') : 'var(--faint)' }} />
        {!live
          ? 'Sin señal GPS · mové el mapa hasta el comercio'
          : acc == null
            ? 'GPS activo · mové el mapa hasta que el pin quede sobre el comercio'
            : gpsMalo
              ? `GPS ±${acc} m — poco preciso: mové el mapa hasta el comercio`
              : `GPS ±${acc} m · mové el mapa hasta que el pin quede sobre el comercio`}
      </div>
    </div>
  )
}
