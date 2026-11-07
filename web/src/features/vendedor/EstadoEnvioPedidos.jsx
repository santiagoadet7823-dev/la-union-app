import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import {
  EVENTO_CUARENTENA, EVENTO_PEDIDO_NUMERADO, cuarentenaMutaciones, pendientesDe, descartarDeCuarentena,
} from '../../services/sync/writeQueue'
import { esPedidoDe } from '../../services/sync/rescate'
import ReintentarEnvio from '../../components/ReintentarEnvio'

/**
 * ¿LLEGARON MIS PEDIDOS? — el renglón que le faltaba al vendedor (22/10/2026, plan 19).
 *
 * 🩸 En la calle el contador de Inicio seguía sumando mientras pedidos reales quedaban aislados en
 * la cuarentena del teléfono: el vendedor no tenía NINGUNA forma de ver la diferencia (el aviso de
 * cuarentena existía, pero solo en las pantallas de gestión). Ahora lo ve acá, con dos números:
 *  · sin subir = en la cola, esperando señal: normal, se manda solo.
 *  · con problema = en cuarentena: el servidor lo rechazó y NO se va a mandar solo. Hay que avisar.
 * Solo cuenta lo de ESTA cuenta (un teléfono compartido no le muestra a uno los pedidos del otro).
 */
const esPedidoMio = (m, userId) =>
  m?.table === 'pedidos' && ((m.payload || m.args?.p_pedido || {}).id_vendedor === userId)

/**
 * 🩸 UNA CORRECCIÓN QUE LLEGÓ TARDE (07/11/2026, plan 39). Sin señal, la corrección queda en la cola;
 * si en el medio La Unión bajó el pedido a su sistema, la base la rechaza (`pedido-ya-exportado`,
 * db/62) y va a cuarentena. `esPedidoMio` no la ve —la cabecera de una corrección no lleva
 * `id_vendedor`—, así que el vendedor no se enteraba nunca. Son las mutaciones de `editarPedido.js`
 * (su `op_uid` lleva `:editar:`, `:quitar:`, `:sumar:` o `:totales:`); cada corrección deja UNA
 * `:totales:`, que es la que se cuenta. Reintentarlas no sirve: van a rebotar siempre.
 */
const esCorreccionDescargada = (m) =>
  String(m?._motivo || '').includes('pedido-ya-exportado') &&
  /:(editar|quitar|sumar|totales):/.test(String(m?.op_uid || ''))

export default function EstadoEnvioPedidos({ userId, hayPedidos }) {
  const [estado, setEstado] = useState({ sinSubir: 0, conProblema: 0, correccionesTarde: 0, leido: false })
  const [vuelta, setVuelta] = useState(0) // para releer después de "Entendido"

  useEffect(() => {
    if (!userId) return
    let vivo = true
    const leer = async () => {
      try {
        const [enCola, cuar] = await Promise.all([pendientesDe('pedidos'), cuarentenaMutaciones()])
        if (!vivo) return
        setEstado({
          sinSubir: enCola.filter((p) => p?.id_vendedor === userId).length,
          conProblema: (cuar || []).filter((m) => esPedidoMio(m, userId)).length,
          correccionesTarde: (cuar || []).filter((m) => esCorreccionDescargada(m) && String(m.op_uid).includes(':totales:')).length,
          leido: true,
        })
      } catch (_) { /* si no se puede leer, no se muestra nada: mejor que un número inventado */ }
    }
    leer()
    const iv = setInterval(leer, 10000)
    const alVolver = () => { if (document.visibilityState === 'visible') leer() }
    window.addEventListener(EVENTO_PEDIDO_NUMERADO, leer)
    window.addEventListener(EVENTO_CUARENTENA, leer)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      vivo = false
      clearInterval(iv)
      window.removeEventListener(EVENTO_PEDIDO_NUMERADO, leer)
      window.removeEventListener(EVENTO_CUARENTENA, leer)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [userId, vuelta])

  if (!estado.leido) return null
  const { sinSubir, conProblema, correccionesTarde } = estado
  const avisoCorrecciones = correccionesTarde > 0 && (
    <div style={sx('padding:7px 10px;border:1px solid var(--danger);background:var(--danger-tint);border-radius:10px;font-size:11.5px;line-height:1.4;color:var(--text)')}>
      <b style={sx('color:var(--danger)')}>
        {correccionesTarde === 1 ? 'Una corrección no se guardó' : `${correccionesTarde} correcciones no se guardaron`}
      </b>{' '}
      · el pedido ya se había descargado al sistema de gestión antes de que llegara. Lo que le
      agregaste cargalo en un <b>ticket nuevo</b>; lo que restaste, avisale a administración.
      <button
        onClick={async () => { await descartarDeCuarentena(esCorreccionDescargada).catch(() => {}); setVuelta((n) => n + 1) }}
        className="lu-press"
        style={sx('display:block;margin-top:6px;padding:5px 10px;border:1px solid var(--line2);border-radius:8px;background:var(--surface);color:var(--text);font-size:11.5px;font-weight:600;cursor:pointer')}
      >
        Entendido
      </button>
    </div>
  )
  if (!sinSubir && !conProblema) {
    if (avisoCorrecciones) return <div style={sx('margin-top:10px')}>{avisoCorrecciones}</div>
    if (!hayPedidos) return null
    return (
      <div style={sx('margin-top:10px;font-size:11.5px;color:var(--success);font-weight:600')}>
        ✓ Todos tus pedidos llegaron al servidor
      </div>
    )
  }
  return (
    <div style={sx('margin-top:10px;display:flex;flex-direction:column;gap:6px')}>
      {sinSubir > 0 && (
        <div style={sx('padding:7px 10px;border:1px solid var(--warning);background:var(--warning-tint);border-radius:10px;font-size:11.5px;line-height:1.4')}>
          <b>{sinSubir} {sinSubir === 1 ? 'pedido sin subir' : 'pedidos sin subir'}</b> · se
          {sinSubir === 1 ? ' manda' : ' mandan'} solo{sinSubir === 1 ? '' : 's'} cuando haya señal.
        </div>
      )}
      {conProblema > 0 && (
        <div style={sx('padding:7px 10px;border:1px solid var(--danger);background:var(--danger-tint);border-radius:10px;font-size:11.5px;line-height:1.4;color:var(--danger)')}>
          <b>{conProblema} {conProblema === 1 ? 'pedido con problema' : 'pedidos con problema'}</b> · no
          {conProblema === 1 ? ' llegó' : ' llegaron'} al servidor. Avisá a tu encargado: están guardados
          en este teléfono y se pueden recuperar.
          {/* Pedidos, renglones y visitas de esta cuenta: un pedido sin su visita rebota (23503). */}
          <ReintentarEnvio filtro={esPedidoDe(userId)} />
        </div>
      )}
      {avisoCorrecciones}
    </div>
  )
}
