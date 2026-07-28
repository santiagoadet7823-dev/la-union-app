import { sx } from '../../../lib/sx'
import { colorPorId } from '../../../lib/colors'
import { initials, fmtHora } from '../../../lib/format'
import HaceSegundos from '../../../components/HaceSegundos'

/**
 * Una persona del equipo en la lista del dueño.
 *
 * ES UNA BARRA DE PROPORCIÓN, NO UN RANKING NUMERADO. Un "1.º / 9.º" convierte una diferencia de
 * recorrido en un juicio de valor que la app no tiene con qué sostener: más kilómetros no es mejor
 * vendedor (puede ser una zona más dispersa, o un día de reparto largo). La barra deja ver la
 * diferencia sin declarar un perdedor.
 *
 * Ningún color de alarma sobre una persona: el rojo se reserva para el estado del dispositivo.
 */
export default function FilaEquipo({ persona, maxKm, onAbrir }) {
  const color = colorPorId(persona.id)
  const pct = maxKm > 0 ? Math.max(3, Math.round((persona.km / maxKm) * 100)) : 0

  return (
    <div
      onClick={onAbrir}
      className="lu-press"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir?.() } }}
      style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:11px 13px;box-shadow:var(--shadow);cursor:pointer;min-height:44px;box-sizing:border-box')}
    >
      <div style={sx('display:flex;align-items:center;gap:11px')}>
        <div style={{
          ...sx('flex:none;width:36px;height:36px;border-radius:var(--r-md);display:grid;place-items:center;font-family:var(--font-display);font-size:var(--fs-sm);font-weight:700'),
          background: 'var(--primary-tint)',
          color: 'var(--deep)',
        }}>
          {initials(persona.nombre)}
        </div>

        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('font-size:var(--fs-md);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
            {persona.nombre}
          </div>
          <div style={sx('font-size:var(--fs-xs);color:var(--muted);margin-top:1px;display:flex;align-items:center;gap:5px')}>
            {persona.enCalle
              // HaceSegundos encapsula su propio intervalo en el nodo de texto. Subir ese tick al
              // padre re-renderizaría la pantalla entera cada segundo — el bug que documenta el
              // propio componente. Solo se usa cuando la señal es FRESCA: cuenta en segundos, así
              // que para una última señal de hace horas escribiría "hace 38000s".
              ? <><span style={{ ...sx('width:6px;height:6px;border-radius:var(--r-pill);flex:none'), background: 'var(--success)', animation: 'lu-blink 1.6s infinite' }} />en la calle · <HaceSegundos ts={new Date(persona.ultimoTs).getTime()} /></>
              : persona.ultimoTs
                ? <>última señal {fmtHora(persona.ultimoTs)}</>
                : <span style={sx('color:var(--faint)')}>{persona.rol}</span>}
          </div>
        </div>

        <div style={sx('flex:none;text-align:right')}>
          <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--fs-lg);font-weight:700;line-height:1.1')}>
            {persona.km.toFixed(1)}
            <span style={sx('font-size:var(--fs-2xs);color:var(--faint);margin-left:2px')}>km</span>
          </div>
          <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint)')}>
            {persona.paradas} parada{persona.paradas === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div style={sx('margin-top:9px;height:5px;border-radius:var(--r-pill);background:var(--bar);overflow:hidden')}>
        <div style={{ ...sx('height:100%;border-radius:var(--r-pill)'), width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}
