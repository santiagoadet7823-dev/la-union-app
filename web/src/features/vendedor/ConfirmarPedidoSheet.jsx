import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import Overlay from '../../components/Overlay'

/**
 * LO ÚLTIMO ANTES DE CONFIRMAR: los datos de cabecera que el ERP necesita para facturar.
 *
 * 🩸 POR QUÉ EXISTE (10/09/2026, db/62). Hasta hoy el pedido **no tenía ninguna pantalla de
 * cabecera**: el vendedor elegía productos y cantidades y `confirmarPedido()` guardaba derecho. Eso
 * alcanzaba mientras el pedido sólo se miraba desde la app, pero el archivo que come el sistema de
 * gestión del cliente pide forma de pago, fecha de entrega y observaciones — y ninguno de los tres
 * se capturaba en ningún lado.
 *
 * 🔑 ES UN PASO MÁS EN EL CAMINO MÁS USADO DE LA APP, ASÍ QUE NO PUEDE PEDIR NADA OBLIGATORIO.
 * El vendedor cierra pedidos parado en el mostrador, muchas veces por día. Los tres campos son
 * OPCIONALES y con defaults que sirven: si toca "Confirmar" sin mirar nada, sale exactamente el
 * mismo pedido que salía antes de que esta hoja existiera.
 *
 * 🔴 LA FORMA DE PAGO NO SE MUESTRA MIENTRAS NO SEPAMOS SUS CÓDIGOS, y eso es deliberado.
 * El campo 7 del archivo del ERP viene `3` en las 300 filas del ejemplo y **es sólo una deducción**
 * que sea la forma de pago: los encabezados del archivo nunca llegaron. Ofrecer un selector con
 * etiquetas inventadas ("Contado", "Cuenta corriente") mapeadas a códigos inventados sería peor que
 * no preguntar: el vendedor cargaría con confianza un dato falso, y el error viajaría a facturación
 * con cara de dato bueno. Mientras `formasPago` venga vacío el selector no aparece y el pedido sale
 * con la forma pactada con el comercio, o con el default de la empresa.
 *
 * El día que el cliente pase su tabla de códigos se cargan en `empresas.export_erp.formas_pago` y
 * el selector aparece solo — sin tocar este archivo y sin sacar un APK.
 *
 * props: { open, onClose, onConfirmar(datos), comercio, cartCount, cartKg, cartTotal, formasPago }
 */

/** `YYYY-MM-DD` en hora LOCAL. `toISOString()` acá adelantaría un día después de las 21:00 (regla 23). */
function isoLocal(d) {
  const p2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

export default function ConfirmarPedidoSheet({
  open, onClose, onConfirmar, comercio,
  cartCount = 0, cartKg = 0, cartTotal = 0, formasPago = [],
}) {
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [formaPago, setFormaPago] = useState('')
  const [enviando, setEnviando] = useState(false)

  const manana = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return isoLocal(d)
  }, [])

  // Cada apertura arranca limpia. Sin esto, las observaciones de un comercio se le pegarían al
  // siguiente — y son 40 pedidos por día con la misma hoja.
  useEffect(() => {
    if (!open) return
    setFechaEntrega('')
    setObservaciones('')
    setFormaPago(comercio?.formaPagoDefault || '')
    setEnviando(false)
  }, [open, comercio?.id])

  function confirmar() {
    if (enviando) return
    // 🔴 Guarda contra el doble toque. El pedido se escribe por la write queue y la hoja se cierra
    // enseguida; sin esto, dos toques rápidos en un teléfono lento son DOS pedidos, con dos números
    // y dos facturas. El botón se desactiva antes de llamar a nada.
    setEnviando(true)
    onConfirmar({
      formaPago: formaPago || null,
      fechaEntrega: fechaEntrega || null,
      observaciones: observaciones || null,
    })
  }

  const chip = (activo) => sx(`padding:8px 14px;border-radius:99px;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid ${activo ? 'var(--primary)' : 'var(--line2)'};background:${activo ? 'var(--primary)' : 'transparent'};color:${activo ? 'var(--on-primary)' : 'var(--muted)'}`)

  return (
    <Overlay
      open={open}
      onClose={onClose}
      variant="sheet"
      title="Confirmar pedido"
      subtitle={comercio?.name || ''}
      footer={(
        <button
          onClick={confirmar}
          disabled={enviando}
          className="lu-press"
          style={sx(`width:100%;min-height:48px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:14px;border:none;cursor:${enviando ? 'default' : 'pointer'};opacity:${enviando ? 0.6 : 1}`)}
        >
          {enviando ? 'Guardando…' : 'Confirmar pedido y finalizar visita'}
        </button>
      )}
    >
      {/* ── Lo que se está por confirmar ───────────────────────────────────────────────────── */}
      <div style={sx('display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;background:var(--surface2);border:1px solid var(--line);border-radius:12px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;margin-bottom:16px')}>
        <div style={sx('font-size:12px;color:var(--muted)')}>
          {cartCount} ítems · {cartKg.toFixed(1).replace('.', ',')} kg
        </div>
        <div style={sx('font-size:18px;font-weight:600;color:var(--text)')}>{fmtPesos(cartTotal)}</div>
      </div>

      {/* ── Forma de pago — sólo cuando sabemos qué códigos usa el ERP (ver el encabezado) ──── */}
      {formasPago.length > 0 && (
        <div style={sx('margin-bottom:16px')}>
          <div style={sx('font-size:12px;color:var(--muted);margin-bottom:7px')}>Forma de pago</div>
          <div style={sx('display:flex;flex-wrap:wrap;gap:7px')}>
            {formasPago.map((f) => (
              <button key={f.codigo} onClick={() => setFormaPago(f.codigo)} className="lu-press" style={chip(formaPago === f.codigo)}>
                {f.etiqueta || f.codigo}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Fecha de entrega ───────────────────────────────────────────────────────────────── */}
      <div style={sx('margin-bottom:16px')}>
        <div style={sx('font-size:12px;color:var(--muted);margin-bottom:7px')}>Entrega</div>
        <div style={sx('display:flex;flex-wrap:wrap;gap:7px;align-items:center')}>
          {/* "Sin fecha" es el default y va PRIMERO: es lo que el archivo real del ERP trae en
              todos sus pedidos (el campo 10 siempre repite la fecha del pedido). */}
          <button onClick={() => setFechaEntrega('')} className="lu-press" style={chip(!fechaEntrega)}>Sin fecha</button>
          <button onClick={() => setFechaEntrega(manana)} className="lu-press" style={chip(fechaEntrega === manana)}>Mañana</button>
          <input
            type="date"
            value={fechaEntrega}
            min={isoLocal(new Date())}
            onChange={(e) => setFechaEntrega(e.target.value)}
            style={sx('padding:8px 10px;border-radius:10px;border:1px solid var(--line2);background:var(--surface);color:var(--text);font-size:13px;font-family:inherit')}
          />
        </div>
      </div>

      {/* ── Observaciones ──────────────────────────────────────────────────────────────────── */}
      <div>
        <div style={sx('font-size:12px;color:var(--muted);margin-bottom:7px')}>Observaciones para el depósito</div>
        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          rows={3}
          placeholder="Opcional — llega al sistema de gestión con el pedido"
          style={sx('width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid var(--line2);background:var(--surface);color:var(--text);font-size:14px;font-family:inherit;resize:vertical')}
        />
      </div>
    </Overlay>
  )
}
