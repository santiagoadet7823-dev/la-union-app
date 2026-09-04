import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import Overlay from '../../components/Overlay'
import { useCatalog } from '../../context/CatalogContext'
import { useGps } from '../../context/GpsContext'
import { precioPara } from '../../lib/precios'
import { anularPedido } from './anularPedido'
import { fmtFecha } from './DetallePedido'
import { editarPedido, nuevaLinea, totalesDeLineas } from './editarPedido'

/**
 * CORREGIR UN PEDIDO PENDIENTE.
 *
 * 🩸 POR QUÉ (03/09/2026). Lo pidieron el dueño y un vendedor en la reunión del 02/09: hoy, una vez
 * confirmado, el ticket no se puede tocar y el error se arregla anulando y rehaciendo todo.
 *
 * 🔑 LAS DOS ZONAS DE ESTA PANTALLA SON DOS REGLAS DISTINTAS, y por eso se ven distinto:
 *
 *  · **Lo que ya estaba** se puede RESTAR o QUITAR, nunca sumar, y muestra el precio con el que se
 *    pactó — con la fecha al lado. Si entre medio entró una lista nueva del ERP (entran varias por
 *    día), ese número no se mueve: `pedido_items.precio_unitario` está copiado en la fila y la
 *    edición manda sólo `cantidad`.
 *  · **Lo que se agrega hoy** va al precio de HOY, con su escalón por volumen si la cantidad lo
 *    alcanza — resuelto por `precioPara`, que es el único lugar de la app que sabe cuánto sale algo
 *    (regla 52).
 *
 * ⚠️ **Sumar de lo que ya estaba se hace agregándolo como línea nueva**, no subiendo el stepper de
 * la línea vieja. No es una limitación técnica: es la regla del cliente. Subir la vieja cobraría
 * unidades de hoy al precio de antes, que es exactamente lo que se quiso evitar. Si el comerciante
 * pide dos cajones más del mismo producto, entran como renglón aparte al precio de hoy — y el ticket
 * lo muestra en dos líneas, que es la verdad de lo que pasó.
 *
 * props: { pedido, lineas, onCerrar, onGuardado, onToast, userId }
 */

/** El stepper de una línea vieja: sólo baja. El "+" no existe acá a propósito (ver arriba). */
function StepperBaja({ valor, onCambio }) {
  const puedeBajar = valor > 0
  return (
    <div style={sx('display:flex;align-items:center;gap:2px;flex:none')}>
      <button
        onClick={() => onCambio(Math.max(0, valor - 1))}
        disabled={!puedeBajar}
        className="lu-press"
        aria-label="Quitar una unidad"
        style={{
          ...sx('width:32px;height:32px;display:grid;place-items:center;border-radius:9px;border:1px solid var(--line2);background:var(--surface2);font-size:17px;line-height:1'),
          color: puedeBajar ? 'var(--text)' : 'var(--faint)',
          cursor: puedeBajar ? 'pointer' : 'default',
        }}
      >−</button>
      <div style={sx('min-width:34px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:14px;font-weight:700')}>
        {valor}
      </div>
    </div>
  )
}

export default function EditarPedidoSheet({ pedido, lineas = [], onCerrar, onGuardado, onToast, userId }) {
  const { productos } = useCatalog()
  const { pos } = useGps()
  const [abierto, setAbierto] = useState(true)
  const [cantidades, setCantidades] = useState({})
  const [nuevas, setNuevas] = useState([])
  const [busca, setBusca] = useState('')
  const [motivo, setMotivo] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  // Al cambiar de pedido se limpia todo. Sin esto, lo tipeado para uno quedaría cargado al abrir el
  // siguiente — el mismo cuidado que ya tiene `DetallePedido` con el motivo de anulación.
  useEffect(() => { setCantidades({}); setNuevas([]); setBusca(''); setMotivo('') }, [pedido?.id])

  const cantidadDe = (l) => Math.max(0, Math.round(Number(cantidades[l.id] ?? l.cantidad) || 0))
  const finales = useMemo(
    () => [...lineas.map((l) => ({ ...l, cantidad: cantidadDe(l) })).filter((l) => l.cantidad > 0), ...nuevas],
    [lineas, cantidades, nuevas],
  )
  const { total } = totalesDeLineas(finales)
  const hayCambios =
    nuevas.length > 0 || lineas.some((l) => cantidadDe(l) !== Math.round(Number(l.cantidad) || 0))
  // Quitar la última línea no deja un pedido en $0: se anula, con motivo. Un pedido vacío y uno
  // anulado dirían lo mismo, pero el vacío no dice quién ni por qué.
  const quedaVacio = finales.length === 0

  // Los productos para agregar. Se busca sobre el catálogo VIGENTE (`productos` ya excluye los
  // descontinuados): ofrecer algo que salió de circulación sería cargarlo para que después no se
  // pueda entregar.
  const sugeridos = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (q.length < 2) return []
    return productos
      .filter((p) => (p.name || '').toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q))
      .slice(0, 20)
  }, [productos, busca])

  function agregar(producto) {
    setNuevas((arr) => {
      // Si ya se agregó en esta misma edición, se le suma una unidad al renglón nuevo y se
      // RECALCULA su precio: sigue siendo mercadería de hoy, así que si con la unidad de más entra
      // en un escalón por volumen, le corresponde ese precio.
      const i = arr.findIndex((n) => n.id_producto === producto.id)
      if (i === -1) return [...arr, nuevaLinea(producto, 1, pedido.id)]
      const copia = [...arr]
      const cant = copia[i].cantidad + 1
      copia[i] = { ...copia[i], ...nuevaLinea(producto, cant, pedido.id), id: copia[i].id }
      return copia
    })
  }

  function cambiarNueva(id, cantidad) {
    setNuevas((arr) => {
      if (cantidad <= 0) return arr.filter((n) => n.id !== id)
      return arr.map((n) => {
        if (n.id !== id) return n
        const producto = productos.find((p) => p.id === n.id_producto)
        // Sin el producto en el catálogo no se puede repreciar: se deja la cantidad y el precio que
        // ya tenía en vez de inventar uno.
        if (!producto) return { ...n, cantidad }
        return { ...n, ...nuevaLinea(producto, cantidad, pedido.id), id: n.id }
      })
    })
  }

  function cerrar() { setAbierto(false) }

  async function guardar() {
    setTrabajando(true)
    try {
      if (quedaVacio) {
        await anularPedido(pedido, motivo, userId)
        onToast?.(`Pedido ${pedido.numero ? '#' + pedido.numero : ''} anulado`)
      } else {
        await editarPedido({ pedido, lineas, cantidades, nuevas, userId, pos })
        onToast?.('Pedido corregido')
      }
      cerrar()
      // 🔴 La pantalla de arriba TIENE que releer. Un UPDATE que RLS rechaza —por ejemplo si el
      // repartidor pasó el pedido a "En camino" mientras esto estaba abierto— afecta cero filas y
      // vuelve con éxito. Lo que se muestre después sale de la base, no de acá.
      onGuardado?.()
    } catch (e) {
      onToast?.('No se pudo guardar: ' + (e?.message || 'sin conexión'))
    } finally { setTrabajando(false) }
  }

  const puedeGuardar = hayCambios && !trabajando && (!quedaVacio || motivo.trim().length > 0)

  return (
    <Overlay
      open={abierto}
      onClose={onCerrar}
      variant="sheet"
      alto="medio"
      title={`Corregir ${pedido?.numero ? '#' + pedido.numero : 'el pedido'}`}
      subtitle={pedido?.comercio?.name || 'Comercio'}
      footer={
        <div style={sx('display:flex;flex-direction:column;gap:9px;width:100%')}>
          <div style={sx('display:flex;align-items:baseline;justify-content:space-between')}>
            <span style={sx('font-size:12px;color:var(--muted)')}>Total</span>
            <span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:19px;font-weight:700')}>
              {fmtPesos(total)}
            </span>
          </div>

          {quedaVacio && (
            <>
              <div style={sx('font-size:11.5px;color:var(--warning);line-height:1.5')}>
                Sacaste todo. Un pedido no puede quedar en cero: se <b>anula</b>, y para eso hace
                falta decir por qué.
              </div>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Por qué se anula (obligatorio)"
                style={sx('width:100%;padding:11px 12px;border:1px solid var(--line2);border-radius:12px;background:var(--surface2);color:var(--text);font-size:13px')}
              />
            </>
          )}

          <button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="lu-press"
            style={{
              ...sx('width:100%;min-height:48px;display:grid;place-items:center;border:none;border-radius:12px;font-size:14px;font-weight:700'),
              background: puedeGuardar ? (quedaVacio ? 'var(--danger)' : 'var(--primary)') : 'var(--surface2)',
              color: puedeGuardar ? '#fff' : 'var(--faint)',
              cursor: puedeGuardar ? 'pointer' : 'default',
            }}
          >
            {quedaVacio ? 'Anular el pedido' : trabajando ? 'Guardando…' : 'Guardar los cambios'}
          </button>
        </div>
      }
    >
      {/* ── Lo que ya estaba ───────────────────────────────────────────────────────────────── */}
      <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:4px')}>
        Ya estaba en el pedido
      </div>
      <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.5;margin-bottom:8px')}>
        Estos precios quedaron fijados el {fmtFecha(pedido?.created_at)}, cuando se tomó el pedido.
        Se puede restar o quitar; para sumar unidades, agregalas abajo — van al precio de hoy.
      </div>

      {lineas.map((l) => {
        const c = cantidadDe(l)
        const quitada = c === 0
        return (
          <div
            key={l.id}
            style={{
              ...sx('display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)'),
              opacity: quitada ? 0.45 : 1,
            }}
          >
            <div style={sx('flex:1;min-width:0')}>
              <div style={{ ...sx('font-size:12.5px;line-height:1.35'), textDecoration: quitada ? 'line-through' : 'none' }}>
                {l.descripcion}
              </div>
              <div style={sx('font-size:10.5px;color:var(--faint);margin-top:2px;font-family:var(--font-mono)')}>
                {fmtPesos(l.precio_unitario)} c/u · precio fijado
              </div>
            </div>
            <StepperBaja valor={c} onCambio={(v) => setCantidades((m) => ({ ...m, [l.id]: v }))} />
            <div style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;min-width:74px;text-align:right')}>
              {fmtPesos(c * l.precio_unitario)}
            </div>
          </div>
        )
      })}

      {!lineas.length && (
        <div style={sx('padding:10px 0;color:var(--faint);font-size:12px')}>
          Este pedido no tiene líneas guardadas.
        </div>
      )}

      {/* ── Lo que se agrega hoy ───────────────────────────────────────────────────────────── */}
      <div style={sx('margin-top:18px;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:6px')}>
        Agregar al pedido
      </div>

      {nuevas.map((n) => {
        const producto = productos.find((p) => p.id === n.id_producto)
        const r = producto ? precioPara(producto, n.cantidad) : null
        return (
          <div key={n.id} style={sx('display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)')}>
            <div style={sx('flex:1;min-width:0')}>
              <div style={sx('font-size:12.5px;line-height:1.35')}>{n.descripcion}</div>
              <div style={sx('font-size:10.5px;color:var(--primary);margin-top:2px;font-family:var(--font-mono)')}>
                {fmtPesos(n.precio_unitario)} c/u · precio de hoy
                {r?.motivo === 'escala' ? ` · desde ${r.desde}` : ''}
                {r?.motivo === 'oferta' ? ' · oferta' : ''}
              </div>
            </div>
            <div style={sx('display:flex;align-items:center;gap:2px;flex:none')}>
              <button
                onClick={() => cambiarNueva(n.id, n.cantidad - 1)}
                className="lu-press"
                aria-label="Quitar una unidad"
                style={sx('width:32px;height:32px;display:grid;place-items:center;border-radius:9px;border:1px solid var(--line2);background:var(--surface2);color:var(--text);font-size:17px;line-height:1;cursor:pointer')}
              >−</button>
              <div style={sx('min-width:34px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:14px;font-weight:700')}>
                {n.cantidad}
              </div>
              <button
                onClick={() => cambiarNueva(n.id, n.cantidad + 1)}
                className="lu-press"
                aria-label="Agregar una unidad"
                style={sx('width:32px;height:32px;display:grid;place-items:center;border-radius:9px;border:1px solid var(--line2);background:var(--surface2);color:var(--text);font-size:17px;line-height:1;cursor:pointer')}
              >+</button>
            </div>
            <div style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;min-width:74px;text-align:right')}>
              {fmtPesos(n.cantidad * n.precio_unitario)}
            </div>
          </div>
        )
      })}

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar un producto para agregar…"
        style={sx('width:100%;margin-top:10px;padding:11px 12px;border:1px solid var(--line2);border-radius:12px;background:var(--surface2);color:var(--text);font-size:13px')}
      />

      {sugeridos.map((p) => {
        const r = precioPara(p, 1)
        return (
          <div
            key={p.id}
            onClick={() => agregar(p)}
            role="button"
            className="lu-press"
            style={sx('display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line);cursor:pointer')}
          >
            <div style={sx('flex:1;min-width:0')}>
              <div style={sx('font-size:12.5px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{p.name}</div>
              <div style={sx('font-size:10.5px;color:var(--faint);margin-top:2px;font-family:var(--font-mono)')}>
                {p.codigo || '—'} · {fmtPesos(r.precio)}
              </div>
            </div>
            <div style={sx('flex:none;font-size:12px;color:var(--primary);font-weight:600')}>Agregar</div>
          </div>
        )
      })}

      {busca.trim().length >= 2 && !sugeridos.length && (
        <div style={sx('padding:12px 0;color:var(--faint);font-size:12px')}>
          Ningún producto del catálogo coincide con “{busca.trim()}”.
        </div>
      )}
    </Overlay>
  )
}
