import { useEffect, useState } from 'react'
import { funcion, textoError, horaLarga } from './datos'
import { cant, msgResumen, nombreLindo, pesos } from './mensajes'

const MOTIVO = { lista: ['Lista', ''], oferta: ['Oferta', 'aviso'], escala: ['Escala', 'info'] }

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

/**
 * Carrito del cliente (el ticket en borrador) y, cuando se toca "Editar en el carrito" en Pedidos,
 * la edición de un pedido abierto del ARM. Precios siempre del servidor (`crm-ticket`).
 */
export default function Carrito({
  conv, ticket, setTicket, editable, cliente, armAbierto, edicion, setEdicion,
  onIrCliente, onIrCatalogo, onPrecargar, onToast, onPedidosCambio,
}) {
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [confirmando, setConfirmando] = useState(false)
  const [destino, setDestino] = useState('pedido')

  const borrador = ticket?.estado === 'borrador' ? ticket : null
  const editando = edicion?.pedido || null
  const items = editando ? edicion.items : (borrador?.items || [])
  const total = items.reduce((s, r) => s + Number(r.subtotal || 0), 0)
  const sumarA = !editando && armAbierto && destino === 'pedido' ? armAbierto : null

  useEffect(() => { setConfirmando(false); setAviso(null) }, [editando?.id, conv.id])

  async function llamar(cuerpo) {
    setOcupado(true)
    setAviso(null)
    const r = await funcion('crm-ticket', { conversacion: conv.id, ...cuerpo })
    setOcupado(false)
    if (r.ticket !== undefined) setTicket(r.ticket)
    if (!r.ok) setAviso(textoError(r))
    return r
  }

  const guardarItems = (nuevos) => llamar({
    accion: 'guardar', version: borrador?.version ?? null,
    items: nuevos.map((r) => ({ id_producto: r.id_producto, cantidad: r.cantidad })),
  })

  function cambiarCantidad(r, n) {
    if (editando) {
      setEdicion((e) => ({
        ...e, cambiado: true,
        items: n > 0 ? e.items.map((x) => (x.id_producto === r.id_producto ? { ...x, cantidad: n, subtotal: Math.round(n * x.precio_unitario * 100) / 100, motivo: 'recalcular' } : x))
          : e.items.filter((x) => x.id_producto !== r.id_producto),
      }))
      return
    }
    guardarItems(n > 0 ? items.map((x) => (x.id_producto === r.id_producto ? { ...x, cantidad: n } : x)) : items.filter((x) => x.id_producto !== r.id_producto))
  }

  async function confirmar() {
    if (editando) {
      setOcupado(true)
      const r = await funcion('crm-ticket', {
        accion: 'pedido_guardar', conversacion: conv.id, id_pedido: editando.id, token: editando.token,
        items: items.map((x) => ({ id_producto: x.id_producto, cantidad: x.cantidad })),
      })
      setOcupado(false)
      setConfirmando(false)
      if (!r.ok) { setAviso(textoError(r)); onPedidosCambio(); return }
      onToast(`Pedido N° ${r.numero} actualizado (${pesos(r.total)}).`)
      setEdicion(null)
      onPedidosCambio('pedidos')
      return
    }
    const r = sumarA
      ? await llamar({ accion: 'sumar_a_pedido', version: borrador.version, id_pedido: sumarA.id, token: sumarA.token })
      : await llamar({ accion: 'confirmar', version: borrador.version })
    setConfirmando(false)
    if (r.ok) {
      onToast(sumarA ? `Sumado al pedido N° ${r.numero_pedido}.` : `Pedido N° ${r.numero_pedido} confirmado.`)
      onPedidosCambio('pedidos')
    }
  }

  const sinCliente = !cliente
  const sinClienteAviso = !cliente
  const titulo = editando ? `Editando pedido N° ${editando.numero}` : `Carrito de ${conv.contacto?.nombre_perfil || 'este contacto'}`
  const origen = editando ? `Abierto en el ARM · ${horaLarga(editando.created_at)} · los cambios se guardan en el pedido`
    : borrador ? `${borrador.creado_por_bot ? 'Lo armó el bot' : 'Armado en el ARM'}${borrador.editado_nombre ? ` · última edición: ${borrador.editado_nombre}` : ''}${borrador.enviado_ts ? ` · enviado al cliente ${horaLarga(borrador.enviado_ts)}` : ''}`
      : 'Sin productos todavía'

  return (
    <div className="crm-carrito">
      {ticket && !borrador && !editando && (
        <div className={`crm-ticket-cerrado ${ticket.estado === 'confirmado' ? 'crm-ok' : ''}`}>
          {ticket.estado === 'confirmado'
            ? <>✅ Último pedido: N° <b>{ticket.numero_pedido}</b> confirmado {ticket.confirmado_ts ? `el ${horaLarga(ticket.confirmado_ts)}` : ''} por {pesos(ticket.total)}{ticket.editado_nombre ? ` · ${ticket.editado_nombre}` : ''}</>
            : <>Último carrito vaciado{ticket.editado_nombre ? ` por ${ticket.editado_nombre}` : ''}.</>}
        </div>
      )}

      <div className="crm-carrito-cabeza">
        <div>
          <div className="crm-carrito-titulo">{titulo}</div>
          <div className="crm-muted crm-chico">{origen}</div>
        </div>
        {editando && <button className="crm-btn crm-btn-chico" onClick={() => setEdicion(null)}>Volver al carrito</button>}
      </div>

      {!editando && armAbierto && items.length > 0 && (
        <div className="crm-destino">
          <div>Este cliente tiene abierto el pedido <b className="crm-mono">N° {armAbierto.numero}</b> del ARM ({horaLarga(armAbierto.created_at)} · {pesos(armAbierto.monto_total)}).</div>
          <div className="crm-segmento">
            <button data-activa={destino === 'pedido'} onClick={() => setDestino('pedido')}>Sumar a ese pedido</button>
            <button data-activa={destino === 'nuevo'} onClick={() => setDestino('nuevo')}>Crear uno nuevo</button>
          </div>
        </div>
      )}

      {aviso && <div className="crm-aviso crm-aviso-error" role="status">{aviso}<button className="crm-aviso-x" onClick={() => setAviso(null)} aria-label="Cerrar aviso">×</button></div>}

      <div className="crm-lineas">
        {items.map((r) => {
          const [mot, clase] = r.motivo === 'recalcular' ? ['Se recalcula al guardar', 'aviso'] : (MOTIVO[r.motivo] || ['Precio guardado', ''])
          return (
            <div key={r.id_producto || r.codigo || r.descripcion} className="crm-linea">
              <div className="crm-linea-desc">
                <b>{nombreLindo(r.descripcion)}</b>
                <div className="crm-linea-meta">
                  <span className="crm-mono crm-faint">{r.codigo}</span>
                  <span className="crm-mono crm-muted">{pesos(r.precio_unitario)} c/u</span>
                  <span className={`crm-etq ${clase ? `crm-etq-${clase}` : ''}`}>{mot}</span>
                </div>
              </div>
              {editable ? <Cantidad valor={r.cantidad} deshabilitado={ocupado} onCambiar={(n) => cambiarCantidad(r, n)} />
                : <span className="crm-mono"><b>{cant(r.cantidad)}</b></span>}
              <span className="crm-mono crm-linea-sub">{pesos(r.subtotal)}</span>
              <button className="crm-icono crm-icono-chico" title="Quitar" disabled={!editable || ocupado} onClick={() => cambiarCantidad(r, 0)}>✕</button>
            </div>
          )
        })}
        {!items.length && (
          <div className="crm-vacio-chico">
            <span>{editando ? 'El pedido quedó sin productos: agregá alguno o anulalo desde Pedidos.' : 'El carrito está vacío.'}</span>
            <button className="crm-btn crm-btn-chico" onClick={onIrCatalogo}>Abrir el catálogo</button>
          </div>
        )}
      </div>

      {items.length > 0 && <div className="crm-total"><span>Total</span><span className="crm-mono">{pesos(total)}</span></div>}
      <div className="crm-muted crm-chico">Los precios los calcula el servidor con la lista, las ofertas y las escalas vigentes.</div>

      {sinClienteAviso && !editando && (
        <div className="crm-aviso-fila crm-aviso-aviso">
          <span><b>Falta vincular el cliente de la base.</b> Sin eso no se puede confirmar.</span>
          <button className="crm-btn crm-btn-chico crm-btn-aviso" onClick={onIrCliente}>Vincular</button>
        </div>
      )}

      {editable && items.length > 0 && !confirmando && (
        <div className="crm-ticket-botones">
          {!editando && <button className="crm-btn" onClick={() => onPrecargar(msgResumen(items, total), 'el carrito')}>💬 Enviar resumen al cliente</button>}
          <button className="crm-btn crm-btn-primario" disabled={ocupado || (sinCliente && !editando) || (editando && !edicion.cambiado)} onClick={() => setConfirmando(true)}>
            {editando ? 'Guardar cambios' : sumarA ? `Sumar al pedido N° ${sumarA.numero}` : 'Confirmar pedido'}
          </button>
          <div className="crm-espacio" />
          <button className="crm-btn crm-btn-peligro" disabled={ocupado}
            onClick={() => { if (editando) setEdicion(null); else if (window.confirm('¿Vaciar el carrito?')) llamar({ accion: 'cancelar', version: borrador.version }).then((r) => r.ok && onToast('Carrito vaciado.')) }}>
            {editando ? 'Descartar cambios' : 'Vaciar carrito'}
          </button>
        </div>
      )}

      {confirmando && (
        <div className="crm-confirmar">
          <div>
            {editando ? `¿Guardar los cambios del pedido N° ${editando.numero}? Queda en ${pesos(total)} (el servidor recalcula los precios).`
              : sumarA ? `¿Sumar ${items.length} productos (${pesos(total)}) al pedido N° ${sumarA.numero}? El pedido queda en ${pesos(Number(sumarA.monto_total) + total)}.`
                : `¿Confirmar el pedido por ${pesos(total)}${cliente ? ` para ${cliente.nombre_comercio}` : ''}? ${conv.demo ? 'Es una demostración: no se crea nada real.' : 'Se crea el pedido real y se le avisa al cliente.'}`}
          </div>
          <div className="crm-ticket-botones">
            <button className="crm-btn" onClick={() => setConfirmando(false)}>Volver</button>
            <button className="crm-btn crm-btn-primario" disabled={ocupado} onClick={confirmar}>{ocupado ? 'Guardando…' : 'Sí, confirmar'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
