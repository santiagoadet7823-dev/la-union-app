import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtCant, fmtPesos, hace } from '../../lib/format'
import Overlay from '../../components/Overlay'
import { supabase } from '../../services/supabase'
import { estadoDePedido } from '../pedidos/estadoPedido'

/**
 * HISTORIAL DE PEDIDOS DEL COMERCIO, DESDE LA VISITA (plan 53, 26/11/2026).
 *
 * Pedido del usuario: en el check-in "siguen apareciendo los tickets"; mejor un botón "Ver historial
 * de pedidos" con el estado de cada uno. Los últimos 90 días (tope 30), del más nuevo al más viejo, con
 * la etiqueta de `estadoDePedido` (la misma regla del ARM, db/111): en La Unión, como no asignan
 * repartidor, lo que informa es si ya se cargó en el ERP y si el ERP lo confirmó o lo modificó.
 * Tocar un pedido muestra sus renglones (se leen recién ahí). La RLS decide qué pedidos se ven: el
 * vendedor, los suyos.
 *
 * props: { comercio, onCerrar }
 */
const DIAS = 90
const TOPE = 30

export default function HistorialPedidosCliente({ comercio, onCerrar }) {
  const [pedidos, setPedidos] = useState(undefined) // undefined = cargando · null = error
  const [abierto, setAbierto] = useState(null)
  const [lineas, setLineas] = useState({})          // id → renglones | 'cargando' | 'error'

  useEffect(() => {
    let vivo = true
    const desde = new Date(Date.now() - DIAS * 86400000).toISOString()
    supabase.from('pedidos')
      .select('id, numero, estado, created_at, monto_total, exportado_ts, export_lote, erp_estado, erp_total, id_repartidor, fecha_entrega, pedido_items ( cantidad )')
      .eq('id_cliente', comercio.id)
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(TOPE)
      .then(({ data, error }) => { if (vivo) setPedidos(error ? null : (data || [])) })
      .catch(() => { if (vivo) setPedidos(null) })
    return () => { vivo = false }
  }, [comercio.id])

  async function alternar(p) {
    if (abierto === p.id) { setAbierto(null); return }
    setAbierto(p.id)
    if (lineas[p.id] && lineas[p.id] !== 'error') return
    setLineas((l) => ({ ...l, [p.id]: 'cargando' }))
    const { data, error } = await supabase.from('pedido_items')
      .select('id, descripcion, codigo_producto, cantidad, cantidad_entregada, precio_unitario')
      .eq('id_pedido', p.id)
      .order('descripcion')
    setLineas((l) => ({ ...l, [p.id]: error ? 'error' : (data || []) }))
  }

  return (
    <Overlay open onClose={onCerrar} variant="sheet" alto="medio"
      title="Historial de pedidos" subtitle={`${comercio.name || comercio.nombre_comercio || ''} · últimos ${DIAS} días`}>
      {pedidos === undefined && <div role="status" style={sx('padding:22px;text-align:center;color:var(--muted);font-size:13px')}>Buscando los pedidos…</div>}
      {pedidos === null && <div style={sx('padding:22px;text-align:center;color:var(--danger);font-size:13px')}>No se pudo leer el historial. Revisá la conexión.</div>}
      {pedidos && !pedidos.length && <div style={sx('padding:22px;text-align:center;color:var(--muted);font-size:13px')}>Este comercio no tiene pedidos en los últimos {DIAS} días.</div>}
      {pedidos?.map((p) => {
        const e = estadoDePedido(p)
        const unidades = (p.pedido_items || []).reduce((s, i) => s + (Number(i.cantidad) || 0), 0)
        const ls = lineas[p.id]
        return (
          <div key={p.id} style={sx('margin-bottom:8px;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden')}>
            <button type="button" className="lu-press" onClick={() => alternar(p)} aria-expanded={abierto === p.id}
              style={sx('display:block;width:100%;text-align:left;padding:10px 12px;border:none;background:transparent;color:var(--text);cursor:pointer')}>
              <div style={sx('display:flex;gap:8px;align-items:baseline')}>
                <span style={sx('font-size:13.5px;font-weight:700')}>#{p.numero ?? '—'}</span>
                <span style={sx('flex:1;font-size:11.5px;color:var(--muted)')}>
                  {new Date(p.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} · {hace(p.created_at)}
                </span>
                <span style={sx('font-family:var(--font-mono);font-size:13.5px;font-weight:700')}>{fmtPesos(p.erp_total ?? p.monto_total)}</span>
              </div>
              <div style={sx('display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:5px;font-size:11.5px;color:var(--muted)')}>
                <span style={{ ...sx('padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700'), color: e.color, background: e.fondo }}>{e.texto}</span>
                <span>{fmtCant(unidades)} u</span>
                {p.fecha_entrega && <span>· entrega {String(p.fecha_entrega).slice(8, 10)}/{String(p.fecha_entrega).slice(5, 7)}</span>}
              </div>
            </button>
            {abierto === p.id && (
              <div style={sx('padding:4px 12px 10px;border-top:1px solid var(--line)')}>
                {ls === 'cargando' && <div style={sx('padding:8px 0;font-size:12px;color:var(--muted)')}>Leyendo los productos…</div>}
                {ls === 'error' && <div style={sx('padding:8px 0;font-size:12px;color:var(--danger)')}>No se pudieron leer los productos.</div>}
                {Array.isArray(ls) && ls.map((l) => (
                  <div key={l.id} style={sx('display:flex;gap:8px;padding:5px 0;font-size:12.5px;border-bottom:1px dashed var(--line)')}>
                    <span style={sx('flex:1;min-width:0')}>{l.descripcion || l.codigo_producto || '—'}</span>
                    <span style={sx('flex:none;font-family:var(--font-mono);font-weight:700')}>
                      {fmtCant(l.cantidad)}{l.cantidad_entregada != null && Number(l.cantidad_entregada) !== Number(l.cantidad) ? ` → ${fmtCant(l.cantidad_entregada)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </Overlay>
  )
}
