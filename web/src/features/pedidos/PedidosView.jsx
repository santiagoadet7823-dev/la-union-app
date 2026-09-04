import { useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import TicketPedido from './TicketPedido'
import DetallePedido, { fmtFecha } from './DetallePedido'
import EditarPedidoSheet from './EditarPedidoSheet'
import { usePedidos, itemsDePedido, vendedoresDe } from './usePedidos'
import { exportarPedidosTsv } from './exportarPedidos'
import { Bajar } from '../../components/icons'

/**
 * REVISAR LOS PEDIDOS. Pantalla de gestión (encargado / admin / superadmin).
 *
 * 🩸 POR QUÉ EXISTE (20/08/2026). Los pedidos se empezaron a guardar ayer y no había forma de
 * mirarlos: cero consultas a `pedidos` en toda la app fuera de un bloque del informe de jornada.
 * El reporte del dueño fue literal — "acabo de hacer un pedido y no encuentro dónde eliminarlo".
 *
 * QUIÉN VE QUÉ **NO SE DECIDE ACÁ**. Lo decide `pedidos_sel` en el servidor (`db/45`), que desde
 * hoy obedece la jerarquía de `ids_a_mi_cargo()`: el encargado ve a su gente, el admin su empresa,
 * el superadmin todo. Esta pantalla no filtra por rol ni una sola vez — si lo hiciera, habría dos
 * verdades sobre lo mismo y una se quedaría vieja. Lo único que mira el rol es el botón de borrar,
 * y ahí es para no OFRECER algo que la base va a rechazar, no para autorizarlo.
 *
 * 🔴 ANULAR NO ES BORRAR, y la pantalla lo dice con todas las letras. Un pedido anulado sigue
 * estando, con motivo y con firma; uno borrado no deja nada, y sin rastro no hay forma de notar que
 * alguien se limpia los días flojos. Por eso borrar es solo del superadmin y solo sobre lo ya
 * anulado — hay que dejar el rastro antes de poder destruirlo.
 *
 * props: { onToast }
 */

// Los rangos que se ofrecen. Nada de un calendario libre: lo que se revisa es lo reciente, y un
// selector de dos fechas para eso son cuatro toques en un teléfono en vez de uno.
const RANGOS = [
  { key: 'hoy', label: 'Hoy', dias: 0 },
  { key: '7', label: '7 días', dias: 6 },
  { key: '30', label: '30 días', dias: 29 },
]

/** [desde, hasta) en hora LOCAL. Salta es UTC−3: un rango en UTC se comería tres horas del día. */
function rangoDe(dias) {
  const h = new Date()
  const hasta = new Date(h.getFullYear(), h.getMonth(), h.getDate() + 1)
  const desde = new Date(h.getFullYear(), h.getMonth(), h.getDate() - dias)
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

export default function PedidosView({ onToast }) {
  const { user, rol } = useAuth()
  const [rango, setRango] = useState('7')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [verAnulados, setVerAnulados] = useState(true)
  const [detalle, setDetalle] = useState(null)   // { pedido, lineas } — el pedido abierto
  const [ticket, setTicket] = useState(null)     // { pedido, lineas } — el comprobante
  const [editando, setEditando] = useState(null)  // { pedido, lineas } — el que se está corrigiendo
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [exportando, setExportando] = useState(false)

  const dias = RANGOS.find((r) => r.key === rango)?.dias ?? 6
  // `useMemo` sobre el rango: sin él, cada render arma dos Date nuevas, cambian las dependencias
  // del efecto de `usePedidos` y la pantalla consulta en loop.
  const { desde, hasta } = useMemo(() => rangoDe(dias), [dias])
  const { pedidos, cargando, error, recargar } = usePedidos({
    desde, hasta, idVendedor: filtroVendedor || null, incluirAnulados: verAnulados,
  })

  const personas = useMemo(() => vendedoresDe(pedidos), [pedidos])
  const vivos = pedidos.filter((p) => p.estado !== 'Anulado')
  const totalVendido = vivos.reduce((a, p) => a + Number(p.monto_total || 0), 0)
  const anulados = pedidos.length - vivos.length

  /**
   * Bajar el archivo para facturar en el sistema del cliente. Ver `exportarPedidos.js`: el formato
   * es PROVISORIO hasta que llegue una muestra del export real.
   *
   * Se exporta lo que está EN PANTALLA — mismo rango, misma persona, mismo filtro de anulados — y
   * no "los de hoy" por su cuenta: si el botón bajara algo distinto de lo que la lista muestra, no
   * habría forma de revisar antes de facturar, que es justo para lo que sirve esta pantalla.
   *
   * Los anulados se sacan SIEMPRE, aunque estén visibles: un pedido anulado no se factura, y
   * mandarlo al otro sistema es exactamente el error que la anulación viene a evitar.
   */
  async function exportar() {
    const paraExportar = pedidos.filter((p) => p.estado !== 'Anulado')
    if (!paraExportar.length) { onToast?.('No hay pedidos para exportar en este rango.'); return }
    setExportando(true)
    try {
      const r = await exportarPedidosTsv(paraExportar, { nombre: `pedidos-${RANGOS.find((x) => x.key === rango)?.label.toLowerCase().replace(' ', '')}` })
      onToast?.(`${r.pedidos} pedidos · ${r.filas} renglones` + (r.sinLineas ? ` · ⚠ ${r.sinLineas} sin líneas` : ''))
    } catch (e) {
      onToast?.('No se pudo exportar: ' + (e?.message || 'sin conexión'))
    } finally {
      setExportando(false)
    }
  }

  async function abrir(pedido) {
    setCargandoDetalle(true)
    try {
      setDetalle({ pedido, lineas: await itemsDePedido(pedido.id) })
    } catch (e) {
      onToast?.('No se pudieron leer las líneas: ' + (e?.message || 'sin conexión'))
    } finally {
      setCargandoDetalle(false)
    }
  }

  return (
    <div style={sx('padding:14px;max-width:900px;margin:0 auto')}>
      {/* ── Filtros ─────────────────────────────────────────────────────────────────────── */}
      <div style={sx('display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px')}>
        <div style={sx('display:flex;gap:6px')}>
          {RANGOS.map((r) => (
            <button
              key={r.key}
              onClick={() => setRango(r.key)}
              className="lu-press"
              style={{
                ...sx('padding:7px 13px;border-radius:99px;font-size:12.5px;font-weight:600;cursor:pointer'),
                border: `1px solid ${rango === r.key ? 'var(--primary)' : 'var(--line2)'}`,
                background: rango === r.key ? 'var(--primary-tint)' : 'transparent',
                color: rango === r.key ? 'var(--deep)' : 'var(--muted)',
              }}
            >{r.label}</button>
          ))}
        </div>

        <select
          value={filtroVendedor}
          onChange={(e) => setFiltroVendedor(e.target.value)}
          style={sx('padding:7px 10px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:12.5px')}
        >
          <option value="">Todas las personas</option>
          {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>

        <label style={sx('display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);cursor:pointer')}>
          <input type="checkbox" checked={verAnulados} onChange={(e) => setVerAnulados(e.target.checked)} />
          Ver anulados
        </label>

        {/* Para facturar en el sistema del cliente. Va con los filtros y no arriba del todo porque
            lo que baja es EXACTAMENTE lo que la lista muestra. */}
        <button
          onClick={exportar}
          disabled={exportando || cargando}
          className="lu-press"
          style={{
            ...sx('margin-left:auto;display:flex;align-items:center;gap:7px;padding:7px 13px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer'),
            border: '1px solid var(--line2)',
            background: 'var(--surface)',
            color: 'var(--muted)',
            opacity: exportando || cargando ? 0.5 : 1,
          }}
        >
          <Bajar size={14} />
          {exportando ? 'Armando…' : 'Exportar para facturar'}
        </button>
      </div>

      {/* ── Resumen ─────────────────────────────────────────────────────────────────────── */}
      <div style={sx('display:flex;gap:18px;flex-wrap:wrap;padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);margin-bottom:12px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
        <div>
          <div style={sx('font-size:10.5px;color:var(--faint)')}>Pedidos</div>
          <div style={sx('font-size:19px;font-weight:700')}>{vivos.length}</div>
        </div>
        <div>
          <div style={sx('font-size:10.5px;color:var(--faint)')}>Vendido</div>
          <div style={sx('font-size:19px;font-weight:700')}>{fmtPesos(totalVendido)}</div>
        </div>
        {anulados > 0 && (
          <div>
            <div style={sx('font-size:10.5px;color:var(--faint)')}>Anulados</div>
            <div style={sx('font-size:19px;font-weight:700;color:var(--danger)')}>{anulados}</div>
          </div>
        )}
      </div>

      {/* ── La lista ────────────────────────────────────────────────────────────────────── */}
      {error && (
        <div style={sx('padding:13px;border:1px solid var(--danger);border-radius:var(--r-lg);color:var(--danger);font-size:12.5px')}>
          No se pudieron leer los pedidos: {error}
        </div>
      )}

      {!error && cargando && (
        <div style={sx('padding:26px;text-align:center;color:var(--faint);font-size:13px')}>Cargando pedidos…</div>
      )}

      {!error && !cargando && !pedidos.length && (
        <div style={sx('padding:24px 16px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg)')}>
          <b>No hay pedidos en este rango.</b><br />
          Los pedidos se empezaron a guardar el <b>19/08/2026</b>; antes de esa fecha la app los
          tomaba pero no los persistía, así que no hay historial anterior que mostrar.
        </div>
      )}

      {!error && !cargando && pedidos.map((p) => {
        const anulado = p.estado === 'Anulado'
        return (
          <div
            key={p.id}
            onClick={() => abrir(p)}
            className="lu-press"
            role="button"
            style={{
              ...sx('display:flex;align-items:center;gap:11px;padding:11px 13px;margin-bottom:7px;background:var(--surface);border-radius:12px;cursor:pointer'),
              border: `1px solid ${anulado ? 'var(--danger)' : 'var(--line)'}`,
              opacity: anulado ? 0.68 : 1,
            }}
          >
            <div style={sx('flex:1;min-width:0')}>
              <div style={sx('display:flex;align-items:baseline;gap:7px')}>
                <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--faint)')}>#{p.numero || '—'}</span>
                <span style={{ ...sx('font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), textDecoration: anulado ? 'line-through' : 'none' }}>
                  {p.comercio?.name || 'Comercio dado de baja'}
                </span>
              </div>
              <div style={sx('font-size:11px;color:var(--muted);margin-top:2px;font-family:var(--font-mono)')}>
                {fmtFecha(p.created_at)} · {p.nombreVendedor || '—'}
                {p.origen === 'vidriera' ? ' · tablet' : ''}
                {/* La distancia informa; no acusa. Se muestra el número y nada más — el GPS de
                    estos equipos miente hasta 30 m y el comercio puede no tener ubicación. */}
                {p.distancia_m != null ? ` · ${Math.round(p.distancia_m)} m` : ''}
              </div>
              {anulado && (
                <div style={sx('font-size:10.5px;color:var(--danger);margin-top:3px')}>
                  ANULADO{p.motivo_anulacion ? ` · ${p.motivo_anulacion}` : ''}
                </div>
              )}
            </div>
            <div style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:15px;font-weight:700')}>
              {fmtPesos(p.monto_total)}
            </div>
          </div>
        )
      })}

      {cargandoDetalle && (
        <div style={sx('padding:10px;text-align:center;color:var(--faint);font-size:12px')}>Abriendo…</div>
      )}

      {/* ── El pedido abierto ───────────────────────────────────────────────────────────── */}
      <DetallePedido
        detalle={detalle}
        rol={rol}
        userId={user?.id || null}
        onCerrar={() => setDetalle(null)}
        onToast={onToast}
        onRecargar={recargar}
        onTicket={(d) => { setDetalle(null); setTicket(d) }}
        onEditar={(d) => { setDetalle(null); setEditando(d) }}
      />

      {/* La MISMA corrección que hace el vendedor. Quién puede lo decide la base: `items_upd` y
          `items_del` (db/55) van por `ids_a_mi_cargo()`, así que el encargado corrige los pedidos de
          su gente y el admin los de su empresa, sin una condición de rol escrita acá. */}
      {editando && (
        <EditarPedidoSheet
          pedido={editando.pedido}
          lineas={editando.lineas}
          userId={user?.id || null}
          onCerrar={() => setEditando(null)}
          onGuardado={recargar}
          onToast={onToast}
        />
      )}

      {/* El comprobante, con el MISMO componente que imprime el vendedor al confirmar. Un segundo
          ticket "para gestión" serían dos papeles que dicen cosas distintas del mismo pedido. */}
      {ticket && (
        <TicketPedido
          pedido={ticket.pedido}
          comercio={ticket.pedido.comercio}
          vendedor={{ nombre: ticket.pedido.nombreVendedor }}
          lineas={ticket.lineas}
          onCerrar={() => setTicket(null)}
        />
      )}
    </div>
  )
}
