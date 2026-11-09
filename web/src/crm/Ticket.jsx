import { useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import { useTicket, funcion, textoError, pesos, cant, horaLarga } from './datos'

/**
 * Ticket del pedido de la conversación (plan 41 §4). Solo quien tiene el control lo edita, y cada
 * cambio se guarda en el servidor al momento: los precios los calcula SIEMPRE `crm-ticket` con
 * `precioPara` (acá no se escribe ningún precio). `version` evita que una edición pise a otra.
 */
function Buscador({ conv, onElegir, deshabilitado }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [buscando, setBuscando] = useState(false)
  const turno = useRef(0)

  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setRes([]); return undefined }
    const n = ++turno.current
    const reloj = setTimeout(async () => {
      setBuscando(true)
      const { data } = await supabase.rpc('crm_buscar_productos', { p_texto: t, p_limite: 12, p_empresa: conv.id_empresa })
      if (n === turno.current) { setRes(data || []); setBuscando(false) }
    }, 250)
    return () => clearTimeout(reloj)
  }, [q, conv.id_empresa])

  return (
    <div className="crm-buscador">
      <input className="crm-input" type="search" placeholder="Agregar producto: nombre o código" value={q} disabled={deshabilitado}
        onChange={(e) => setQ(e.target.value)} aria-label="Buscar producto" />
      {(res.length > 0 || buscando) && (
        <div className="crm-buscador-res">
          {buscando && !res.length && <div className="crm-muted crm-pad">Buscando…</div>}
          {res.map((p) => (
            <button key={p.id} onClick={() => { onElegir(p); setQ(''); setRes([]) }}>
              <span className="crm-mono crm-chico">{p.codigo}</span>
              <span className="crm-buscador-desc">{p.descripcion}</span>
              <span className="crm-mono">{pesos(p.oferta && p.precio_oferta ? p.precio_oferta : p.precio_unitario)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Cantidad({ valor, onCambiar, deshabilitado }) {
  const [v, setV] = useState(String(valor).replace('.', ','))
  useEffect(() => { setV(String(valor).replace('.', ',')) }, [valor])
  const aplicar = () => {
    const n = Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100) / 100
    if (!(n >= 0) || n === Number(valor)) { setV(String(valor).replace('.', ',')); return }
    onCambiar(n)
  }
  return (
    <input className="crm-input crm-cant" inputMode="decimal" value={v} disabled={deshabilitado} aria-label="Cantidad"
      onChange={(e) => setV(e.target.value.replace(/[^\d.,]/g, ''))} onBlur={aplicar}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}

export default function Ticket({ conv, yo, soloVer }) {
  const { ticket, setTicket } = useTicket(conv.id)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [confirmando, setConfirmando] = useState(false)

  const mio = conv.asignada_a === yo.id
  const borrador = ticket?.estado === 'borrador' ? ticket : null
  const editable = !soloVer && mio && conv.estado !== 'cerrada'
  const items = borrador?.items || []

  async function llamar(cuerpo, ok) {
    setOcupado(true)
    setAviso(null)
    const r = await funcion('crm-ticket', { conversacion: conv.id, ...cuerpo })
    setOcupado(false)
    if (r.ticket !== undefined && (r.ok || r.error === 'ticket-cambio' || r.error === 'precios-cambiaron' || r.error === 'pedido-fallo')) setTicket(r.ticket)
    if (r.ok) { if (ok) setAviso({ tipo: 'ok', texto: typeof ok === 'function' ? ok(r) : ok }) }
    else setAviso({ tipo: 'error', texto: textoError(r) })
    return r
  }

  const guardarItems = (nuevos) => llamar({
    accion: 'guardar', version: borrador?.version ?? null,
    items: nuevos.map((r) => ({ id_producto: r.id_producto, cantidad: r.cantidad })),
  })

  const agregar = (p) => {
    const ya = items.find((r) => r.id_producto === p.id)
    guardarItems(ya ? items.map((r) => (r.id_producto === p.id ? { ...r, cantidad: r.cantidad + 1 } : r)) : [...items, { id_producto: p.id, cantidad: 1 }])
  }

  let motivoBloqueo = null
  if (soloVer) motivoBloqueo = 'Modo demostración: solo lectura.'
  else if (!mio) motivoBloqueo = conv.asignada_a ? `Lo edita ${conv.asignada_nombre}, que tiene el control.` : 'Tomá el control del chat para editar el ticket.'

  return (
    <div className="crm-ticket">
      {ticket && !borrador && (
        <div className={`crm-ticket-cerrado ${ticket.estado === 'confirmado' ? 'crm-ok' : ''}`}>
          {ticket.estado === 'confirmado'
            ? <>✅ Pedido N° <b>{ticket.numero_pedido}</b> confirmado {ticket.confirmado_ts ? `el ${horaLarga(ticket.confirmado_ts)}` : ''} por {pesos(ticket.total)}{ticket.editado_nombre ? ` · ${ticket.editado_nombre}` : ''}</>
            : <>Ticket cancelado{ticket.editado_nombre ? ` por ${ticket.editado_nombre}` : ''}.</>}
        </div>
      )}

      <div className="crm-ticket-cabeza">
        <div className="crm-h2">{borrador ? 'Ticket en armado' : 'Ticket'}</div>
        {borrador && (
          <div className="crm-muted crm-chico">
            {borrador.creado_por_bot ? 'Lo armó el bot' : 'Armado en el ARM'}
            {borrador.editado_nombre ? ` · última edición: ${borrador.editado_nombre}` : ''}
            {borrador.enviado_ts ? ` · enviado al cliente ${horaLarga(borrador.enviado_ts)}` : ''}
          </div>
        )}
      </div>

      {motivoBloqueo && <div className="crm-bloqueo">{motivoBloqueo}</div>}
      {editable && <Buscador conv={conv} onElegir={agregar} deshabilitado={ocupado} />}

      {aviso && (
        <div className={`crm-aviso crm-aviso-${aviso.tipo}`} role="status">
          {aviso.texto}<button className="crm-aviso-x" onClick={() => setAviso(null)} aria-label="Cerrar aviso">×</button>
        </div>
      )}

      <div className="crm-renglones">
        {!items.length && <div className="crm-muted crm-pad">{borrador ? 'El ticket no tiene productos.' : 'Todavía no hay un ticket en armado.'}</div>}
        {items.map((r) => (
          <div key={r.id_producto} className="crm-renglon">
            <div className="crm-renglon-desc">
              <div>{r.descripcion}</div>
              <div className="crm-muted crm-chico crm-mono">
                {r.codigo} · {pesos(r.precio_unitario)} c/u{r.motivo && r.motivo !== 'lista' ? ` · ${r.motivo}` : ''}
              </div>
            </div>
            {editable
              ? <Cantidad valor={r.cantidad} deshabilitado={ocupado}
                  onCambiar={(n) => guardarItems(n > 0 ? items.map((x) => (x.id_producto === r.id_producto ? { ...x, cantidad: n } : x)) : items.filter((x) => x.id_producto !== r.id_producto))} />
              : <span className="crm-mono">{cant(r.cantidad)}</span>}
            <span className="crm-mono crm-renglon-sub">{pesos(r.subtotal)}</span>
            {editable && (
              <button className="crm-icono crm-icono-chico" title="Quitar" disabled={ocupado}
                onClick={() => guardarItems(items.filter((x) => x.id_producto !== r.id_producto))}>✕</button>
            )}
          </div>
        ))}
      </div>

      {borrador && (
        <div className="crm-total">
          <span>Total</span><span className="crm-mono">{pesos(borrador.total)}</span>
        </div>
      )}
      <div className="crm-muted crm-chico">Los precios los calcula el servidor con la lista y las escalas vigentes.</div>

      {editable && borrador && items.length > 0 && !confirmando && (
        <div className="crm-ticket-botones">
          <button className="crm-btn" disabled={ocupado} onClick={() => llamar({ accion: 'enviar', version: borrador.version }, 'Se le mandó el resumen al cliente.')}>
            Enviar al cliente para confirmar
          </button>
          <button className="crm-btn crm-btn-primario" disabled={ocupado} onClick={() => setConfirmando(true)}>Confirmar pedido</button>
          <button className="crm-btn crm-btn-peligro" disabled={ocupado}
            onClick={() => { if (window.confirm('¿Cancelar el ticket?')) llamar({ accion: 'cancelar', version: borrador.version }, 'Ticket cancelado.') }}>
            Cancelar ticket
          </button>
        </div>
      )}
      {editable && borrador && confirmando && (
        <div className="crm-confirmar">
          <div>¿Confirmar el pedido por <b>{pesos(borrador.total)}</b>? Se crea el pedido real{conv.demo ? ' (demo: no se crea nada real)' : ''} y se le avisa al cliente.</div>
          <div className="crm-ticket-botones">
            <button className="crm-btn" disabled={ocupado} onClick={() => setConfirmando(false)}>Volver</button>
            <button className="crm-btn crm-btn-primario" disabled={ocupado}
              onClick={async () => { await llamar({ accion: 'confirmar', version: borrador.version }, (r) => `Pedido N° ${r.numero_pedido} confirmado.`); setConfirmando(false) }}>
              Sí, confirmar
            </button>
          </div>
        </div>
      )}
      {editable && !borrador && (
        <div className="crm-muted crm-chico">Buscá un producto para empezar un ticket nuevo.</div>
      )}
    </div>
  )
}
