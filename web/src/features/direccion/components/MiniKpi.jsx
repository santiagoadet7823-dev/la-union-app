import { sx } from '../../../lib/sx'
import { EYEBROW, FS_MIN } from '../../../components/charts/formato'

/**
 * Número del dashboard con su contexto: paradas, tiempo en movimiento y la cabecera de KPIs de
 * `DashboardEquipo`. Nunca un número solo: abajo va el delta contra lo normal (`lib/comparar.js`,
 * que se calla cuando la base no alcanza) o una nota con la base del cálculo.
 *
 * ANATOMÍA v3 (01/10/2026, brief estético v2 §2.8 y hojas "Panel de Dirección" 7a/7b y
 * "SupervisionEscritorio"):
 *   - Eyebrow mono en MAYÚSCULAS, tracking único `--track-eyebrow` (.08em), `--faint`, 600. Antes
 *     era texto corrido en `--muted`; ahora se lee igual que el eyebrow de `TarjetaGrafico`, así
 *     las tarjetas con número y las tarjetas con gráfico son una sola familia. Puede partir en dos
 *     líneas: nunca `nowrap` + elipsis.
 *   - Valor mono tabular (`--fs-num-md`, 24 px mientras el token no exista, con tope de 6,4vw:
 *     "$ 4.860.000" tiene que entrar en la mitad de 360 sin partirse), 700, `--lh-num`. Con la
 *     letra del sistema al doble (informe 08: crece el texto, no la caja) parte primero en el
 *     espacio después del "$" y recién después dentro del número: nunca se sale de la tarjeta.
 *   - Delta con flecha + signo + texto ("▲ +8 %"): la dirección la dicen el glifo y el signo, el
 *     color (`--success`/`--danger`) solo acompaña. Sin base, el texto en `--faint` y sin flecha.
 *   - Sin dato: "—" en `--faint` (nunca 0, principio "sin dato ≠ cero").
 *
 * El viejo `KpiCard` (número grande con sparkline) no lo montaba nadie desde que el panel del
 * dueño pasó a `DashboardEquipo` y se borró el 01/10/2026; su anatomía vive acá y en la hoja.
 */
const TONOS = { success: 'var(--success)', danger: 'var(--danger)', faint: 'var(--faint)' }
const FLECHA = { success: '▲', danger: '▼' }


export default function MiniKpi({ label, valor, unidad, comp, nota, style }) {
  const sinDato = valor == null || valor === ''
  // "—" lo pasa quien llama mientras carga: mismo gris, pero sin anunciar "sin dato".
  const gris = sinDato || valor === '—'
  const flecha = comp && FLECHA[comp.tono]
  return (
    <div style={{ ...sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:13px 14px;box-shadow:var(--shadow);min-width:0'), ...style }}>
      <div style={EYEBROW}>{label}</div>
      <div style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:700;line-height:var(--lh-num, 1.1);margin-top:6px;overflow-wrap:break-word'), fontSize: 'min(var(--fs-num-md, 24px), 6.4vw)', color: gris ? 'var(--faint)' : 'var(--text)' }}>
        {sinDato ? <><span aria-hidden="true">—</span><span className="lu-ui-oculto">sin dato</span></> : valor}
        {unidad && !gris && <span style={sx('font-size:var(--fs-sm);font-weight:600;color:var(--faint);margin-left:4px')}>{unidad}</span>}
      </div>
      {(comp || nota) && (
        <div style={{ ...sx('display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 8px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;margin-top:6px;line-height:1.3'), fontSize: FS_MIN }}>
          {comp && (
            <span style={{ fontWeight: 600, color: TONOS[comp.tono] || 'var(--faint)' }}>
              {flecha && <span aria-hidden="true" style={{ marginRight: 4 }}>{flecha}</span>}
              {comp.texto}
            </span>
          )}
          {nota && <span style={{ color: 'var(--faint)' }}>{nota}</span>}
        </div>
      )}
    </div>
  )
}
