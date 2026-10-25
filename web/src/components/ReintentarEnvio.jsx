import { useState } from 'react'
import { sx } from '../lib/sx'
import { reintentarCuarentena } from '../services/sync/rescate'

/**
 * "REINTENTAR ENVÍO" — lo que la cuarentena del teléfono no tenía (25/10/2026, plan 23).
 *
 * El cartel de "con problema" solo decía "avisá a tu encargado": el vendedor no podía hacer nada, y
 * el rescate automático (`rescatarPedidos`) corre una vez por arranque y solo para ciertos motivos.
 * Esto lo vuelve a mandar cuando una PERSONA lo decide (por ejemplo, después de que se arregló la
 * causa en el servidor). Nada se borra: lo que rebota otra vez vuelve a la cuarentena y se ve.
 *
 * props: { filtro?: (mutacion) => boolean, alTerminar?: () => void }
 */
export default function ReintentarEnvio({ filtro, alTerminar }) {
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)

  const reintentar = async () => {
    setEnviando(true)
    setResultado(null)
    try {
      const { vuelven, quedan, enCola } = await reintentarCuarentena(filtro)
      if (!vuelven) setResultado('No había nada para reintentar.')
      else if (enCola) setResultado('Sin señal: quedaron en la cola y se mandan solos cuando vuelva.')
      else setResultado(quedan ? `${quedan} siguen con problema · avisá a tu encargado` : '✓ Se enviaron')
    } catch (_) {
      setResultado('No se pudo reintentar. Probá de nuevo con señal.')
    } finally {
      setEnviando(false)
      alTerminar?.()
    }
  }

  return (
    <div style={sx('margin-top:7px;display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
      <button
        onClick={reintentar}
        disabled={enviando}
        style={sx(`padding:6px 12px;border:1px solid var(--danger);border-radius:8px;background:var(--surface);color:var(--danger);font-size:12px;font-weight:700;cursor:pointer;opacity:${enviando ? 0.6 : 1}`)}
      >
        {enviando ? 'Enviando…' : 'Reintentar envío'}
      </button>
      {resultado && <span style={sx('font-size:11.5px;color:var(--text)')}>{resultado}</span>}
    </div>
  )
}
