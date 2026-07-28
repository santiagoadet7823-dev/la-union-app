import { useMemo, useRef } from 'react'
import Overlay from '../../../components/Overlay'
import LeafletMap from '../../../components/LeafletMap'
import { sx } from '../../../lib/sx'
import { colorPorId } from '../../../lib/colors'
import { initials, fmtHora, fmtDuracion } from '../../../lib/format'
import { serieParaBarras } from '../../../lib/comparar'
import { detectarParadas } from '../../../services/geolocation/dwell'

/**
 * Detalle de una persona. Tiene DOS variantes y la segunda es la importante.
 *
 * CON DATOS: su día (km, paradas, tiempo en ruta), las horas en que se movió, su recorrido y dónde
 * estuvo parado — con un cierre que aclara qué NO dice ese dato.
 *
 * SIN DATOS: no es un vacío ni un error. Es una pantalla propia que dice exactamente lo que se
 * sabe ("no tenemos datos suyos hoy") y lo que no ("no sabemos si trabajó"), más el diagnóstico
 * del teléfono para que la conversación la tenga una persona con información, no con una sospecha.
 */

// 5 minutos: el mismo umbral que usa la RPC `metricas_actividad` para contar paradas. `dwell.js`
// detecta desde 3 min (sirve para los carteles del mapa), así que acá se FILTRA — si no, el dueño
// vería "8 paradas" arriba y 11 renglones en la lista de abajo, y la pantalla se contradiría.
const PARADA_MIN_MS = 300000

export default function SheetPersona({ open, persona, puntos, serieKm, hasta, tema, onClose }) {
  // Gotcha documentado de Overlay: el sheet sigue montado durante la animación de salida, pero
  // `persona` se vuelve null en el mismo frame en que el padre limpia su estado. Se retiene el
  // último valor para que el cuerpo no reviente mientras se va. Mismo patrón que `mdView`.
  const ref = useRef(persona)
  if (persona) ref.current = persona
  const p = persona || ref.current

  const paradas = useMemo(() => {
    if (!puntos || puntos.length < 2) return []
    return detectarParadas(puntos).filter((d) => d.duracionMs >= PARADA_MIN_MS)
  }, [puntos])

  // Horas del día en las que hubo movimiento. Se arma sobre los puntos crudos: una hora con fixes
  // que además no cae entera dentro de una parada es una hora "en la calle".
  const horas = useMemo(() => {
    const marcadas = new Array(24).fill(false)
    if (!puntos) return marcadas
    for (const pt of puntos) {
      const h = new Date(pt.ts).getHours()
      if (h >= 0 && h < 24) marcadas[h] = true
    }
    return marcadas
  }, [puntos])

  const barras = useMemo(
    () => (p && serieKm ? serieParaBarras(serieKm[p.id] || {}, hasta, 8) : []),
    [p, serieKm, hasta]
  )

  if (!p) return null

  const color = colorPorId(p.id)
  const sinDatos = !p.tieneDatos
  const primeraHora = horas.findIndex(Boolean)
  const ultimaHora = horas.length - 1 - [...horas].reverse().findIndex(Boolean)

  return (
    <Overlay
      open={open}
      onClose={onClose}
      variant="sheet"
      title={p.nombre}
      subtitle={sinDatos ? 'Sin señal del teléfono' : p.enCalle ? 'En la calle ahora' : `Última señal ${p.ultimoTs ? fmtHora(p.ultimoTs) : '—'}`}
      aside={
        <div style={{
          ...sx('width:40px;height:40px;border-radius:var(--r-md);display:grid;place-items:center;font-family:var(--font-display);font-size:var(--fs-md);font-weight:700;flex:none'),
          background: sinDatos ? 'var(--bar)' : 'var(--primary-tint)',
          color: sinDatos ? 'var(--muted)' : 'var(--deep)',
        }}>
          {initials(p.nombre)}
        </div>
      }
    >
      {sinDatos ? (
        <>
          <div style={sx('padding:4px 0 2px')}>
            <div style={sx('font-family:var(--font-display);font-size:var(--fs-lg);font-weight:600;line-height:1.25')}>
              No tenemos datos suyos hoy.
            </div>
            <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.6;margin-top:6px')}>
              Eso es todo lo que sabemos. <b style={sx('color:var(--text)')}>No sabemos si trabajó.</b>
            </div>
          </div>

          <Rotulo>Estado de su teléfono</Rotulo>
          <div style={sx('background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden')}>
            <Diag etiqueta="Último latido recibido" valor={p.ultimoLatidoMs ? fmtHora(p.ultimoLatidoMs) : 'ninguno hoy'} tono={p.ultimoLatidoMs ? 'warning' : 'faint'} />
            <Diag etiqueta="Permiso de ubicación" valor={p.permiso || 'sin dato'} tono={p.permiso === 'always' ? 'success' : 'warning'} />
            <Diag etiqueta="Grabó en 2º plano" valor={p.bgOk ? 'sí' : 'nunca'} tono={p.bgOk ? 'success' : 'warning'} />
            <Diag etiqueta="Versión de la app" valor={p.ota || '—'} tono={p.otaAtrasada ? 'warning' : 'success'} />
            {p.cola > 0 && <Diag etiqueta="Ubicaciones en cola" valor={String(p.cola)} tono="warning" />}
          </div>

          <div style={sx('margin-top:12px;font-size:var(--fs-sm);color:var(--muted);line-height:1.6')}>
            {p.motivo}
          </div>

          <div style={sx('margin-top:14px;padding:13px 15px;border-radius:var(--r-md);background:var(--surface2);border:1px dashed var(--line2);font-size:var(--fs-sm);color:var(--muted);line-height:1.6')}>
            La app <b style={sx('color:var(--text)')}>no puede distinguir un franco de un teléfono descargado</b>, así
            que no lo interpreta: te muestra el diagnóstico y la conversación la tenés vos.
          </div>

          {barras.some((b) => !b.sinDato) && (
            <>
              <Rotulo>Sus últimos 8 días</Rotulo>
              <Barras barras={barras} color={color} />
              <div style={sx('margin-top:8px;font-size:var(--fs-xs);color:var(--faint);line-height:1.5')}>
                Los días anteriores reportó normal. Hoy es la excepción, no el patrón.
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div style={sx('display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px')}>
            <Mini etiqueta="Km" valor={p.km.toFixed(1)} />
            <Mini etiqueta="Paradas" valor={String(p.paradas)} />
            <Mini etiqueta="En ruta" valor={fmtDuracion(p.minutos * 60000)} />
          </div>

          {primeraHora >= 0 && (
            <>
              <Rotulo>Su día, hora por hora</Rotulo>
              <div style={sx('display:flex;align-items:flex-end;gap:3px;height:52px')}>
                {horas.slice(Math.max(0, primeraHora - 1), Math.min(24, ultimaHora + 2)).map((activa, i) => (
                  <div key={i} style={{
                    ...sx('flex:1;border-radius:2px'),
                    height: activa ? '100%' : '22%',
                    background: activa ? color : 'var(--bar)',
                  }} />
                ))}
              </div>
              <div style={sx('display:flex;justify-content:space-between;margin-top:5px;font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint)')}>
                <span>{String(Math.max(0, primeraHora - 1)).padStart(2, '0')}:00</span>
                <span>{String(Math.min(23, ultimaHora + 1)).padStart(2, '0')}:00</span>
              </div>
            </>
          )}

          {puntos && puntos.length > 1 && (
            <>
              <Rotulo>Su recorrido</Rotulo>
              <div style={sx('height:150px;border-radius:var(--r-lg);overflow:hidden;border:1px solid var(--line)')}>
                <LeafletMap
                  theme={tema}
                  trails={[{ points: puntos, color }]}
                  height="100%"
                  interactive={false}
                  basemapControl={false}
                  fit
                />
              </div>
            </>
          )}

          {paradas.length > 0 && (
            <>
              <Rotulo>Dónde estuvo parado</Rotulo>
              <div style={sx('background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden')}>
                {paradas.map((d, i) => (
                  <div key={i} style={sx('display:flex;align-items:center;gap:10px;padding:10px 13px;border-top:1px solid var(--line)')}>
                    <span style={sx('font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--muted);flex:none')}>{fmtHora(d.desde)}</span>
                    <span style={sx('flex:1;min-width:0;font-size:var(--fs-sm);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                      {d.lat.toFixed(4)}, {d.lng.toFixed(4)}
                    </span>
                    <span style={sx('font-family:var(--font-mono);font-size:var(--fs-sm);font-weight:600;flex:none')}>{fmtDuracion(d.duracionMs)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={sx('margin-top:16px;padding:13px 15px;border-radius:var(--r-md);background:var(--surface2);border:1px dashed var(--line2)')}>
            <div style={sx('font-size:var(--fs-sm);font-weight:600;margin-bottom:5px')}>Lo que esto no dice</div>
            <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.6')}>
              Sabemos dónde estuvo el teléfono y cuánto tiempo, no qué comercio visitó ni si vendió.
              Una parada larga puede ser una venta grande, un almuerzo o un tránsito pesado.
            </div>
          </div>
        </>
      )}
    </Overlay>
  )
}

const TONOS = { success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', faint: 'var(--faint)' }

function Rotulo({ children }) {
  return (
    <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-weight:600;margin:18px 0 8px')}>
      {children}
    </div>
  )
}

function Mini({ etiqueta, valor }) {
  return (
    <div style={sx('background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-md);padding:11px 12px')}>
      <div style={sx('font-size:var(--fs-2xs);color:var(--muted)')}>{etiqueta}</div>
      <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--fs-lg);font-weight:700;margin-top:3px')}>{valor}</div>
    </div>
  )
}

function Diag({ etiqueta, valor, tono }) {
  return (
    <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;border-top:1px solid var(--line)')}>
      <span style={sx('font-size:var(--fs-sm);color:var(--muted)')}>{etiqueta}</span>
      <span style={{ ...sx('font-family:var(--font-mono);font-size:var(--fs-sm);font-weight:600;text-align:right'), color: TONOS[tono] || 'var(--text)' }}>{valor}</span>
    </div>
  )
}

function Barras({ barras, color }) {
  return (
    <div style={sx('display:flex;align-items:flex-end;gap:4px;height:44px')}>
      {barras.map((b) => (
        <div key={b.dia} title={b.dia} style={{
          ...sx('flex:1;border-radius:2px;min-height:2px'),
          height: b.sinDato ? '100%' : `${b.alturaPct}%`,
          background: b.sinDato ? 'var(--bar)' : b.esUltimo ? 'var(--bar)' : color,
          opacity: b.sinDato ? 0.55 : 1,
        }} />
      ))}
    </div>
  )
}
