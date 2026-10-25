import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import {
  EVENTO_CUARENTENA, EVENTO_PEDIDO_NUMERADO, cuarentenaMutaciones, pendientesDe,
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

export default function EstadoEnvioPedidos({ userId, hayPedidos }) {
  const [estado, setEstado] = useState({ sinSubir: 0, conProblema: 0, leido: false })

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
  }, [userId])

  if (!estado.leido) return null
  const { sinSubir, conProblema } = estado
  if (!sinSubir && !conProblema) {
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
    </div>
  )
}
