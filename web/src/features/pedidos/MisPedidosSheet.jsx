import { useCallback, useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import Overlay from '../../components/Overlay'
import TicketPedido from './TicketPedido'
import DetallePedido, { fmtFecha } from './DetallePedido'
import EditarPedidoSheet from './EditarPedidoSheet'
import { usePedidos, itemsDePedido } from './usePedidos'
import { pendientesDe } from '../../services/sync/writeQueue'

/**
 * MIS PEDIDOS — la misma revisión, del lado del vendedor.
 *
 * 🩸 POR QUÉ (20/08/2026). El pedido lo toma el vendedor y hasta hoy, una vez confirmado,
 * desaparecía de su vista para siempre: no había forma de repasar lo que cargó ni de corregir un
 * error. El pedido del que se dio cuenta tarde quedaba mal cargado y punto. Lo pidió el dueño con
 * estas palabras: "esencial que el vendedor también pueda revisar sus pedidos".
 *
 * PUEDE ANULAR SOLO, sin pedirle permiso a nadie (decisión del dueño). No hace falta abrir nada en
 * la base: `pedidos_upd` ya incluía `id_vendedor = auth.uid()`. Lo que se agrega es que quede
 * REGISTRADO quién y por qué (`anulado_por`, `motivo_anulacion`), que es lo que vuelve auditable
 * una acción que ya era posible.
 *
 * 🩸 MUESTRA TAMBIÉN LO QUE NO SUBIÓ, y eso es la mitad del punto. El pedido se guarda por la cola
 * de escrituras: un vendedor sin señal confirma, entra acá y —si la lista saliera solo de
 * Supabase— no encontraría nada. "No está" se lee como "se perdió", que es exactamente lo contrario
 * de lo que la cola garantiza. Van marcados y arriba, porque son los que todavía pueden preocupar.
 *
 * props: { open, onCerrar, onToast }
 */

/**
 * Los rangos que se ofrecen. Eran 7 días fijos; el dueño pidió poder mirar más atrás.
 *
 * ⚠️ EL TECHO DE 30 NO ES CAPRICHO Y TAMPOCO ES LA RETENCIÓN DE `posiciones` (45 días): los pedidos
 * NO se purgan, están todos. El límite es de lectura — `usePedidos` pagina de a 1.000 y trae el
 * comercio y la persona embebidos, así que abrir "todo" sería bajar la historia entera a un teléfono
 * para dibujar una lista que nadie va a scrollear hasta el fondo. Si algún día hace falta más, el
 * lugar correcto es un buscador por número o por comercio, no un rango más grande.
 */
const RANGOS = [
  { dias: 1, etiqueta: 'Hoy' },
  { dias: 7, etiqueta: '7 días' },
  { dias: 30, etiqueta: '30 días' },
]

function rangoUltimosDias(dias) {
  const h = new Date()
  const hasta = new Date(h.getFullYear(), h.getMonth(), h.getDate() + 1)
  const desde = new Date(h.getFullYear(), h.getMonth(), h.getDate() - (dias - 1))
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

export default function MisPedidosSheet({ open, onCerrar, onToast }) {
  const { user, rol, perfil } = useAuth()
  const { clientes } = useCatalog()
  const [detalle, setDetalle] = useState(null)
  const [ticket, setTicket] = useState(null)
  const [editando, setEditando] = useState(null)
  const [enCola, setEnCola] = useState([])
  const [dias, setDias] = useState(7)

  const { desde, hasta } = useMemo(() => rangoUltimosDias(dias), [dias])
  const userId = user?.id || null
  const { pedidos, cargando, error, recargar } = usePedidos({ desde, hasta, idVendedor: userId })

  // Lo que la cola todavía no subió. Se relee cada vez que se abre la hoja y después de cada
  // acción: entre una lectura y la otra el flush puede haber vaciado la cola, y un pedido que
  // aparezca dos veces —una "sin subir" y otra ya subida— es peor que no mostrarlo.
  const releerCola = useCallback(async () => {
    try {
      const cabeceras = await pendientesDe('pedidos')
      setEnCola(cabeceras.filter((p) => p && p.id_vendedor === userId))
    } catch (_) { setEnCola([]) }
  }, [userId])

  useEffect(() => { if (open) releerCola() }, [open, releerCola, pedidos])

  // Las que ya llegaron a la base se sacan de la lista de "sin subir": la cola puede conservar la
  // entrada un rato más y quedarían las dos.
  const idsSubidos = useMemo(() => new Set(pedidos.map((p) => p.id)), [pedidos])
  const pendientes = enCola
    .filter((p) => !idsSubidos.has(p.id))
    .map((p) => ({
      ...p,
      sinSubir: true,
      comercio: clientes.find((c) => c.id === p.id_cliente) || null,
      nombreVendedor: perfil?.nombre || null,
    }))

  const lista = [...pendientes, ...pedidos]

  // El resumen del período. Incluye lo que todavía está en la cola: para el vendedor ese pedido ya
  // se hizo —el comerciante se llevó la mercadería— y no verlo sumado se lee como que se perdió.
  const resumen = useMemo(() => {
    let total = 0
    let n = 0
    let anulados = 0
    for (const p of lista) {
      if (p.estado === 'Anulado') { anulados++; continue }
      n++
      total += Number(p.monto_total) || 0
    }
    return { total, n, anulados }
  }, [lista])

  async function abrir(pedido) {
    try {
      // Un pedido que todavía está en la cola no tiene líneas en la base: se leen de la cola.
      const lineas = pedido.sinSubir
        ? ((await pendientesDe('pedido_items')).flat().filter((l) => l?.id_pedido === pedido.id))
        : await itemsDePedido(pedido.id)
      setDetalle({ pedido, lineas })
    } catch (e) {
      onToast?.('No se pudo abrir el pedido: ' + (e?.message || 'sin conexión'))
    }
  }

  function alRecargar() { recargar(); releerCola() }

  return (
    <>
      <Overlay
        open={open}
        onClose={onCerrar}
        variant="sheet"
        alto="medio"
        title="Mis pedidos"
        subtitle={dias === 1 ? 'Hoy' : `Últimos ${dias} días`}
      >
        {/* ── Rango + total ─────────────────────────────────────────────────────────────────
            El total va acá arriba y no al pie: es el número que el vendedor viene a buscar, y al
            pie quedaría abajo de una lista que puede tener treinta renglones.
            🔴 NO suma los anulados. Un pedido anulado no se factura, así que contarlo sería
            decirle que vendió algo que no vendió — el mismo criterio que usan los reportes. */}
        <div style={sx('display:flex;align-items:center;gap:6px;margin-bottom:10px')}>
          {RANGOS.map((r) => {
            const activo = r.dias === dias
            return (
              <button
                key={r.dias}
                onClick={() => setDias(r.dias)}
                className="lu-press"
                style={{
                  ...sx('flex:1;min-height:34px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer'),
                  border: `1px solid ${activo ? 'var(--primary)' : 'var(--line2)'}`,
                  background: activo ? 'var(--primary-tint)' : 'transparent',
                  color: activo ? 'var(--primary)' : 'var(--muted)',
                }}
              >{r.etiqueta}</button>
            )
          })}
        </div>

        <div style={sx('display:flex;align-items:baseline;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid var(--line)')}>
          <span style={sx('font-size:12px;color:var(--muted)')}>
            {resumen.n} {resumen.n === 1 ? 'pedido' : 'pedidos'}
            {resumen.anulados ? ` · ${resumen.anulados} anulado${resumen.anulados === 1 ? '' : 's'}` : ''}
          </span>
          <span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:17px;font-weight:700')}>
            {fmtPesos(resumen.total)}
          </span>
        </div>

        {error && (
          <div style={sx('padding:12px;border:1px solid var(--danger);border-radius:11px;color:var(--danger);font-size:12px')}>
            No se pudieron leer: {error}
          </div>
        )}

        {!error && cargando && !lista.length && (
          <div style={sx('padding:24px;text-align:center;color:var(--faint);font-size:13px')}>Cargando…</div>
        )}

        {!error && !cargando && !lista.length && (
          <div style={sx('padding:22px 8px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6')}>
            <b>Todavía no hay pedidos tuyos en estos días.</b><br />
            Los pedidos se empezaron a guardar el 19/08/2026.
          </div>
        )}

        {lista.map((p) => {
          const anulado = p.estado === 'Anulado'
          return (
            <div
              key={p.id}
              onClick={() => abrir(p)}
              className="lu-press"
              role="button"
              style={{
                ...sx('display:flex;align-items:center;gap:10px;padding:11px 0;cursor:pointer'),
                borderBottom: '1px solid var(--line)',
                opacity: anulado ? 0.65 : 1,
              }}
            >
              <div style={sx('flex:1;min-width:0')}>
                <div style={{ ...sx('font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), textDecoration: anulado ? 'line-through' : 'none' }}>
                  {p.comercio?.name || 'Comercio'}
                </div>
                <div style={sx('font-size:11px;color:var(--muted);margin-top:2px;font-family:var(--font-mono)')}>
                  {p.numero ? `#${p.numero} · ` : ''}{fmtFecha(p.created_at)}
                </div>
                {p.sinSubir && (
                  <div style={sx('font-size:10.5px;color:var(--warning);margin-top:3px;font-weight:600')}>
                    SIN SUBIR · se manda solo cuando vuelva la señal
                  </div>
                )}
                {anulado && (
                  <div style={sx('font-size:10.5px;color:var(--danger);margin-top:3px')}>
                    ANULADO{p.motivo_anulacion ? ` · ${p.motivo_anulacion}` : ''}
                  </div>
                )}
              </div>
              <div style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:14.5px;font-weight:700')}>
                {fmtPesos(p.monto_total)}
              </div>
            </div>
          )
        })}
      </Overlay>

      <DetallePedido
        detalle={detalle}
        rol={rol}
        userId={userId}
        onCerrar={() => setDetalle(null)}
        onToast={onToast}
        onRecargar={alRecargar}
        onTicket={(d) => { setDetalle(null); setTicket(d) }}
        onEditar={(d) => { setDetalle(null); setEditando(d) }}
      />

      {/* El sheet vive acá y no adentro del detalle porque el detalle se cierra al abrirlo: un hijo
          de algo desmontado desaparecería en el mismo frame en que se crea (el mismo motivo por el
          que `useJornada` sube el ticket a `VendedorView`). */}
      {editando && (
        <EditarPedidoSheet
          pedido={editando.pedido}
          lineas={editando.lineas}
          userId={userId}
          onCerrar={() => setEditando(null)}
          onGuardado={alRecargar}
          onToast={onToast}
        />
      )}

      {ticket && (
        <TicketPedido
          pedido={ticket.pedido}
          comercio={ticket.pedido.comercio}
          vendedor={{ nombre: ticket.pedido.nombreVendedor }}
          lineas={ticket.lineas}
          onCerrar={() => setTicket(null)}
        />
      )}
    </>
  )
}
