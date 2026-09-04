import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import Overlay from '../../components/Overlay'
import GrillaCatalogo from '../../components/GrillaCatalogo'
import CantidadInput from '../../components/CantidadInput'
import { useCatalog } from '../../context/CatalogContext'
import { useGps } from '../../context/GpsContext'
import FichaProducto from '../vendedor/FichaProducto'
import { anularPedido } from './anularPedido'
import { fmtFecha } from './DetallePedido'
import { editarPedido, nuevaLinea, totalesDeLineas } from './editarPedido'

/**
 * CORREGIR UN PEDIDO PENDIENTE.
 *
 * 🩸 POR QUÉ (03/09/2026). Lo pidieron el dueño y un vendedor: hasta entonces, una vez confirmado el
 * ticket no se podía tocar y el error se arreglaba anulando y rehaciendo todo.
 *
 * 🩸 Y POR QUÉ ESTA PANTALLA SE REHIZO AL DÍA SIGUIENTE (04/09/2026). La primera versión tenía un
 * buscador propio con una lista de resultados y un `+`. Funcionaba, y estaba mal: le sacaba al
 * vendedor **la forma en que carga un pedido todos los días**. Sin `CantidadInput` no podía tipear
 * 24 —eran 24 toques—, y sobre todo no veía las **escalas de precio por volumen**, que es la función
 * que se agregó el 27/08 y la que hace que el comerciante se lleve más. El reporte fue textual: "no
 * puedo agregar la cantidad exacta y no puedo visualizar las funciones que tiene el catálogo".
 * Ahora abre el **mismo catálogo** (`components/GrillaCatalogo`), con la misma ficha de producto y
 * el mismo stepper.
 *
 * 🔑 LAS DOS ZONAS SON DOS REGLAS DISTINTAS, y por eso se ven distinto:
 *
 *  · **Lo que ya estaba** (arriba) sólo se puede RESTAR o QUITAR, y muestra el precio con el que se
 *    pactó, con la fecha. Si entre medio entró una lista nueva del ERP —entran varias por día— ese
 *    número no se mueve: `precio_unitario` está copiado en la fila y la edición manda sólo
 *    `cantidad`.
 *  · **El catálogo** (abajo) agrega al precio de HOY, con su escalón por volumen.
 *
 * 🔴 EL CARRITO DE LA GRILLA REFLEJA SÓLO LO NUEVO, NUNCA VIEJO+NUEVO SUMADO. Es la decisión más
 * importante de este archivo. Si la grilla mostrara el total combinado, el vendedor bajaría el
 * stepper creyendo que le resta al pedido y en realidad estaría restando de lo que agregó recién —
 * o peor, creería que desde ahí puede tocar el precio congelado. Sumar unidades de un producto que
 * ya estaba genera un **renglón aparte a precio de hoy** (decisión del dueño, 04/09), y el ticket lo
 * muestra en dos líneas: es la verdad de lo que pasó y el comerciante ve por qué paga dos precios.
 *
 * props: { pedido, lineas, onCerrar, onGuardado, onToast, userId }
 */
export default function EditarPedidoSheet({ pedido, lineas = [], onCerrar, onGuardado, onToast, userId }) {
  const { productos } = useCatalog()
  const { pos } = useGps()
  const [abierto, setAbierto] = useState(true)
  const [cantidades, setCantidades] = useState({})
  const [nuevas, setNuevas] = useState([])
  // Los filtros son locales: en `useJornada` viven arriba sólo para sobrevivir al cambio de
  // pestaña, y acá no hay pestañas que cambien.
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('Todos')
  const [fichaId, setFichaId] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  // Al cambiar de pedido se limpia todo. Sin esto, lo tipeado para uno quedaría cargado al abrir el
  // siguiente — el mismo cuidado que ya tiene `DetallePedido` con el motivo de anulación.
  useEffect(() => {
    setCantidades({}); setNuevas([]); setSearch(''); setCatFilter('Todos'); setFichaId(null); setMotivo('')
  }, [pedido?.id])

  const cantidadDe = (l) => Math.max(0, Math.round(Number(cantidades[l.id] ?? l.cantidad) || 0))
  const viejasVivas = lineas.map((l) => ({ ...l, cantidad: cantidadDe(l) })).filter((l) => l.cantidad > 0)
  const finales = [...viejasVivas, ...nuevas]
  const { total } = totalesDeLineas(finales)
  const hayCambios =
    nuevas.length > 0 || lineas.some((l) => cantidadDe(l) !== Math.round(Number(l.cantidad) || 0))
  // Quitar la última línea no deja un pedido en $0: se anula, con motivo. Un pedido vacío y uno
  // anulado dirían lo mismo, pero el vacío no dice quién ni por qué.
  const quedaVacio = finales.length === 0

  /**
   * EL ADAPTADOR. La grilla habla `{ idProducto: cantidad }` + `addCart(id, delta)`; esta pantalla
   * guarda las líneas nuevas como filas listas para la base (con su precio ya congelado). Son dos
   * formas del mismo dato y la traducción vive acá, en un solo lugar.
   */
  const cart = useMemo(
    () => Object.fromEntries(nuevas.map((n) => [n.id_producto, n.cantidad])),
    [nuevas],
  )

  function addCart(idProducto, delta) {
    const producto = productos.find((p) => p.id === idProducto)
    if (!producto) return
    setNuevas((arr) => {
      const i = arr.findIndex((n) => n.id_producto === idProducto)
      const previa = i === -1 ? 0 : arr[i].cantidad
      const cantidad = Math.max(0, previa + delta)
      if (cantidad === 0) return arr.filter((n) => n.id_producto !== idProducto)
      // 🔑 La línea se REARMA con `nuevaLinea`, así el precio se recalcula contra la cantidad: si
      // con la unidad de más entra en un escalón por volumen, le corresponde ese precio. Se conserva
      // el `id` para que un reintento de la cola no duplique el renglón.
      if (i === -1) return [...arr, nuevaLinea(producto, cantidad, pedido.id)]
      const copia = [...arr]
      copia[i] = { ...nuevaLinea(producto, cantidad, pedido.id), id: copia[i].id }
      return copia
    })
  }

  const ficha = fichaId ? productos.find((p) => p.id === fichaId) : null

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
  const unidadesNuevas = nuevas.reduce((a, n) => a + n.cantidad, 0)

  return (
    <>
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
              <span style={sx('font-size:12px;color:var(--muted)')}>
                Total{unidadesNuevas > 0 ? ` · +${unidadesNuevas} u nuevas` : ''}
              </span>
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
        {/* ── Lo que ya estaba ───────────────────────────────────────────────────────────────
            Va arriba y separado del catálogo: son unidades con precio ya pactado, y la única
            acción posible sobre ellas es restar. */}
        <div style={sx('padding:0 0 4px')}>
          <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:4px')}>
            Ya estaba en el pedido
          </div>
          <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.5;margin-bottom:8px')}>
            Estos precios quedaron fijados el {fmtFecha(pedido?.created_at)}, cuando se tomó el pedido.
            Acá sólo se resta o se quita. Para sumar unidades, buscalas en el catálogo de abajo — van
            al precio de hoy.
          </div>

          {lineas.map((l) => {
            const c = cantidadDe(l)
            const quitada = c === 0
            const tope = Math.round(Number(l.cantidad) || 0)
            return (
              <div
                key={l.id}
                style={{
                  ...sx('display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--line)'),
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
                {/* Sólo baja: el `+` no existe acá a propósito (sumar unidades de hoy al precio de
                    ayer es lo que la regla prohíbe). Pero el número SÍ es `CantidadInput`, para que
                    bajar de 24 a 6 sea un número tipeado y no 18 toques — acotado al tope original,
                    que es lo que lo mantiene en "sólo restar". */}
                <div style={sx('display:flex;align-items:center;gap:2px;flex:none')}>
                  <button
                    onClick={() => setCantidades((m) => ({ ...m, [l.id]: Math.max(0, c - 1) }))}
                    disabled={c === 0}
                    className="lu-press"
                    aria-label="Quitar una unidad"
                    style={{
                      ...sx('width:34px;height:34px;display:grid;place-items:center;border-radius:10px;border:1px solid var(--line2);background:transparent;font-size:18px;line-height:1'),
                      color: c === 0 ? 'var(--faint)' : 'var(--muted)',
                      cursor: c === 0 ? 'default' : 'pointer',
                      opacity: c === 0 ? 0.5 : 1,
                    }}
                  >−</button>
                  <CantidadInput
                    qty={c}
                    onCambiar={(n) => setCantidades((m) => ({ ...m, [l.id]: Math.min(Math.max(0, n), tope) }))}
                  />
                </div>
                <div style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;min-width:70px;text-align:right')}>
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

          {/* Lo agregado en ESTA corrección, resumido. La grilla de abajo ya lo muestra con su
              contador, pero desde arriba no se ve sin scrollear hasta el producto. */}
          {nuevas.length > 0 && (
            <div style={sx('margin-top:12px;padding:9px 11px;border:1px solid var(--primary);border-radius:11px;background:var(--primary-tint)')}>
              <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--deep);margin-bottom:5px')}>
                Agregado ahora · precio de hoy
              </div>
              {nuevas.map((n) => (
                <div key={n.id} style={sx('display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11.5px;padding:2px 0')}>
                  <span style={sx('flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{n.descripcion}</span>
                  <span style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--deep);font-weight:600')}>
                    {n.cantidad} × {fmtPesos(n.precio_unitario)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── El catálogo de verdad ──────────────────────────────────────────────────────────
            El MISMO componente que usa la toma de pedido: cantidad tipeable, escalas de precio,
            marco de rentabilidad y chips de categoría. Sin vidriera: corregir un pedido es algo que
            el vendedor hace para arreglar un error, no una conversación frente a la tablet. */}
        <div style={sx('margin-top:16px;padding-top:12px;border-top:1px solid var(--line2)')}>
          <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)')}>
            Agregar al pedido · precio de hoy
          </div>
        </div>
        <GrillaCatalogo
          productos={productos}
          cart={cart}
          addCart={addCart}
          search={search} setSearch={setSearch}
          catFilter={catFilter} setCatFilter={setCatFilter}
          onAbrirFicha={(p) => setFichaId(p.id)}
          // Adentro de un sheet no hay barra flotante que tapar: el `180px` de la visita dejaría un
          // hueco enorme al final de la lista.
          paddingInferior={12}
        />
      </Overlay>

      {/* La ficha grande, con la escalera en filas legibles y el empujón "2 más y pagás $X". Es el
          MISMO componente de la visita, y por eso funciona con `cart`/`addCart` sin adaptación. */}
      {ficha && (
        <FichaProducto
          producto={ficha}
          cart={cart}
          addCart={addCart}
          puedeMostrar={false}
          onCerrar={() => setFichaId(null)}
        />
      )}
    </>
  )
}
