import { useState } from 'react'
import { sx } from '../../../lib/sx'
import { exportarRutaPng } from '../../../services/report/rutaPng'
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
 */
export default function MapaRecorrido({ usuario, puntos }) {
  const [estado, setEstado] = useState('inicial')  // inicial | generando | listo | error
  const [imagen, setImagen] = useState(null)

  const hayRecorrido = (puntos?.length || 0) >= 2

  async function generar() {
    setEstado('generando')
    try {
      const dataUrl = await exportarRutaPng({
        // Simplificado para dibujar, igual que el mapa: una jornada son miles de puntos y sobre un
        // canvas de 960 px el trazo sale idéntico con una fracción de ellos.
        coords: simplificarTrazo(puntos),
        titulo: usuario.nombre || usuario.rol || 'Recorrido',
        subtitulo: `${usuario.inicioTs ? fmtHora(usuario.inicioTs) : '—'} – ${usuario.finTs ? fmtHora(usuario.finTs) : '—'}`,
        stats: [
          { label: 'Distancia', value: usuario.km.toFixed(1) + ' km' },
          { label: 'Paradas', value: String(usuario.paradasN) },
          { label: 'Movimiento', value: fmtDuracion(usuario.movimientoMs) },
        ],
        color: usuario.color,
        paradas: usuario.paradas.map((p) => ({ lat: p.lat, lng: p.lng, orden: p.orden })),
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
    await exportarRutaPng({
      coords: simplificarTrazo(puntos),
      titulo: usuario.nombre || usuario.rol || 'Recorrido',
      subtitulo: `${usuario.inicioTs ? fmtHora(usuario.inicioTs) : '—'} – ${usuario.finTs ? fmtHora(usuario.finTs) : '—'}`,
      stats: [
        { label: 'Distancia', value: usuario.km.toFixed(1) + ' km' },
        { label: 'Paradas', value: String(usuario.paradasN) },
        { label: 'Movimiento', value: fmtDuracion(usuario.movimientoMs) },
      ],
      color: usuario.color,
      paradas: usuario.paradas.map((p) => ({ lat: p.lat, lng: p.lng, orden: p.orden })),
      filename: `recorrido-${(usuario.nombre || usuario.id).replace(/\s+/g, '-').toLowerCase()}.png`,
    })
  }

  if (!hayRecorrido) {
    return <div style={sx('font-size:var(--fs-xs);color:var(--faint)')}>Sin recorrido suficiente para componer una imagen.</div>
  }

  if (estado === 'listo') {
    return (
      <div>
        <img src={imagen} alt="Recorrido del día" style={sx('width:100%;height:auto;display:block;border-radius:var(--r-md);border:1px solid var(--line)')} />
        <button
          type="button"
          className="lu-no-print"
          onClick={descargar}
          style={sx('margin-top:9px;background:transparent;border:1px solid var(--line);border-radius:var(--r-pill);padding:6px 13px;font-size:var(--fs-2xs);font-weight:600;color:var(--muted);cursor:pointer')}
        >
          Descargar la imagen
        </button>
      </div>
    )
  }

  return (
    <div className="lu-no-print">
      <button
        type="button"
        onClick={generar}
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
        Se arma con el recorrido y las paradas numeradas, y queda incluida en el PDF.
      </div>
    </div>
  )
}
