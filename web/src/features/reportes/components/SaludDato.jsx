import { sx } from '../../../lib/sx'
import { fmtDuracion } from '../../../lib/format'

/**
 * Cuánto se puede confiar en los números de arriba.
 *
 * 🩸 ES LA MITAD DEL INFORME, no un apéndice técnico. Un "0 km" no distingue *no salió* de *el
 * teléfono estuvo muerto*, y un día con 40 minutos sin reportar tiene los mismos km que uno
 * completo si nadie dice que faltaron 40 minutos. Sin este bloque, cada número de la pantalla es
 * una afirmación sin margen de error, y la primera vez que uno de ellos esté mal —porque alguna vez
 * va a estar mal— el informe entero deja de usarse.
 *
 * Las cuatro cifras salen de decisiones que ya tomó `limpiarTrazo`, no de un segundo análisis:
 *  · puntos       — los que sobrevivieron a la limpieza y sostienen km y paradas
 *  · descartados  — saltos imposibles (el vendedor de 524,8 km que fueron 17,9)
 *  · triangulados — ubicación por antenas/WiFi: valen para "por acá anduvo" y nada más (regla 40)
 *  · sin reportar — la suma de los huecos de más de 4 minutos
 */
export default function SaludDato({ calidad, horario }) {
  const sinSenal = calidad.sinSenalMs > 0
  const hayDescartes = calidad.descartados > 0

  return (
    <div>
      <div style={sx('display:grid;grid-template-columns:repeat(4,1fr);gap:8px')}>
        <Celda etiqueta="Puntos" valor={calidad.puntos.toLocaleString('es-AR')} />
        <Celda etiqueta="Descartados" valor={String(calidad.descartados)} alerta={hayDescartes} />
        <Celda etiqueta="Triangulados" valor={String(calidad.triangulados)} />
        <Celda
          etiqueta="Sin reportar"
          valor={sinSenal ? fmtDuracion(calidad.sinSenalMs) : '—'}
          alerta={sinSenal}
        />
      </div>

      {horario && horario.retrasoMin != null && (
        <div style={{
          ...sx('margin-top:9px;font-size:var(--fs-xs);display:flex;align-items:baseline;gap:6px'),
          color: horario.retrasoMin >= 15 ? 'var(--danger)' : 'var(--muted)',
        }}>
          <span style={sx('font-family:var(--font-mono);font-weight:700')}>
            {horario.retrasoMin > 0 ? `+${horario.retrasoMin} min` : `${horario.retrasoMin} min`}
          </span>
          <span>
            {horario.retrasoMin > 0 ? 'después del horario asignado' : 'respecto del horario asignado'}
            {' ('}{hhmm(horario.programadoMin)}{')'}
          </span>
        </div>
      )}

      {calidad.huecos.length > 0 && (
        <div style={sx('margin-top:8px;font-size:var(--fs-2xs);color:var(--faint);line-height:1.5')}>
          {/* El detalle de los huecos importa: 40 minutos en un solo corte (se quedó sin señal en
              el campo) no es lo mismo que 40 repartidos en veinte cortes (el teléfono lo está
              matando el sistema), y los dos suman igual. */}
          {calidad.huecos.length} corte{calidad.huecos.length > 1 ? 's' : ''} de señal · el más largo,
          {' '}{fmtDuracion(Math.max(...calidad.huecos.map((h) => h.ms)))}
        </div>
      )}
    </div>
  )
}

function hhmm(min) {
  if (min == null) return '—'
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0')
}

function Celda({ etiqueta, valor, alerta }) {
  return (
    <div style={sx('text-align:center')}>
      <div style={{
        ...sx('font-family:var(--font-mono);font-size:var(--fs-md);font-weight:600'),
        color: alerta ? 'var(--danger)' : 'var(--deep)',
      }}>{valor}</div>
      <div style={sx('font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);margin-top:2px')}>{etiqueta}</div>
    </div>
  )
}
