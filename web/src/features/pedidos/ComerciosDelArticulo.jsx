import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtCant } from '../../lib/format'
import { normalizar } from '../../lib/texto'
import { supabase } from '../../services/supabase'
import { claveVendedor } from './consolidado'
import { estadoDePedido } from './estadoPedido'

/**
 * COMERCIOS QUE PIDIERON UN ARTÍCULO (plan 53, 26/11/2026). Pedido del usuario: "cuando demos click a
 * un artículo, que aparezcan los comercios que lo solicitaron con su fecha, para rastrear la mala
 * entrega de un producto".
 *
 * La base devuelve sólo los renglones de ESE artículo (`consolidado_articulo_detalle`, db/114, misma
 * clave y misma RLS que el consolidado) y la cabecera de cada pedido (comercio, fecha, vendedor,
 * estado, repartidor) ya está en la lista que recibió la hoja: no se vuelve a pedir.
 *
 * props: clave, pedidos (los de la hoja), vendSel (Set de claves de vendedor; vacío = todos),
 *        unidadVenta, nombreRepartidor (Map id → nombre), onAbrirPedido(p), onFilas(filas)
 */
const LOTE = 400

async function pedirRenglones(ids, clave, signal) {
  const out = []
  for (let i = 0; i < ids.length; i += LOTE) {
    let q = supabase.rpc('consolidado_articulo_detalle', { p_ids: ids.slice(i, i + LOTE), p_clave: clave })
    if (signal) q = q.abortSignal(signal)
    const { data, error } = await q
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

const fechaHora = (iso) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
}

/** Las filas listas para mostrar y para el Excel/CSV. */
export function armarFilasComercios(renglones, pedidos, nombreRepartidor) {
  const porId = new Map(pedidos.map((p) => [p.id, p]))
  const filas = []
  for (const [idPedido, cantidad, entregada, importe] of renglones) {
    const p = porId.get(idPedido)
    if (!p) continue
    filas.push({
      id: idPedido,
      pedido: p,
      fecha: p.created_at,
      numero: p.numero,
      codigo: p.comercio?.codigo || '',
      comercio: p.comercio?.name || '—',
      localidad: p.comercio?.loc || '',
      vendedor: p.nombreVendedor || '—',
      repartidor: p.id_repartidor ? (nombreRepartidor?.get(p.id_repartidor) || '—') : '',
      cantidad: Number(cantidad) || 0,
      entregada: entregada == null ? null : Number(entregada),
      importe: Number(importe) || 0,
      estado: estadoDePedido(p),
      fechaEntrega: p.fecha_entrega ? String(p.fecha_entrega).slice(0, 10) : '',
    })
  }
  return filas.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
}

export default function ComerciosDelArticulo({ clave, pedidos, vendSel, unidadVenta, nombreRepartidor, onAbrirPedido, onFilas }) {
  const ids = useMemo(() => pedidos
    .filter((p) => !vendSel?.size || vendSel.has(claveVendedor(p.id_vendedor)))
    .map((p) => p.id), [pedidos, vendSel])
  const [renglones, setRenglones] = useState(null)
  const [error, setError] = useState('')
  const [ronda, setRonda] = useState(0)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    setRenglones(null)
    setError('')
    pedirRenglones(ids, clave, ctrl.signal)
      .then((r) => { if (!ctrl.signal.aborted) setRenglones(r) })
      .catch((e) => { if (!ctrl.signal.aborted) setError(e?.message || 'sin conexión') })
    return () => ctrl.abort()
  }, [ids, clave, ronda])

  const filas = useMemo(() => (renglones ? armarFilasComercios(renglones, pedidos, nombreRepartidor) : []), [renglones, pedidos, nombreRepartidor])
  useEffect(() => { onFilas?.(renglones ? filas : null) }, [filas, renglones, onFilas])

  const q = normalizar(busqueda.trim())
  const vistas = q ? filas.filter((f) => normalizar(`${f.codigo} ${f.comercio} ${f.localidad} ${f.vendedor} ${f.numero}`).includes(q)) : filas
  const comercios = new Set(filas.map((f) => f.pedido.id_cliente)).size

  return (
    <section style={sx('margin-top:16px')}>
      <div style={sx('display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px')}>
        <span style={sx('font-size:12.5px;font-weight:700;color:var(--deep)')}>Comercios que lo pidieron</span>
        {renglones && (
          <span style={sx('font-size:11.5px;color:var(--muted)')}>
            {comercios} comercio{comercios === 1 ? '' : 's'} · {filas.length} pedido{filas.length === 1 ? '' : 's'} · del más nuevo al más viejo
          </span>
        )}
      </div>

      {!renglones && !error && (
        <div role="status" style={sx('padding:14px;text-align:center;color:var(--muted);font-size:12.5px')}>Buscando los pedidos de este artículo…</div>
      )}
      {error && (
        <div style={sx('padding:12px;border:1px solid var(--danger);border-radius:12px;background:var(--danger-tint);font-size:12.5px;display:flex;gap:10px;align-items:center;justify-content:space-between')}>
          <span>No se pudo leer la lista de comercios ({error}).</span>
          <button type="button" className="lu-press" onClick={() => setRonda((n) => n + 1)}
            style={sx('padding:6px 12px;border:1px solid var(--line2);border-radius:99px;background:var(--surface);color:var(--deep);font-size:12px;font-weight:600;cursor:pointer')}>Reintentar</button>
        </div>
      )}

      {renglones && filas.length > 4 && (
        <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar comercio, código, vendedor o N.º de pedido"
          aria-label="Buscar comercio" className="lu-no-print"
          style={sx('width:100%;box-sizing:border-box;margin-bottom:8px;padding:7px 10px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:max(12.5px, var(--piso-entrada))')} />
      )}

      {renglones && !filas.length && (
        <div style={sx('padding:14px;text-align:center;color:var(--muted);font-size:12.5px')}>Ningún pedido de la lista lleva este artículo.</div>
      )}

      {vistas.map((f) => (
        <button key={f.id} type="button" className="lu-press" onClick={() => onAbrirPedido?.(f.pedido)}
          title={onAbrirPedido ? 'Abrir el pedido' : undefined}
          style={sx('display:block;width:100%;text-align:left;padding:9px 12px;margin-bottom:6px;background:var(--surface);border:1px solid var(--line);border-radius:12px;color:var(--text);cursor:pointer')}>
          <div style={sx('display:flex;gap:8px;align-items:baseline')}>
            <span style={sx('flex:none;font-family:var(--font-mono);font-size:11.5px;color:var(--muted)')}>{fechaHora(f.fecha)}</span>
            <span style={sx('flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
              {f.codigo ? `${f.codigo} · ` : ''}{f.comercio}
            </span>
            <span style={sx('flex:none;font-family:var(--font-mono);font-size:14px;font-weight:700')}>
              {fmtCant(f.cantidad)}{unidadVenta ? <span style={sx('font-size:10px;font-weight:600;color:var(--faint);margin-left:3px')}>{unidadVenta}</span> : null}
            </span>
          </div>
          <div style={sx('display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px;font-size:11.5px;color:var(--muted)')}>
            <span>#{f.numero ?? '—'}</span>
            <span>· {f.vendedor}</span>
            {f.localidad && <span>· {f.localidad}</span>}
            {f.repartidor && <span>· reparte {f.repartidor}</span>}
            {f.fechaEntrega && <span>· entrega {f.fechaEntrega.slice(8, 10)}/{f.fechaEntrega.slice(5, 7)}</span>}
            {f.entregada != null && <span>· entregó {fmtCant(f.entregada)}</span>}
            {f.estado && (
              <span style={{ ...sx('padding:1px 8px;border-radius:99px;font-size:10.5px;font-weight:700'), color: f.estado.color, background: f.estado.fondo }}>{f.estado.texto}</span>
            )}
          </div>
        </button>
      ))}
      {renglones && q && !vistas.length && (
        <div style={sx('padding:10px;text-align:center;color:var(--muted);font-size:12.5px')}>Nada coincide con la búsqueda.</div>
      )}
    </section>
  )
}
