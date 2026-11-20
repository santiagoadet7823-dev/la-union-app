import { useEffect, useState } from 'react'
import { funcion, rpc, textoError, useCliente, usePedidosCliente, useTicket } from './datos'
import { cant, nombreLindo, precioDe } from './mensajes'
import Catalogo from './Catalogo'
import Carrito from './Carrito'
import Pedidos from './Pedidos'
import Ficha from './Ficha'

const PESTANAS = [['catalogo', 'Catálogo'], ['carrito', 'Carrito'], ['pedidos', 'Pedidos'], ['cliente', 'Cliente']]

/**
 * Panel derecho del ARM (rediseño de Claude Design): franja con el cliente vinculado, pestañas
 * Catálogo · Carrito · Pedidos · Cliente, candado según quién tiene el control y aviso corto.
 * Lo que "se manda" desde acá nunca sale solo: `onPrecargar` lo deja en el cuadro del chat.
 */
export default function Panel({ conv, yo, soloVer, ventanaAbierta, tab, setTab, onPrecargar, onVolverChat, esMovil, onContexto }) {
  const { ticket, setTicket } = useTicket(conv.id)
  const idCliente = conv.contacto?.id_cliente || null
  const { cli, recargar: recargarCli } = useCliente(idCliente)
  const { pedidos, cargando: cargandoPed, recargar: recargarPed } = usePedidosCliente(conv.id, idCliente)
  const [edicion, setEdicion] = useState(null) // { pedido, items, cambiado }
  const [toast, setToast] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { setEdicion(null); setToast(null); setError(null) }, [conv.id])
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t) }, [toast])

  const mio = conv.asignada_a === yo.id
  const deOtro = !!conv.asignada_a && !mio
  const cerrada = conv.estado === 'cerrada'
  const editable = !soloVer && mio && !cerrada
  const puedeMandar = !soloVer && !cerrada && !deOtro && ventanaAbierta
  const motivoNoMandar = soloVer ? 'Modo demostración: solo lectura.' : cerrada ? 'La conversación está cerrada.'
    : deOtro ? `Lo está atendiendo ${conv.asignada_nombre}.` : 'Pasaron más de 24 h: solo se le puede escribir con una plantilla aprobada.'

  let candado = ''
  if (soloVer) candado = 'Modo demostración: solo lectura.'
  else if (cerrada) candado = 'La conversación está cerrada.'
  else if (deOtro) candado = `🔒 Lo controla ${conv.asignada_nombre}: solo esa persona edita el carrito. Podés mirar.`
  else if (!mio) candado = 'Tomá el control del chat para editar el carrito.'
  const motivoNoAgregar = candado || ''

  const borrador = ticket?.estado === 'borrador' ? ticket : null
  const items = edicion ? edicion.items : (borrador?.items || [])
  const enCarrito = Object.fromEntries(items.map((r) => [r.id_producto, Number(r.cantidad)]))
  const total = items.reduce((s, r) => s + Number(r.subtotal || 0), 0)
  const armAbierto = pedidos.find((o) => o.editable_arm) || null
  const nPedidos = pedidos.filter((o) => o.situacion === 'abierto').length

  // Lo que el chat necesita para las respuestas sugeridas (⚡).
  useEffect(() => { onContexto?.({ cliente: cli, items, total, pedidos }) }, [cli, ticket, edicion, pedidos]) // eslint-disable-line react-hooks/exhaustive-deps

  const precargar = (texto, origen) => { onPrecargar(texto, origen); setToast({ texto: 'Mensaje listo en el cuadro de respuesta del chat.', chat: esMovil }) }

  async function agregar(adds) {
    const validos = adds.filter((a) => a.cantidad > 0)
    if (!validos.length) return
    const txt = 'Sumado: ' + validos.map((a) => `${nombreLindo(a.producto.descripcion)} × ${cant(a.cantidad)}`).join(' · ')
    if (edicion) {
      setEdicion((e) => {
        const m = new Map(e.items.map((x) => [x.id_producto, { ...x }]))
        for (const a of validos) {
          const ya = m.get(a.producto.id)
          const q = (ya ? Number(ya.cantidad) : 0) + a.cantidad
          const pr = precioDe(a.producto, q)
          m.set(a.producto.id, {
            id_producto: a.producto.id, codigo: a.producto.codigo, descripcion: a.producto.descripcion,
            cantidad: q, precio_unitario: pr.precio, subtotal: Math.round(pr.precio * q * 100) / 100, motivo: 'recalcular',
          })
        }
        return { ...e, items: [...m.values()], cambiado: true }
      })
      setToast({ texto: `${txt} (al pedido N° ${edicion.pedido.numero}: falta guardar)` })
      return
    }
    const m = new Map(items.map((x) => [x.id_producto, Number(x.cantidad)]))
    for (const a of validos) m.set(a.producto.id, (m.get(a.producto.id) || 0) + a.cantidad)
    const r = await funcion('crm-ticket', {
      accion: 'guardar', conversacion: conv.id, version: borrador?.version ?? null,
      items: [...m.entries()].map(([id_producto, cantidad]) => ({ id_producto, cantidad })),
    })
    if (r.ticket !== undefined) setTicket(r.ticket)
    if (r.ok) setToast({ texto: `${txt} al carrito.` })
    else setError(textoError(r))
  }

  async function tomar() {
    const r = await rpc('crm_tomar', { p_conv: conv.id, p_forzar: false })
    if (!r.ok) setError(r.error ? textoError(r) : `Ya lo tomó ${r.asignada_nombre || 'otra persona'}.`)
  }

  const editarPedido = (o) => {
    setEdicion({ pedido: o, items: (o.items || []).map((i) => ({ ...i, cantidad: Number(i.cantidad), motivo: null })), cambiado: false })
    setTab('carrito')
  }

  return (
    <div className="crm-panel">
      <div className={`crm-panel-cliente ${cli ? 'crm-panel-cliente-ok' : 'crm-panel-cliente-falta'}`}>
        {esMovil && <button className="crm-link crm-link-fuerte" onClick={onVolverChat}>‹ Chat</button>}
        <b className="crm-elipsis">{cli ? `🏪 ${cli.nombre_comercio}` : idCliente ? 'Cargando cliente…' : 'Sin cliente vinculado'}</b>
        <span className="crm-elipsis crm-panel-cliente-sub">
          {cli ? [cli.codigo, cli.zona?.nombre, conv.contacto?.vinculo_origen === 'auto' ? 'por teléfono' : 'a mano'].filter(Boolean).join(' · ') : idCliente ? '' : 'no se puede confirmar'}
        </span>
        <div className="crm-espacio" />
        <button className="crm-link" onClick={() => setTab('cliente')}>{cli ? 'Ficha' : 'Vincular'}</button>
      </div>

      <div className="crm-pestanas crm-pestanas-panel">
        {PESTANAS.map(([k, t]) => {
          const n = k === 'carrito' ? items.length : k === 'pedidos' ? nPedidos : 0
          return <button key={k} data-activa={tab === k} onClick={() => setTab(k)}>{t}{n ? <span className="crm-cuenta">{n}</span> : null}</button>
        })}
      </div>

      {candado && (tab === 'catalogo' || tab === 'carrito') && (
        <div className="crm-candado">
          <span>{candado}</span>
          {!soloVer && !cerrada && !conv.asignada_a && <button className="crm-btn crm-btn-chico crm-btn-primario" onClick={tomar}>Tomar control</button>}
        </div>
      )}
      {toast && (
        <div className="crm-toast">
          <span>{toast.texto}</span>
          {toast.chat && <button className="crm-link crm-link-fuerte" onClick={onVolverChat}>Ir al chat</button>}
          <button className="crm-aviso-x-chica" onClick={() => setToast(null)} aria-label="Cerrar">×</button>
        </div>
      )}
      {error && <div className="crm-aviso crm-aviso-error">{error}<button className="crm-aviso-x" onClick={() => setError(null)} aria-label="Cerrar aviso">×</button></div>}

      {tab === 'catalogo' && (
        <Catalogo conv={conv} puedeMandar={puedeMandar} motivoNoMandar={motivoNoMandar} puedeAgregar={editable} motivoNoAgregar={motivoNoAgregar}
          enCarrito={enCarrito} onPrecargar={precargar} onAgregar={agregar}
          dock={{ n: items.length, total, editando: edicion?.pedido?.numero, cliente: cli?.nombre_comercio || conv.contacto?.nombre_perfil || 'este contacto', onVer: () => setTab('carrito') }} />
      )}
      {tab === 'carrito' && (
        <div className="crm-panel-scroll">
          <Carrito conv={conv} ticket={ticket} setTicket={setTicket} editable={editable} cliente={cli} armAbierto={armAbierto}
            edicion={edicion ? { ...edicion, items } : null} setEdicion={setEdicion}
            onIrCliente={() => setTab('cliente')} onIrCatalogo={() => setTab('catalogo')} onPrecargar={precargar}
            onToast={(t) => setToast({ texto: t })} onPedidosCambio={(t) => { recargarPed(); if (t) setTab(t) }} />
        </div>
      )}
      {tab === 'pedidos' && (
        <div className="crm-panel-scroll">
          <Pedidos conv={conv} cliente={cli} pedidos={pedidos} cargando={cargandoPed} editable={editable}
            puedeMandar={puedeMandar} motivoNoMandar={motivoNoMandar} onEditar={editarPedido} onPrecargar={precargar}
            onToast={(t) => setToast({ texto: t })} onRecargar={recargarPed} />
        </div>
      )}
      {tab === 'cliente' && (
        <div className="crm-panel-scroll">
          <Ficha conv={conv} cli={cli} recargarCli={() => { recargarCli(); recargarPed() }} soloVer={soloVer}
            puedeMandar={puedeMandar} onPrecargar={precargar} onToast={(t) => setToast({ texto: t })} />
        </div>
      )}
    </div>
  )
}
