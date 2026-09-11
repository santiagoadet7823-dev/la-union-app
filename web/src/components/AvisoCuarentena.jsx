import { useCallback, useEffect, useState } from 'react'
import { sx } from '../lib/sx'
import { cuarentenaMutaciones } from '../services/sync/writeQueue'

/**
 * LO QUE LA COLA NO PUDO SUBIR, DICHO EN LA PANTALLA DONDE IMPORTA.
 *
 * 🩸 POR QUÉ EXISTE (11/09/2026). `writeQueue` aísla desde agosto las mutaciones que no van a entrar
 * nunca, y su propio comentario avisa que "no alcanza con aislar: hay que **verlo**". Pero el único
 * lugar que lo mostraba era `EstadoCatalogo` — o sea el catálogo. Una anulación de pedido aislada no
 * aparecía en ningún lado.
 *
 * Y eso es exactamente lo que pasó: el 11/09 una anulación quedó trabada contra el trigger de
 * pedidos ya facturados, la cola se tapó, y **los borrados que venían detrás nunca salieron**. La
 * pantalla decía "Pedido borrado definitivamente" y en el servidor no hubo un solo DELETE. Nadie
 * tenía un número que mirar: el bug duró desde las 17:44 hasta que alguien revisó los logs.
 *
 * 🔴 LO QUE ESTE CARTEL NO HACE ES DESAPARECER SOLO. Se queda hasta que alguien mire qué pasó y
 * decida. Una cola que se cura sola y en silencio sigue siendo una cola que miente, sólo que más
 * rápido — y acá lo que quedó afuera es un pedido de alguien, no un reintento perdido.
 *
 * props: { tabla?: string }  — `tabla` acota el aviso a una sola (p. ej. 'pedidos'); sin ella, todas.
 */
export default function AvisoCuarentena({ tabla = null }) {
  const [items, setItems] = useState([])
  const [abierto, setAbierto] = useState(false)

  const releer = useCallback(() => {
    cuarentenaMutaciones()
      .then((c) => setItems((c || []).filter((m) => !tabla || m.table === tabla)))
      .catch(() => {})
  }, [tabla])

  useEffect(() => {
    // Es localStorage del dispositivo: no hay a quién suscribirse, se relee cada tanto y al volver
    // a la pestaña. Barato — es leer un array de un storage.
    releer()
    const i = setInterval(releer, 30000)
    document.addEventListener('visibilitychange', releer)
    return () => {
      clearInterval(i)
      document.removeEventListener('visibilitychange', releer)
    }
  }, [releer])

  if (!items.length) return null

  return (
    <div
      style={sx('margin-bottom:12px;padding:11px 13px;border:1px solid var(--danger);border-radius:var(--r-lg);background:var(--surface);font-size:12.5px;line-height:1.55')}
    >
      <div style={sx('color:var(--danger);font-weight:700;margin-bottom:3px')}>
        {items.length === 1
          ? 'Hay 1 cambio que no se pudo guardar'
          : `Hay ${items.length} cambios que no se pudieron guardar`}
      </div>
      <div style={sx('color:var(--muted)')}>
        Quedaron apartados para que el resto siguiera subiendo. <b>No se perdieron</b>, pero
        tampoco se aplicaron: lo que se ve en pantalla es lo que hay en la base.
      </div>

      <button
        onClick={() => setAbierto((v) => !v)}
        style={sx('margin-top:6px;padding:0;border:none;background:transparent;color:var(--primary);font-size:12px;font-weight:600;cursor:pointer')}
      >
        {abierto ? 'Ocultar el detalle' : 'Ver qué fue'}
      </button>

      {abierto && (
        <div style={sx('margin-top:7px;padding-top:7px;border-top:1px solid var(--line)')}>
          {items.map((m, i) => (
            <div key={m.op_uid || i} style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--muted);padding:3px 0')}>
              <b>{m.op}</b> en <b>{m.table}</b>
              {m.id ? ` · ${String(m.id).slice(0, 8)}…` : ''}
              {/* El motivo es el que guardó `aislar()`: código y mensaje crudos de Postgres. Se
                  muestran tal cual a propósito — quien tiene que entender esto es quien va a poder
                  arreglarlo, y traducirlo a "hubo un problema" le saca justo el dato que sirve. */}
              <div style={sx('color:var(--danger)')}>{m._motivo || 'sin motivo registrado'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
