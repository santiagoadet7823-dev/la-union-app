import { useState } from 'react'
import { funcion, horaLarga, textoError } from './datos'
import { cant, nombreLindo, pesos, SITUACION } from './mensajes'

const resumenItems = (o) => (o.items || []).slice(0, 4).map((i) => `${cant(i.cantidad)} × ${nombreLindo(i.descripcion)}`).join(' · ')
  + ((o.items || []).length > 4 ? ` · y ${o.items.length - 4} más` : '')

/**
 * Pedidos del cliente en 3 bloques (rediseño): abiertos del ARM (editar / anular), tomados por un
 * vendedor (solo lectura) y ya exportados al ERP (bloqueados, con su situación y "Avisar al cliente").
 * La situación la calcula la base (`crm_pedidos_cliente`, db/108).
 */
export default function Pedidos({ conv, cliente, pedidos, cargando, editable, puedeMandar, motivoNoMandar, onEditar, onPrecargar, onToast, onRecargar }) {
  const [anulando, setAnulando] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null)

  if (!cliente && !pedidos.length) {
    return <div className="crm-vacio-chico crm-pad">Vinculá el cliente de la base para ver sus pedidos.</div>
  }

  const arm = pedidos.filter((o) => o.situacion === 'abierto' && o.origen === 'whatsapp')
  const vend = pedidos.filter((o) => o.situacion === 'abierto' && o.origen !== 'whatsapp')
  const erp = pedidos.filter((o) => SITUACION[o.situacion])

  async function anular(o) {
    setOcupado(true)
    const r = await funcion('crm-ticket', { accion: 'pedido_anular', conversacion: conv.id, id_pedido: o.id })
    setOcupado(false)
    setAnulando(null)
    if (r.ok) onToast(`Pedido N° ${r.numero} anulado.`)
    else setAviso(textoError(r))
    onRecargar()
  }

  return (
    <div className="crm-pedidos">
      {aviso && <div className="crm-aviso crm-aviso-error" role="status">{aviso}<button className="crm-aviso-x" onClick={() => setAviso(null)} aria-label="Cerrar aviso">×</button></div>}
      {cargando && !pedidos.length && <div className="crm-muted crm-chico">Cargando pedidos…</div>}

      <section className="crm-bloque">
        <div className="crm-bloque-titulo"><span>Abiertos del ARM</span><span className="crm-mono">{arm.length}</span><em>· se pueden editar o anular</em></div>
        {arm.map((o) => (
          <div key={o.id} className="crm-pedido-tarjeta">
            <div className="crm-pedido-cabeza">
              <b className="crm-mono">N° {o.numero}</b>
              <span className="crm-etq crm-etq-primario">{o.demo ? 'Demostración' : 'Abierto · ARM'}</span>
              <div className="crm-espacio" />
              <b className="crm-mono">{pesos(o.monto_total)}</b>
            </div>
            <div className="crm-muted crm-chico">{horaLarga(o.created_at)} · {(o.items || []).length} productos · armado en el ARM</div>
            <div className="crm-chico">{resumenItems(o)}</div>
            {o.editable_arm ? (
              anulando === o.id ? (
                <div className="crm-aviso-fila crm-aviso-error">
                  <span>¿Anular el pedido N° {o.numero}? No se puede deshacer.</span>
                  <button className="crm-btn crm-btn-chico" onClick={() => setAnulando(null)}>Volver</button>
                  <button className="crm-btn crm-btn-chico crm-btn-rojo" disabled={ocupado} onClick={() => anular(o)}>Sí, anular</button>
                </div>
              ) : (
                <div className="crm-ticket-botones">
                  <button className="crm-btn crm-btn-chico crm-btn-tinte" disabled={!editable} onClick={() => onEditar(o)}>Editar en el carrito</button>
                  <button className="crm-btn crm-btn-chico crm-btn-peligro" disabled={!editable} onClick={() => setAnulando(o.id)}>Anular</button>
                </div>
              )
            ) : o.motivo_bloqueo && <div className="crm-muted crm-chico">🔒 {o.motivo_bloqueo}</div>}
          </div>
        ))}
        {!arm.length && <div className="crm-muted crm-chico">No hay pedidos abiertos del ARM.</div>}
      </section>

      <section className="crm-bloque">
        <div className="crm-bloque-titulo"><span>Tomados por un vendedor</span><span className="crm-mono">{vend.length}</span><em>· solo lectura</em></div>
        {vend.map((o) => (
          <div key={o.id} className="crm-pedido-tarjeta crm-pedido-ajeno">
            <div className="crm-pedido-franja">🔒 Tomado por {o.vendedor_nombre || 'un vendedor'}, corregilo desde la app</div>
            <div className="crm-pedido-cabeza"><b className="crm-mono">N° {o.numero}</b><div className="crm-espacio" /><b className="crm-mono">{pesos(o.monto_total)}</b></div>
            <div className="crm-muted crm-chico">{horaLarga(o.created_at)} · {(o.items || []).length} productos</div>
          </div>
        ))}
        {!vend.length && <div className="crm-muted crm-chico">Ninguno.</div>}
      </section>

      <section className="crm-bloque">
        <div className="crm-bloque-titulo"><span>Ya exportados al ERP</span><span className="crm-mono">{erp.length}</span><em>· bloqueados · últimos 30 días</em></div>
        {erp.map((o) => {
          const s = SITUACION[o.situacion]
          return (
            <div key={o.id} className="crm-pedido-erp">
              <b className="crm-mono">N° {o.numero}</b>
              <span className={`crm-etq crm-etq-${s.clase}`}>{o.situacion === 'en_camino' && o.repartidor_nombre ? `🚚 En camino con ${o.repartidor_nombre}` : s.t}</span>
              <span className="crm-chico">{horaLarga(o.ts_entregado || o.ts_en_camino || o.created_at)}</span>
              <div className="crm-espacio" />
              <b className="crm-mono">{pesos(o.monto_total)}</b>
              <button className="crm-btn crm-btn-chico" disabled={!puedeMandar} title={puedeMandar ? 'Precarga el aviso en el chat' : motivoNoMandar}
                onClick={() => onPrecargar(s.msg(o), 'Pedidos')}>💬 Avisar al cliente</button>
            </div>
          )
        })}
        {!erp.length && <div className="crm-muted crm-chico">Ninguno en los últimos 30 días.</div>}
      </section>
    </div>
  )
}
