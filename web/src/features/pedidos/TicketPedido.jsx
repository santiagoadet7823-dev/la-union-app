import { useEffect } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import Overlay from '../../components/Overlay'
import { imprimirNodo, montarImpresion } from '../../services/report/imprimir'

/**
 * EL COMPROBANTE DEL PEDIDO.
 *
 * 🩸 No existía ninguno (19/08/2026). Lo único imprimible en toda la app era el informe de jornada
 * (GPS), y el pedido se cerraba con un toast que decía el total y nada más — ni al comerciante le
 * quedaba constancia, ni al vendedor.
 *
 * Reusa `services/report/imprimir.js`: el PDF es LO QUE SE VE, vía `window.print()` en web y vía el
 * plugin nativo `Impresion` en la APK. Nada de `jsPDF` (el porqué largo está en ese módulo).
 *
 * 🔴 LO QUE NO VA EN EL TICKET, Y ES UNA REGLA, NO UN OLVIDO:
 *
 *  · `nivel_rentabilidad`, `costo_real` y `margen`. Es la misma frontera de privacidad que
 *    `snapshotCatalogo` de la vidriera: **este papel lo lee el comerciante**. Por eso el ticket se
 *    arma campo por campo a partir de las líneas, sin spread de ningún objeto de producto — un
 *    spread arrastraría cualquier columna que el catálogo gane en el futuro.
 *  · La **intención de compra**. Que el cliente sacó tres cosas del pedido es lectura interna del
 *    vendedor y de los reportes; imprimírsela al comerciante sería otra cosa completamente.
 *
 * ⚠️ LA DISTANCIA SE MUESTRA CON SUS SALVEDADES. `distancia_m` puede ser `null` por dos motivos
 * distintos y ninguno es "cero metros": que el comercio no tenga ubicación registrada (hoy 1.401 de
 * 2.014), o que se la haya cargado en esta misma visita, en cuyo caso daría ~0 por construcción y no
 * probaría nada. Los dos casos se dicen con palabras.
 *
 * props: { pedido, comercio, vendedor, lineas, onCerrar }
 */
export default function TicketPedido({ pedido, comercio, vendedor, lineas = [], onCerrar }) {
  // Engancha `beforeprint` mientras el ticket está en pantalla: cubre el Ctrl+P además del botón.
  useEffect(() => montarImpresion('lu-ticket'), [])

  const anulado = pedido?.estado === 'Anulado'
  const total = lineas.reduce((a, l) => a + l.cantidad * l.precio_unitario, 0)
  const kg = lineas.reduce((a, l) => a + l.cantidad * (l.peso_kg || 0), 0)
  const unidades = lineas.reduce((a, l) => a + l.cantidad, 0)

  const fecha = pedido?.created_at ? new Date(pedido.created_at) : null
  const dl = (v) => (v == null ? null : Number(v).toFixed(5))

  return (
    <Overlay
      open
      onClose={onCerrar}
      variant="sheet"
      alto="medio"
      title={`Pedido ${pedido?.numero ? '#' + pedido.numero : ''}`}
      subtitle={comercio?.name || ''}
      footer={
        <button
          onClick={() => imprimirNodo('lu-ticket', `Pedido ${pedido?.numero || ''}`)}
          className="lu-press lu-no-print"
          style={sx('width:100%;min-height:50px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:14.5px;cursor:pointer;border:none')}
        >
          Imprimir o guardar como PDF
        </button>
      }
    >
      {/* `lu-imprimible` es lo que la hoja @media print deja visible; el resto de la página se
          oculta. El id lo usa `imprimir.js` para colgarlo de <body> mientras dura la impresión. */}
      <div id="lu-ticket" className="lu-imprimible" style={sx('font-size:12.5px;line-height:1.55;color:var(--text)')}>
        {anulado && (
          <div style={sx('margin-bottom:12px;padding:8px 11px;border:1px solid var(--danger);border-radius:10px;color:var(--danger);font-weight:700;letter-spacing:.06em;font-size:12px')}>
            PEDIDO ANULADO{pedido?.motivo_anulacion ? ` · ${pedido.motivo_anulacion}` : ''}
          </div>
        )}

        <div style={sx('display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-bottom:9px;border-bottom:1px solid var(--line)')}>
          <div>
            <div style={sx('font-family:var(--font-display);font-weight:700;font-size:15px')}>{comercio?.name || 'Comercio'}</div>
            <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>
              {[comercio?.codigo, comercio?.loc].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div style={sx('text-align:right;font-family:var(--font-mono);font-size:11px;color:var(--muted)')}>
            <div style={sx('font-weight:700;color:var(--text);font-size:13px')}>#{pedido?.numero || '—'}</div>
            {fecha && <div>{fecha.toLocaleDateString('es-AR')} · {fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</div>}
          </div>
        </div>

        <div style={sx('padding:9px 0;border-bottom:1px solid var(--line);font-size:11.5px;color:var(--muted)')}>
          Atendió: <b style={sx('color:var(--text)')}>{vendedor?.nombre || '—'}</b>
          {pedido?.origen === 'vidriera' ? ' · pedido tomado con la tablet' : ''}
        </div>

        {/* Las líneas. `descripcion` viene COPIADA del pedido, no del catálogo actual: un ticket de
            hace seis meses tiene que seguir diciendo lo que se vendió aunque el producto se haya
            renombrado o borrado. */}
        <table style={sx('width:100%;border-collapse:collapse;margin-top:6px')}>
          <thead>
            <tr style={sx('font-size:10px;letter-spacing:.06em;color:var(--faint);text-align:left')}>
              <th style={sx('padding:6px 0;font-weight:600')}>PRODUCTO</th>
              <th style={sx('padding:6px 0;font-weight:600;text-align:right;white-space:nowrap')}>CANT.</th>
              <th style={sx('padding:6px 0;font-weight:600;text-align:right;white-space:nowrap')}>UNIT.</th>
              <th style={sx('padding:6px 0;font-weight:600;text-align:right;white-space:nowrap')}>SUBTOTAL</th>
            </tr>
          </thead>
          <tbody style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
            {lineas.map((l) => (
              <tr key={l.id} style={sx('border-top:1px solid var(--line)')}>
                <td style={sx('padding:7px 8px 7px 0;font-family:var(--font-body);font-size:12px')}>{l.descripcion}</td>
                <td style={sx('padding:7px 0;text-align:right')}>{l.cantidad}</td>
                <td style={sx('padding:7px 0;text-align:right')}>{fmtPesos(l.precio_unitario)}</td>
                <td style={sx('padding:7px 0;text-align:right;font-weight:600')}>{fmtPesos(l.cantidad * l.precio_unitario)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={sx('margin-top:10px;padding-top:9px;border-top:2px solid var(--line2);display:flex;justify-content:space-between;align-items:baseline;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
          <span style={sx('font-size:11.5px;color:var(--muted)')}>
            {unidades} u{kg > 0 ? ` · ${kg.toFixed(1).replace('.', ',')} kg` : ''}
          </span>
          <span style={sx('font-size:19px;font-weight:700')}>{fmtPesos(total)}</span>
        </div>

        {/* DÓNDE SE TOMÓ. Es lo que distingue una visita real de una llamada desde la casa, y por
            eso figura en el comprobante y no solo en un reporte interno. */}
        <div style={sx('margin-top:14px;padding-top:10px;border-top:1px dashed var(--line2);font-size:10.5px;color:var(--faint);line-height:1.6')}>
          <div style={sx('font-weight:700;letter-spacing:.06em;margin-bottom:3px')}>DÓNDE SE TOMÓ</div>
          {pedido?.lat != null ? (
            <div style={sx('font-family:var(--font-mono)')}>{dl(pedido.lat)}, {dl(pedido.lng)}</div>
          ) : (
            <div>Sin señal de GPS al confirmar el pedido.</div>
          )}
          {pedido?.distancia_m != null ? (
            <div>
              A <b style={sx('color:var(--text);font-family:var(--font-mono)')}>{Math.round(pedido.distancia_m)} m</b> de
              la ubicación registrada del comercio.
            </div>
          ) : (
            <div>
              {comercio?.lat == null
                ? 'El comercio todavía no tiene ubicación registrada, así que no hay distancia que medir.'
                : 'La ubicación del comercio se registró en esta misma visita: la distancia daría cero por construcción y no se informa.'}
            </div>
          )}
        </div>

        <div className="lu-no-print" style={sx('margin-top:12px;font-size:10.5px;color:var(--faint);line-height:1.5')}>
          Este comprobante no es una factura.
        </div>
      </div>
    </Overlay>
  )
}
