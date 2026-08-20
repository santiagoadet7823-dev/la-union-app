import { useMemo, useRef, useState } from 'react'
import { sx } from '../../../lib/sx'
import { exportarRutaPng, limitesDe, pickZoom } from '../../../services/report/rutaPng'
import { fmtDuracion, fmtHora } from '../../../lib/format'
import { simplificarTrazo } from '../../../lib/geo'

/**
 * La imagen del recorrido dentro del informe.
 *
 * Reusa `services/report/rutaPng.js`, que ya componía el informe gráfico entero (tiles, polilínea,
 * encabezado corporativo, chips de datos) y llevaba meses siendo código inalcanzable: colgaba de
 * `ReplayJornada`, que a su vez cuelga de `AdminView`, que ningún rol puede abrir. Acá vuelve a
 * usarse, con los carteles de parada numerados que antes no tenía.
 *
 * 🩸 SE GENERA A PEDIDO, con un botón, y no al abrir la ficha. Componer la imagen descarga entre 6
 * y 20 tiles de OpenStreetMap: hacerlo automáticamente para cada persona que uno mira significa
 * cientos de descargas por sesión contra un servidor donado, para una imagen que la mayoría de las
 * veces nadie va a mirar. El botón es también el consentimiento de gastar esos datos en el teléfono
 * de alguien que está en la calle.
 *
 * Una vez generada queda como <img> en la página, así que entra sola al PDF: por eso el PDF sale
 * CON el mapa adentro sin ningún trabajo extra de impresión.
 *
 * 🩸 ENCUADRE A MANO (19/08/2026). El cliente reportó que un recorrido de ciudad a ciudad sale
 * ilegible: la caja la estira el tramo interurbano y el detalle urbano —donde están las paradas—
 * desaparece. Ahora se puede acercar, alejar y ARRASTRAR sobre la imagen ya compuesta.
 *
 * El arrastre mueve el `<img>` con `transform` mientras el dedo está abajo y **recién al soltar**
 * recompone. Es deliberado: recomponer durante el arrastre serían decenas de tandas de tiles contra
 * un servidor que nos regala el servicio. Por lo mismo `rutaPng` cachea los tiles de la sesión, así
 * volver a un encuadre ya visto no pide nada.
 *
 * Todos los controles llevan `lu-no-print`: sirven para preparar la foto, no salen en el PDF.
 */
export default function MapaRecorrido({ usuario, puntos }) {
  const [estado, setEstado] = useState('inicial')  // inicial | generando | listo | error
  const [imagen, setImagen] = useState(null)
  const [zoom, setZoom] = useState(null)           // null = el automático
  const [centro, setCentro] = useState(null)       // null = el centro de la caja
  const [arrastre, setArrastre] = useState(null)   // {x0,y0,dx,dy} mientras el dedo está abajo
  const imgRef = useRef(null)

  const hayRecorrido = (puntos?.length || 0) >= 2

  // El trazo simplificado se comparte entre generar, descargar y el cálculo del zoom automático.
  // Una jornada son miles de puntos y recalcular esto en cada reencuadre es trabajo puro.
  const coords = useMemo(() => (hayRecorrido ? simplificarTrazo(puntos) : []), [puntos, hayRecorrido])

  // El zoom que elegiría la función sola, con la MISMA escala con la que se compone (2). Es el
  // punto de partida de los botones + / −: sin esto, el primer toque saltaría a un valor arbitrario.
  const zoomAuto = useMemo(
    () => (coords.length >= 2 ? pickZoom(limitesDe(coords), 960 * 2, 600 * 2, 60 * 2) : 13),
    [coords]
  )
  const zoomActual = zoom == null ? zoomAuto : zoom
  const encuadrado = zoom != null || centro != null

  const comunes = () => ({
    coords,
    titulo: usuario.nombre || usuario.rol || 'Recorrido',
    subtitulo: `${usuario.inicioTs ? fmtHora(usuario.inicioTs) : '—'} – ${usuario.finTs ? fmtHora(usuario.finTs) : '—'}`,
    stats: [
      { label: 'Distancia', value: usuario.km.toFixed(1) + ' km' },
      { label: 'Paradas', value: String(usuario.paradasN) },
      { label: 'Movimiento', value: fmtDuracion(usuario.movimientoMs) },
    ],
    color: usuario.color,
    paradas: usuario.paradas.map((p) => ({ lat: p.lat, lng: p.lng, orden: p.orden })),
  })

  async function componer(opciones = {}) {
    setEstado('generando')
    try {
      const dataUrl = await exportarRutaPng({
        ...comunes(),
        // Escala 2: el lienzo pasa a 1920×1200 y, como `pickZoom` decide sobre el lienzo ya
        // escalado, los tiles entran a resolución nativa en vez de agrandados. A 960×600 el PDF
        // salía a ~96 dpi y se veía pixelado en papel.
        escala: 2,
        zoom: opciones.zoom !== undefined ? opciones.zoom : zoom,
        centro: opciones.centro !== undefined ? opciones.centro : centro,
        devolver: 'dataUrl',
      })
      setImagen(dataUrl)
      setEstado('listo')
    } catch (e) {
      console.warn('[informe] no se pudo componer la imagen del recorrido', e)
      setEstado('error')
    }
  }

  async function descargar() {
    // La descarga suelta respeta el encuadre que se ve en pantalla: si alguien acomodó el mapa y
    // después baja el PNG, esperar la misma imagen y no el encuadre automático.
    await exportarRutaPng({
      ...comunes(),
      escala: 2,
      zoom,
      centro,
      filename: `recorrido-${(usuario.nombre || usuario.id).replace(/\s+/g, '-').toLowerCase()}.png`,
    })
  }

  function cambiarZoom(delta) {
    const z = Math.max(3, Math.min(18, zoomActual + delta))
    if (z === zoomActual) return
    setZoom(z)
    componer({ zoom: z })
  }

  function volverAuto() {
    setZoom(null); setCentro(null)
    componer({ zoom: null, centro: null })
  }

  // --- Arrastre para mover el centro ---
  // Se convierte el desplazamiento en PÍXELES de pantalla a grados con la misma matemática de
  // slippy-map que usa `rutaPng`: 256 px por tile, 2^z tiles por vuelta al mundo. El factor
  // `anchoReal/anchoMostrado` corrige que la imagen se ve escalada al ancho del informe.
  function alSoltar() {
    if (!arrastre) return
    const { dx, dy } = arrastre
    setArrastre(null)
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return // un toque, no un arrastre

    const img = imgRef.current
    const factor = img ? (960 * 2) / img.clientWidth : 1
    const pxPorVuelta = 256 * Math.pow(2, zoomActual)
    const b = limitesDe(coords)
    const cLat = centro?.lat ?? (b.minLat + b.maxLat) / 2
    const cLng = centro?.lng ?? (b.minLng + b.maxLng) / 2

    // Arrastrar la imagen a la derecha mueve la CÁMARA a la izquierda: de ahí los signos.
    const nuevoLng = cLng - (dx * factor / pxPorVuelta) * 360
    // En Mercator un desplazamiento vertical no son grados constantes; se aproxima con la
    // derivada en la latitud actual, que a esta escala es exacta a menos de un píxel.
    const gradosPorPx = (360 / pxPorVuelta) * Math.cos((cLat * Math.PI) / 180)
    const nuevoLat = Math.max(-85, Math.min(85, cLat + dy * factor * gradosPorPx))

    const c = { lat: nuevoLat, lng: nuevoLng }
    setCentro(c)
    componer({ centro: c })
  }

  if (!hayRecorrido) {
    return <div style={sx('font-size:var(--fs-xs);color:var(--faint)')}>Sin recorrido suficiente para componer una imagen.</div>
  }

  if (estado === 'listo' || (estado === 'generando' && imagen)) {
    const ocupado = estado === 'generando'
    return (
      <div>
        <div
          style={{ ...sx('position:relative;overflow:hidden;border-radius:var(--r-md);border:1px solid var(--line);touch-action:none'), cursor: arrastre ? 'grabbing' : 'grab' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setArrastre({ x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 }) }}
          onPointerMove={(e) => arrastre && setArrastre((a) => ({ ...a, dx: e.clientX - a.x0, dy: e.clientY - a.y0 }))}
          onPointerUp={alSoltar}
          onPointerCancel={() => setArrastre(null)}
        >
          <img
            ref={imgRef}
            src={imagen}
            alt="Recorrido del día"
            draggable={false}
            style={{
              ...sx('width:100%;height:auto;display:block;user-select:none'),
              transform: arrastre ? `translate(${arrastre.dx}px, ${arrastre.dy}px)` : 'none',
              opacity: ocupado ? 0.55 : 1,
              transition: arrastre ? 'none' : 'opacity 160ms cubic-bezier(.23,1,.32,1)',
            }}
          />
          {ocupado && (
            <div className="lu-no-print" style={sx('position:absolute;top:8px;left:8px;padding:4px 10px;border-radius:var(--r-pill);background:var(--surface);border:1px solid var(--line);font-size:var(--fs-2xs);font-weight:600;color:var(--muted)')}>
              Recomponiendo…
            </div>
          )}
        </div>

        <div className="lu-no-print" style={sx('margin-top:9px;display:flex;align-items:center;gap:7px;flex-wrap:wrap')}>
          <button type="button" onClick={() => cambiarZoom(-1)} disabled={ocupado || zoomActual <= 3} aria-label="Alejar"
            style={sx('width:34px;height:34px;display:grid;place-items:center;background:transparent;border:1px solid var(--line);border-radius:var(--r-md);color:var(--muted);font-size:18px;cursor:pointer')}>−</button>
          <button type="button" onClick={() => cambiarZoom(1)} disabled={ocupado || zoomActual >= 18} aria-label="Acercar"
            style={sx('width:34px;height:34px;display:grid;place-items:center;background:transparent;border:1px solid var(--line);border-radius:var(--r-md);color:var(--muted);font-size:18px;cursor:pointer')}>+</button>

          {encuadrado && (
            <button type="button" onClick={volverAuto} disabled={ocupado}
              style={sx('background:transparent;border:1px solid var(--line);border-radius:var(--r-pill);padding:6px 13px;font-size:var(--fs-2xs);font-weight:600;color:var(--muted);cursor:pointer')}>
              Encuadre automático
            </button>
          )}

          <button type="button" onClick={descargar} disabled={ocupado}
            style={sx('background:transparent;border:1px solid var(--line);border-radius:var(--r-pill);padding:6px 13px;font-size:var(--fs-2xs);font-weight:600;color:var(--muted);cursor:pointer')}>
            Descargar la imagen
          </button>
        </div>

        <div className="lu-no-print" style={sx('margin-top:6px;font-size:var(--fs-2xs);color:var(--faint);line-height:1.5')}>
          Arrastrá el mapa para moverlo. El encuadre que dejes es el que sale en el PDF.
        </div>
      </div>
    )
  }

  return (
    <div className="lu-no-print">
      <button
        type="button"
        onClick={() => componer()}
        disabled={estado === 'generando'}
        className="lu-press"
        style={sx('width:100%;min-height:42px;background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-md);color:var(--text);font-size:var(--fs-sm);font-weight:600;cursor:pointer')}
      >
        {estado === 'generando' ? 'Componiendo el mapa…' : 'Generar la imagen del recorrido'}
      </button>
      {estado === 'error' && (
        <div style={sx('margin-top:7px;font-size:var(--fs-2xs);color:var(--danger)')}>
          No se pudieron descargar los mosaicos del mapa. Probá de nuevo con mejor señal.
        </div>
      )}
      <div style={sx('margin-top:7px;font-size:var(--fs-2xs);color:var(--faint);line-height:1.5')}>
        Se arma con el recorrido y las paradas numeradas, y queda incluida en el PDF. Después vas a
        poder acercarla y moverla antes de imprimir.
      </div>
    </div>
  )
}
