import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { ETIQUETA_NOVEDAD, novedadesDePedido } from '../repartidor/novedades'

/**
 * Las novedades que anotó el repartidor en este pedido (plan 53): pago mixto, devolución, rotura,
 * cambio, motivo de no entrega, con fotos. Sólo lectura, en Gestión → detalle del pedido. No se dibuja
 * nada si no hay.
 */
export default function NovedadesPedido({ idPedido }) {
  const [lista, setLista] = useState(null)
  useEffect(() => {
    let vivo = true
    setLista(null)
    novedadesDePedido(idPedido).then((l) => { if (vivo) setLista(l) }).catch(() => { if (vivo) setLista([]) })
    return () => { vivo = false }
  }, [idPedido])
  if (!lista?.length) return null
  return (
    <div style={sx('margin-bottom:12px;padding:10px 12px;border:1px solid var(--warning);border-radius:11px;background:var(--warning-tint)')}>
      <div style={sx('font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--warning);margin-bottom:6px')}>
        Novedad{lista.length === 1 ? '' : 'es'} de la entrega
      </div>
      {lista.map((n) => (
        <div key={n.id} style={sx('font-size:12.5px;line-height:1.5;margin-bottom:8px')}>
          <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}>
            {n.tipos.map((t) => <b key={t}>{ETIQUETA_NOVEDAD[t] || t}</b>)}
          </div>
          {(n.monto_efectivo != null || n.monto_transferencia != null) && (
            <div style={sx('color:var(--muted)')}>Efectivo {fmtPesos(n.monto_efectivo || 0)} · Transferencia {fmtPesos(n.monto_transferencia || 0)}</div>
          )}
          {n.detalle && <div style={sx('white-space:pre-wrap')}>{n.detalle}</div>}
          <div style={sx('font-size:11px;color:var(--faint)')}>
            {new Date(n.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}{n.repartidor?.nombre ? ` · ${n.repartidor.nombre}` : ''}
          </div>
          {n.urls.length > 0 && (
            <div style={sx('display:flex;gap:6px;margin-top:6px')}>
              {n.urls.map((u, i) => (u
                ? <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`Foto ${i + 1}`} style={sx('width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--line2)')} /></a>
                : <span key={i} style={sx('font-size:11px;color:var(--faint)')}>Foto pendiente de subir</span>))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
