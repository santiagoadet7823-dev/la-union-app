import { sx } from '../../../lib/sx'
import { fmtPesos } from '../../../lib/format'

/**
 * PEDIDOS DE LA JORNADA, dentro del informe.
 *
 * 🩸 Hasta el 19/08/2026 Reportes era 100 % GPS: kilómetros, paradas, batería y calidad del dato.
 * De lo comercial no había nada, y no por olvido — **los pedidos no se guardaban en ningún lado**
 * (ver `db/43`). Esta sección existe recién ahora porque recién ahora hay qué mostrar.
 *
 * QUÉ MUESTRA, Y POR QUÉ ESO:
 *  · Por persona: cuántos pedidos, cuánto vendió y el ticket promedio.
 *  · **A qué distancia del comercio se tomaron.** Es la pregunta que motivó todo esto: distinguir
 *    al vendedor que visita del que llama por teléfono desde la casa.
 *  · **Lo que se cae del pedido**: productos que entraron al carrito y salieron. Es lo único que
 *    dice qué NO se vendió, y el recomendador —que mira lo vendido— no lo puede ver.
 *
 * ⚠️ LA DISTANCIA NO ES UN VEREDICTO Y LA PANTALLA LO DICE. `distancia_m` es `null` para la mayoría
 * de los comercios (1.401 de 2.014 no tienen ubicación registrada), y donde hay número el GPS de
 * estos equipos miente hasta 30 m en condiciones normales. Se informa el dato; no se marca a nadie.
 */

// Umbral de "lejos" solo para CONTAR, no para acusar. 150 m es holgado a propósito: por debajo de
// eso el ruido del GPS del parque daría falsos positivos (ver `gpsConfig.js` y la memoria del
// proyecto sobre los dos techos de precisión).
const LEJOS_M = 150

export default function PedidosDelDia({ pedidos = [], nombres = {}, productos = [], cargando, error }) {
  if (error) {
    return (
      <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:13px;font-size:var(--fs-xs);color:var(--muted)')}>
        No se pudieron leer los pedidos: {error}
      </div>
    )
  }
  if (cargando) {
    return (
      <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:13px;font-size:var(--fs-xs);color:var(--faint)')}>
        Cargando pedidos…
      </div>
    )
  }

  const vivos = pedidos.filter((p) => p.estado !== 'Anulado')
  const anulados = pedidos.length - vivos.length

  // Por persona
  const porUsuario = new Map()
  for (const p of vivos) {
    const k = p.id_vendedor || '—'
    const a = porUsuario.get(k) || { n: 0, monto: 0, conDist: 0, lejos: 0 }
    a.n += 1
    a.monto += Number(p.monto_total || 0)
    if (p.distancia_m != null) { a.conDist += 1; if (p.distancia_m > LEJOS_M) a.lejos += 1 }
    porUsuario.set(k, a)
  }
  const filas = [...porUsuario.entries()]
    .map(([id, v]) => ({ id, ...v, promedio: v.n ? v.monto / v.n : 0 }))
    .sort((a, b) => b.monto - a.monto)

  const totalMonto = vivos.reduce((a, p) => a + Number(p.monto_total || 0), 0)
  const conDist = vivos.filter((p) => p.distancia_m != null).length
  const sinUbicacion = vivos.length - conDist

  // "Se cae del pedido": lo que entró al carrito y salió, agregado por producto.
  const caidas = new Map()
  for (const p of pedidos) {
    for (const it of (Array.isArray(p.intencion) ? p.intencion : [])) {
      if (it.origen !== 'sacado') continue
      const a = caidas.get(it.id_producto) || 0
      caidas.set(it.id_producto, a + 1)
    }
  }
  const topCaidas = [...caidas.entries()]
    .map(([id, veces]) => ({ veces, nombre: productos.find((x) => x.id === id)?.name || 'Producto dado de baja' }))
    .sort((a, b) => b.veces - a.veces)
    .slice(0, 5)

  if (!pedidos.length) {
    return (
      <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:13px;font-size:var(--fs-xs);color:var(--faint);line-height:1.55')}>
        <b style={sx('color:var(--muted)')}>Sin pedidos registrados en esta fecha.</b><br />
        Los pedidos se empezaron a guardar el 19/08/2026: antes de esa fecha la app los tomaba pero
        no los persistía, así que no hay historial para mostrar.
      </div>
    )
  }

  return (
    <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:13px')}>
      <div style={sx('font-size:var(--fs-2xs);font-weight:600;letter-spacing:.07em;color:var(--muted);margin-bottom:10px')}>PEDIDOS</div>

      <div style={sx('display:flex;gap:18px;flex-wrap:wrap;margin-bottom:12px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
        <div>
          <div style={sx('font-size:var(--fs-2xs);color:var(--faint)')}>Pedidos</div>
          <div style={sx('font-size:19px;font-weight:700')}>{vivos.length}</div>
        </div>
        <div>
          <div style={sx('font-size:var(--fs-2xs);color:var(--faint)')}>Vendido</div>
          <div style={sx('font-size:19px;font-weight:700')}>{fmtPesos(totalMonto)}</div>
        </div>
        <div>
          <div style={sx('font-size:var(--fs-2xs);color:var(--faint)')}>Ticket promedio</div>
          <div style={sx('font-size:19px;font-weight:700')}>{fmtPesos(vivos.length ? totalMonto / vivos.length : 0)}</div>
        </div>
        {anulados > 0 && (
          <div>
            <div style={sx('font-size:var(--fs-2xs);color:var(--faint)')}>Anulados</div>
            <div style={sx('font-size:19px;font-weight:700;color:var(--danger)')}>{anulados}</div>
          </div>
        )}
      </div>

      <table style={sx('width:100%;border-collapse:collapse')}>
        <thead>
          <tr style={sx('font-size:var(--fs-2xs);letter-spacing:.06em;color:var(--faint);text-align:left')}>
            <th style={sx('padding:6px 0;font-weight:600')}>PERSONA</th>
            <th style={sx('padding:6px 0;font-weight:600;text-align:right')}>PEDIDOS</th>
            <th style={sx('padding:6px 0;font-weight:600;text-align:right')}>MONTO</th>
            <th style={sx('padding:6px 0;font-weight:600;text-align:right')}>PROMEDIO</th>
            <th style={sx('padding:6px 0;font-weight:600;text-align:right')}>+{LEJOS_M} m</th>
          </tr>
        </thead>
        <tbody style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--fs-xs)')}>
          {filas.map((f) => (
            <tr key={f.id} style={sx('border-top:1px solid var(--line)')}>
              <td style={sx('padding:7px 8px 7px 0;font-family:var(--font-body);font-size:var(--fs-sm)')}>{nombres[f.id] || '—'}</td>
              <td style={sx('padding:7px 0;text-align:right')}>{f.n}</td>
              <td style={sx('padding:7px 0;text-align:right')}>{fmtPesos(f.monto)}</td>
              <td style={sx('padding:7px 0;text-align:right')}>{fmtPesos(f.promedio)}</td>
              {/* Sin ubicación de referencia se escribe "—", nunca 0: son cosas distintas. */}
              <td style={sx('padding:7px 0;text-align:right')}>
                {f.conDist ? `${f.lejos}/${f.conDist}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {topCaidas.length > 0 && (
        <div style={sx('margin-top:13px;padding-top:11px;border-top:1px dashed var(--line2)')}>
          <div style={sx('font-size:var(--fs-2xs);font-weight:600;letter-spacing:.07em;color:var(--muted);margin-bottom:6px')}>SE CAE DEL PEDIDO</div>
          <div style={sx('font-size:var(--fs-2xs);color:var(--faint);line-height:1.5;margin-bottom:7px')}>
            Entraron al carrito y salieron antes de confirmar.
          </div>
          {topCaidas.map((c) => (
            <div key={c.nombre} style={sx('display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-size:var(--fs-xs)')}>
              <span style={sx('flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{c.nombre}</span>
              <span style={sx('flex:none;font-family:var(--font-mono);color:var(--warning);font-weight:600')}>{c.veces}×</span>
            </div>
          ))}
        </div>
      )}

      <div style={sx('margin-top:11px;font-size:var(--fs-2xs);color:var(--faint);line-height:1.55')}>
        La columna “+{LEJOS_M} m” cuenta los pedidos tomados a más de esa distancia de la ubicación
        registrada del comercio, sobre los que tienen con qué compararse.
        {sinUbicacion > 0 && (
          <> <b>{sinUbicacion}</b> de {vivos.length} no tienen referencia: el comercio no está
          ubicado, o se lo ubicó en esa misma visita —y ahí la distancia daría cero por construcción
          y no probaría nada—.</>
        )} El GPS de estos equipos tiene un error de hasta 30 m, así que el número informa; no marca
        a nadie.
      </div>
    </div>
  )
}
