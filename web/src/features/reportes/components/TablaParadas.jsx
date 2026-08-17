import { sx } from '../../../lib/sx'
import { fmtDuracion, fmtHora } from '../../../lib/format'
import { BATERIA_BAJA } from '../informe'

/**
 * Las paradas del día, en orden y con el MISMO número que el cartel del mapa.
 *
 * Ese número es la razón de ser de la tabla: sin él, mirar el mapa y leer la lista eran dos
 * ejercicios distintos que había que cruzar a ojo por horario. Con él, "la 7" es la 7 en los tres
 * lugares (mapa, línea de tiempo y esta tabla).
 *
 * La columna de batería está acá y no solo en la curva porque una parada larga con batería cayendo
 * es una cosa distinta de una parada larga con el teléfono cargando, y esa diferencia se lee
 * fila por fila.
 */
const th = 'text-align:left;font-size:var(--fs-2xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);padding:0 8px 6px 0;white-space:nowrap'
const td = 'font-size:var(--fs-xs);padding:7px 8px 7px 0;border-top:1px solid var(--line);vertical-align:top'

export default function TablaParadas({ usuario, onParada, paradaSel = null }) {
  if (!usuario.paradas.length) {
    return (
      <div style={sx('font-size:var(--fs-xs);color:var(--faint);padding:8px 0')}>
        No se detectó ninguna parada de 3 minutos o más.
      </div>
    )
  }

  return (
    // El scroll horizontal vive acá adentro: en un teléfono la tabla no entra y el que tiene que
    // desplazarse es ella, no la pantalla.
    <div style={sx('overflow-x:auto;-webkit-overflow-scrolling:touch')}>
      <table style={sx('width:100%;border-collapse:collapse;min-width:340px')}>
        <thead>
          <tr>
            <th style={sx(th)}>#</th>
            <th style={sx(th)}>Horario</th>
            <th style={sx(th)}>Duró</th>
            <th style={sx(th + ';width:100%')}>Dónde</th>
            <th style={sx(th + ';text-align:right')}>Bat.</th>
          </tr>
        </thead>
        <tbody>
          {usuario.paradas.map((p) => {
            const sel = paradaSel === p.orden
            const baja = p.bateria != null && p.bateria <= BATERIA_BAJA
            return (
              <tr
                key={p.orden}
                onClick={onParada ? () => onParada(p.orden) : undefined}
                style={{
                  ...sx(onParada ? 'cursor:pointer' : ''),
                  background: sel ? 'var(--surface2)' : undefined,
                }}
                title={onParada ? 'Ver esta parada en el mapa' : undefined}
              >
                <td style={sx(td)}>
                  <span style={{
                    ...sx('display:grid;place-items:center;width:18px;height:18px;border-radius:99px;font-family:var(--font-mono);font-size:9px;font-weight:700'),
                    background: sel ? usuario.color : 'var(--surface2)',
                    color: sel ? '#fff' : 'var(--muted)',
                    boxShadow: sel ? 'none' : 'inset 0 0 0 1px var(--line)',
                  }}>{p.orden}</span>
                </td>
                <td style={sx(td + ';font-family:var(--font-mono);white-space:nowrap')}>
                  {fmtHora(p.desde)}–{fmtHora(p.hasta)}
                </td>
                <td style={sx(td + ';font-family:var(--font-mono);white-space:nowrap;font-weight:600')}>
                  {fmtDuracion(p.duracionMs)}
                </td>
                <td style={sx(td)}>
                  {/* Sin comercio geolocalizado cerca no se inventa nada ni se muestran las
                      coordenadas crudas: un "−24,7891" no le sirve a nadie que lea un informe. */}
                  {p.comercio || <span style={sx('color:var(--faint)')}>—</span>}
                </td>
                <td style={{
                  ...sx(td + ';font-family:var(--font-mono);text-align:right;white-space:nowrap'),
                  color: baja ? 'var(--danger)' : undefined,
                  fontWeight: baja ? 700 : undefined,
                }}>
                  {/* `!= null`: 0 % es un valor válido y el chequeo por falsy lo borraría justo
                      cuando más importa (mismo gotcha que `etiquetaDwell`). */}
                  {p.bateria != null ? p.bateria + '%' : <span style={sx('color:var(--faint)')}>—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
