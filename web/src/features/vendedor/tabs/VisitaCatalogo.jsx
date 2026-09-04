import { useState } from 'react'
import { sx } from '../../../lib/sx'
import { fmtPesos } from '../../../lib/format'
import { precioDe } from '../../../lib/precios'
import CarritoSheet from '../CarritoSheet'
import FichaProducto from '../FichaProducto'
import GrillaCatalogo from '../../../components/GrillaCatalogo'
import EspejoTablet from '../../vidriera/EspejoTablet'
import AvisoVidriera from '../../vidriera/AvisoVidriera'
import { useAltoMedido } from '../../../hooks/useAltoMedido'
import { useSugeridos, useUltimoPedido } from '../useSugeridos'

/**
 * Pestaña "Catálogo/Visita": header de la visita en curso (timer + acciones), buscador,
 * chips de categoría y **cuadrícula de 2 productos por fila** (foto, descripción a 2
 * renglones, precio, unidades y marco de color por rentabilidad), y la barra de carrito.
 */
export default function VisitaCatalogo({ j }) {
  // 🩸 EL DESTRUCTURING DE `j` VA ANTES QUE LOS HOOKS (18/08/2026). En 1.17.0 quedó tres líneas
  // ABAJO de la llamada a `useVidriera`, que lo usa: `PRODUCTS` es un `const` del mismo scope, así
  // que caía en la zona muerta temporal y la pestaña reventaba con "Cannot access 'PRODUCTS' before
  // initialization" en CADA render — el ErrorBoundary de `App.jsx` se comía la pantalla de toma de
  // pedido, con el bundle ya publicado por OTA (que se aplica sola desde 1.12.1, regla 48).
  // El build daba verde: Vite no detecta TDZ. Si mañana un hook nuevo necesita otro campo de `j`,
  // ya lo tiene arriba; no hay motivo para volver a bajar esta línea.
  // search + catFilter viven en useJornada para persistir el filtro al cambiar de pestaña.
  const { vid, PRODUCTS, visitC, timer, cart, quitados, addCart, setSheet, cancelVisit, showToast, cartCount, cartKg, cartTotal, cartAhorro, search, setSearch, catFilter, setCatFilter, quitarDelCarrito, vaciarCarrito, deshacerCarrito, recuperarQuitado, confirmarPedido } = j

  // 🩸 LA SESIÓN DE VIDRIERA NO VIVE ACÁ: vive en `useJornada` (18/08/2026). Primero se mudó desde
  // la ventana del QR —cerrarla desconectaba la tablet— y después un nivel más arriba, porque esta
  // pestaña se DESMONTA al cambiar de tab y volvía a pasar lo mismo camino al próximo check-in.
  // Acá solo se consume: `j.vid`.
  // 🔴 VA DEBAJO DEL DESTRUCTURING DE `j`, no arriba (regla 51): usa `visitC`, que es un `const`
  // de este mismo scope. Puesto por encima caería en la zona muerta temporal y reventaría en cada
  // render con un ReferenceError que el build NO detecta.
  const sugeridosIds = useSugeridos(visitC?.id)
  // 🔴 Debajo del destructuring de `j`, por el mismo motivo que la línea de arriba (regla 51).
  const ultimoPedido = useUltimoPedido(visitC?.id)

  // 🩸 EL ALTO DE LA BARRA DEL PEDIDO SE MIDE (20/08/2026). El renglón de "sin pedir" se apoyaba
  // sobre un `186px` escrito a mano que era el alto estimado de esta barra; la barra cambia de alto
  // con el largo del texto y con la fuente del sistema. Mismo motivo que `--nav-h` en
  // `VendedorView`: una constante que hoy acierta vuelve a fallar en el próximo teléfono.
  const [pedidoRef, pedidoAlto] = useAltoMedido()

  const [verQr, setVerQr] = useState(false)
  const [verCarrito, setVerCarrito] = useState(false)
  // El producto abierto en grande. Se guarda el ID y no el objeto: el catálogo se reemplaza entero
  // en cada mutación (una foto nueva, un precio corregido) y un objeto capturado acá se quedaría
  // mostrando el precio viejo con el comerciante mirando la pantalla.
  const [fichaId, setFichaId] = useState(null)

  // Los ids sugeridos se resuelven contra el catálogo cargado: si un producto se dio de baja
  // después del pedido, simplemente no aparece.
  const sugerencias = sugeridosIds.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean)

  // El filtrado, los chips y la grilla se mudaron a `components/GrillaCatalogo.jsx` (04/09/2026):
  // eran ~160 líneas que no sabían nada de la visita y que la pantalla de EDICIÓN de un pedido
  // necesita idénticas. Acá queda sólo lo que sí es de la visita.
  const ficha = fichaId ? PRODUCTS.find((p) => p.id === fichaId) : null

  /**
   * 🩸 EL TOQUE HACE LAS DOS COSAS A LA VEZ, no una o la otra (28/08/2026).
   *
   * Abre el producto grande en el celular Y —si la vidriera está viva— se lo abre al comerciante en
   * la tablet. Es exactamente el gesto que se pidió ("el vendedor toca cada producto y le aparece en
   * la tablet"), y es el mismo criterio que ya usa la tablet cuando el toque lo da el cliente: ahí
   * `alTocar` abre la ficha y avisa al mismo tiempo, porque las dos mitades son de la MISMA
   * conversación (ver el 🩸 de `VidrieraTablet`).
   *
   * Sin tablet no se pierde nada: queda la ficha del celular, que se le da vuelta al comerciante.
   */
  const abrirFicha = (p) => {
    setFichaId(p.id)
    if (vid.activa) { vid.destacar(p); showToast(`Se lo mostramos: ${p.name}`) }
  }

  return (
    <div style={{ ...sx('flex:1;display:flex;flex-direction:column;overflow:hidden'), '--pedido-h': pedidoAlto ? `${pedidoAlto + 8}px` : '0px' }}>
      {visitC ? (
        <div style={sx('flex:none;background:var(--surface);border-bottom:1px solid var(--line);padding:12px 14px')}>
          <div style={sx('display:flex;justify-content:space-between;align-items:center')}>
            <div style={sx('display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:600;letter-spacing:.08em;color:var(--primary)')}>
              <span style={sx('width:7px;height:7px;border-radius:99px;background:var(--primary);animation:lu-blink 1.4s infinite')} />VISITA EN CURSO
            </div>
            <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:600;color:var(--text)')}>{timer}</div>
          </div>
          <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-top:6px')}>
            <div>
              <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>{visitC.name}</div>
              <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>{visitC.codigo || ''} · {visitC.loc || ''}</div>
            </div>
            <div style={sx('display:flex;gap:6px')}>
              {/* VIDRIERA — abre el QR para emparejar la tablet del cliente. Va en el header de la
                  visita en curso porque el gesto es: hago check-in, le paso la tablet, tomo el
                  pedido. Fuera de una visita no tiene sentido: el cartel del celular no sabría de
                  qué comercio es el pedido. */}
              {vid.disponible && (
                <button
                  onClick={() => { setVerQr(true); if (!vid.activa) vid.abrir() }}
                  style={{
                    ...sx('min-height:38px;padding:0 12px;display:flex;align-items:center;gap:6px;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer'),
                    border: `1px solid ${vid.activa ? 'var(--success)' : 'var(--primary)'}`,
                    background: vid.activa ? 'var(--success-tint)' : 'var(--primary-tint)',
                    color: 'var(--deep)',
                  }}
                >
                  {/* El punto verde late mientras el enlace está vivo: es la única señal de que la
                      tablet sigue conectada una vez que la ventana del QR se cerró. */}
                  {vid.activa && <span style={sx('width:7px;height:7px;border-radius:99px;background:var(--success);animation:lu-blink 1.6s infinite')} />}
                  Vidriera
                </button>
              )}
              <button onClick={() => setSheet(true)} style={sx('min-height:38px;padding:0 12px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;font-size:12px;font-weight:600;color:var(--warning);cursor:pointer;background:transparent')}>Sin pedido</button>
              <button onClick={cancelVisit} style={sx('min-height:38px;padding:0 12px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;background:transparent')}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : (
        <div style={sx('flex:none;margin:12px 14px 0;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--info-tint);color:var(--muted);font-size:12px;display:flex;gap:8px;align-items:center')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
          Modo consulta — hacé check-in en un cliente para tomar un pedido.
        </div>
      )}

      {/* 🩸 EL CATÁLOGO ES UN COMPONENTE COMPARTIDO DESDE EL 04/09/2026. El buscador, los chips y
          la grilla vivían acá adentro, y por eso la pantalla de EDICIÓN de un pedido nació con un
          buscador propio y una lista pelada: sin cantidad tipeable, sin escalas de precio y sin el
          marco de rentabilidad. Se extrajo a `components/GrillaCatalogo.jsx` para que las dos
          pantallas sean la MISMA (regla 31), no dos que se parecen.

          Lo que se quedó acá es lo que sí es de la visita: el header con el timer, la vidriera, el
          carrito, el flotante de "sin pedir" y la barra de confirmar. */}
      <GrillaCatalogo
        productos={PRODUCTS}
        cart={cart}
        addCart={addCart}
        search={search} setSearch={setSearch}
        catFilter={catFilter} setCatFilter={setCatFilter}
        onAbrirFicha={abrirFicha}
        vidActiva={vid.activa}
        onMostrar={(p) => { vid.destacar(p); showToast(`Se lo mostramos: ${p.name}`) }}
      >
        {/* 🩸 REPETIR EL ÚLTIMO PEDIDO (03/09/2026, reunión del 02/09). Va ARRIBA de "lo que más
            lleva" porque resuelve más de una vez: los chips ahorran acordarse de un producto, esto
            ahorra cargar veinte renglones. En una distribuidora el pedido de un almacén se parece
            muchísimo al anterior — el vendedor repite y ajusta dos líneas.

            🔑 REPITE QUÉ Y CUÁNTO, NUNCA A CUÁNTO. El precio del pedido viejo está congelado en la
            línea (es el que se pactó ese día); acá se agregan al carrito como productos, así que el
            precio lo resuelve `precioPara` contra el catálogo de HOY, con su escalón por volumen. Es
            la misma regla que rige la edición de un ticket (db/55).

            ⚠️ SUMA sobre lo que ya haya en el carrito en vez de reemplazarlo: si el vendedor ya cargó
            algo y después toca esto, borrarle lo suyo sería destruir trabajo sin preguntar. Los
            productos que ya no están en el catálogo se saltean y se dicen — quedarse callado haría
            que el total no cierre con lo que el comerciante recuerda haber pedido. */}
        {!!ultimoPedido && (
          <div style={sx('flex:none;padding:0 14px 10px')}>
            <button
              onClick={() => {
                let sumados = 0
                let faltantes = 0
                for (const l of ultimoPedido.lineas) {
                  if (!PRODUCTS.some((p) => p.id === l.id_producto)) { faltantes++; continue }
                  addCart(l.id_producto, l.cantidad)
                  sumados++
                }
                showToast(
                  faltantes
                    ? `${sumados} productos agregados · ${faltantes} ya no están en el catálogo`
                    : `${sumados} productos del pedido anterior, a precios de hoy`
                )
              }}
              className="lu-press"
              style={sx('width:100%;display:flex;align-items:center;gap:9px;padding:10px 12px;border:1px dashed var(--primary);border-radius:12px;background:transparent;color:var(--text);cursor:pointer;text-align:left')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
              <span style={sx('flex:1;min-width:0')}>
                <span style={sx('display:block;font-size:12.5px;font-weight:600')}>Repetir el último pedido</span>
                <span style={sx('display:block;font-size:11px;color:var(--faint);margin-top:1px')}>
                  {ultimoPedido.lineas.length} {ultimoPedido.lineas.length === 1 ? 'producto' : 'productos'} · {fmtPesos(ultimoPedido.monto_total)} · a precios de hoy
                </span>
              </span>
            </button>
          </div>
        )}

        {/* 🩸 LO QUE MÁS LLEVA ESTE COMERCIO (19/08/2026). El vendedor entra y tiene 529 productos en
            una grilla; lo que ese comercio compra siempre estaba en algún lugar de esa lista y había
            que acordárselo. Sale de `productos_sugeridos_cliente` (db/44), que pondera frecuencia por
            recencia sobre el historial de pedidos.

            ⚠️ NO APARECE HASTA QUE HAY HISTORIAL, y es a propósito: la RPC exige dos pedidos como
            mínimo por producto. Con una sola compra no hay preferencia — y una recomendación
            equivocada quema la confianza en la función más rápido que su ausencia. Como los pedidos
            recién se empiezan a guardar hoy, esta fila va a estar vacía varias semanas. */}
        {sugerencias.length > 0 && (
          <div style={sx('flex:none;padding:0 14px 10px')}>
            <div style={sx('display:flex;align-items:center;gap:6px;margin-bottom:7px')}>
              <span style={sx('width:6px;height:6px;flex:none;border-radius:99px;background:var(--primary)')} />
              <span style={sx('font-size:10px;font-weight:600;letter-spacing:.07em;color:var(--muted)')}>LO QUE MÁS LLEVA</span>
            </div>
            <div className="lu-chips" style={sx('display:flex;gap:7px;overflow-x:auto')}>
              {sugerencias.map((p) => {
                const q = cart[p.id] || 0
                return (
                  <button
                    key={p.id}
                    onClick={() => addCart(p.id, 1)}
                    className="lu-press"
                    style={{
                      ...sx('flex:none;max-width:190px;text-align:left;padding:7px 11px;border-radius:12px;cursor:pointer;background:var(--surface)'),
                      border: `1px solid ${q > 0 ? 'var(--primary)' : 'var(--line2)'}`,
                    }}
                  >
                    <div style={{ ...sx('font-size:11.5px;font-weight:500;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), maxWidth: 168 }}>{p.name}</div>
                    <div style={sx('margin-top:2px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--deep);font-weight:600')}>
                      {fmtPesos(precioDe(p, Math.max(1, q)))}
                      {q > 0 ? <span style={sx('color:var(--muted);font-weight:400')}> · {q} en el pedido</span> : ''}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </GrillaCatalogo>

      {verCarrito && (
        <CarritoSheet
          productos={PRODUCTS} cart={cart} quitados={quitados} addCart={addCart}
          quitarLinea={quitarDelCarrito} vaciar={vaciarCarrito} deshacer={deshacerCarrito}
          recuperar={recuperarQuitado}
          cartCount={cartCount} cartKg={cartKg} cartTotal={cartTotal} cartAhorro={cartAhorro}
          onCerrar={() => setVerCarrito(false)}
          onConfirmar={() => {
            const total = cartTotal
            setVerCarrito(false)
            // `confirmarPedido` es lo que ESCRIBE el pedido (cabecera + líneas) por la write queue
            // y recién después cierra la visita. Antes acá se llamaba `endVisit` a secas y el
            // pedido no se guardaba en ningún lado — ver el comentario de `useJornada`.
            confirmarPedido()
            showToast(`Pedido confirmado · ${fmtPesos(total)}`)
          }}
        />
      )}

      {/* La ficha grande. Va ANTES del aviso de la vidriera a propósito: `AvisoVidriera` usa
          `--z-aviso` (550) contra los `--z-sheet` (300) de esta hoja, así que el cartel de "el
          cliente está mirando X" se sigue viendo por encima — que es justo lo que se quiere cuando
          el comerciante toca otra cosa mientras el vendedor tiene una ficha abierta. */}
      {ficha && (
        <FichaProducto
          producto={ficha}
          cart={cart}
          addCart={addCart}
          puedeMostrar={vid.activa}
          onMostrar={() => { vid.destacar(ficha); showToast(`Se lo mostramos: ${ficha.name}`) }}
          onCerrar={() => setFichaId(null)}
        />
      )}

      {/* El cartel de lo que el cliente mira: va SIEMPRE que haya sesión, esté abierta o no la
          ventana del QR. Ése es el punto de haber mudado la sesión un nivel arriba. */}
      <AvisoVidriera
        aviso={vid.aviso}
        comercio={visitC}
        onSumar={(p, n = 1) => {
          addCart(p.id, n)
          vid.descartarAviso()
          showToast(`${n > 1 ? n + ' × ' : ''}${p.name} sumado al pedido`)
        }}
        onDescartar={vid.descartarAviso}
      />

      {verQr && (
        <EspejoTablet
          red={vid.red}
          error={vid.error}
          abriendo={vid.abriendo}
          fotos={vid.fotos}
          bt={vid.bt}
          onReintentar={vid.abrir}
          onCerrarVentana={() => setVerQr(false)}
          onCerrarVidriera={() => { vid.cerrar(); setVerQr(false); showToast('Vidriera cerrada') }}
        />
      )}

      {/* 🩸 "MIRÓ Y NO COMPRÓ" (18/08/2026). Cada toque del cliente ya se registraba en `mirados` y
          nadie lo miraba nunca. Acá está la inteligencia comercial que la tablet genera sola: lo que
          le interesó y no terminó en el pedido.
          Va EN VIVO y no al cerrar la visita, que era la idea original: al cerrar ya no se puede
          hacer nada con el dato, y acá —mientras el comerciante está enfrente— todavía se le puede
          preguntar por los tres que miró y no pidió. Ocupa un renglón y no interrumpe nada.

          🩸 19/08/2026 — el renglón ahora cuenta las DOS señales, no solo la de la tablet. La otra
          mitad es lo que entró al pedido y salió (`quitados`), que es la señal más fuerte de las dos
          —lo iba a llevar y se arrepintió— y que hasta hoy se evaporaba sin dejar rastro. El detalle
          con el botón para recuperarlo vive en `CarritoSheet`; acá va el resumen de un renglón. */}
      {(vid.activa || Object.keys(quitados).length > 0) && (
        <div
          style={{
            ...sx('position:absolute;left:12px;right:12px;z-index:5;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:8px 12px;display:flex;align-items:center;gap:9px;font-size:11.5px;color:var(--muted);box-shadow:var(--shadow)'),
            // Se apoya arriba de la barra del pedido cuando la hay, y baja a su lugar cuando no.
            // 🩸 LOS DOS NÚMEROS SE MIDEN (20/08/2026). Acá decía `186 : 80` — el alto estimado de
            // la barra del pedido y el de la botonera. Los dos quedaban cortos en el Motorola del
            // dueño y el botón de confirmar terminaba tapado. Ahora salen de `--nav-h`
            // (`VendedorView`) y `--pedido-h` (esta pantalla), los dos por `ResizeObserver`.
            // El fallback del `var()` reproduce el cálculo viejo y cubre el primer frame —antes de
            // que el observer haya medido— y cualquier WebView sin `ResizeObserver`. El `,0px` de
            // `env()` tampoco es de más: sin él, un navegador que no la conozca deja la propiedad
            // inválida y el flotante se va al fondo.
            bottom: 'calc(var(--nav-h, calc(80px + env(safe-area-inset-bottom,0px))) + var(--pedido-h, 0px) + 20px)',
          }}
        >
          <span style={sx('width:7px;height:7px;flex:none;border-radius:99px;background:var(--success)')} />
          {(() => {
            // Lo sacado del pedido va primero: es la señal más fuerte y la que el vendedor puede
            // repreguntar ya mismo. Lo mirado-y-no-pedido se suma sin repetir lo que ya está.
            const sacados = Object.keys(quitados).map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean)
            const mirados = (vid.mirados || []).filter((m) => !(cart[m.id] > 0) && !(m.id in quitados))
            const sinPedir = [...sacados, ...mirados]
            if (!sinPedir.length) {
              return <span>{vid.activa ? <>Miró <b style={sx('font-family:var(--font-mono);color:var(--text)')}>{vid.mirados.length}</b> · todo lo que miró está en el pedido</> : 'Todo lo que vio está en el pedido'}</span>
            }
            return (
              <span>
                Sin pedir <b style={sx('font-family:var(--font-mono);color:var(--warning)')}>{sinPedir.length}</b>
                {sacados.length > 0 ? <> · sacó <b style={sx('font-family:var(--font-mono);color:var(--text)')}>{sacados.length}</b></> : null}
                {' · '}{sinPedir.slice(0, 2).map((p) => p.name).join(', ')}{sinPedir.length > 2 ? '…' : ''}
              </span>
            )
          })()}
        </div>
      )}

      {cartCount > 0 && (
        <div
          ref={pedidoRef}
          style={{
            ...sx('position:absolute;left:12px;right:12px;background:var(--surface);border:1px solid var(--line2);border-radius:16px;box-shadow:var(--shadow-lg);padding:12px 14px;z-index:5'),
            // 🔴 ESTE ES EL BOTÓN QUE SE VEÍA TAPADO, y son DOS causas, no una.
            //
            //  1. El alto de la botonera era el número `80` escrito a mano. Ahora se MIDE
            //     (`--nav-h`, ver `useAltoMedido`): crece con la barra de gestos, con el tamaño de
            //     fuente del sistema y con una etiqueta que pase a dos renglones, y ninguna
            //     constante sobrevive a eso.
            //  2. 🩸 Y la que de verdad explica la captura del 20/08: la botonera es de VIDRIO
            //     (`glassSurface`, `blur(14px) saturate(160%)`). Un `backdrop-filter` samplea lo
            //     que está pintado DEBAJO, y en `filter: blur(L)` la `L` es la desviación estándar
            //     —no el radio—, así que la influencia llega bastante más allá de 14 px. Con la
            //     separación de 12 px que había, el turquesa del botón caía de lleno adentro del
            //     muestreo: la barra entera se teñía de turquesa y el botón se leía cortado,
            //     fundido con ella. No estaba tapado por geometría; estaba tapado por el desenfoque.
            //
            // 20 px baja mucho el tinte, pero **no lo elimina**: la gaussiana no tiene un borde
            // duro, así que esto lo atenúa, no lo apaga. Apagarlo del todo pide una botonera opaca
            // o menos blur, y eso es una decisión de diseño, no un arreglo.
            bottom: 'calc(var(--nav-h, calc(80px + env(safe-area-inset-bottom,0px))) + 20px)',
          }}
        >
          {/* 🩸 La barra ABRE el pedido (19/08/2026). Antes solo informaba: para cambiar una
              cantidad había que volver a buscar el producto entre 529, y para saber qué llevaba el
              cliente, acordarse. Con la vidriera andando se nota enseguida — el comercio señala
              cinco cosas seguidas y hay que repasarlas antes de cerrar. */}
          <div
            onClick={() => setVerCarrito(true)}
            className="lu-press"
            role="button"
            style={sx('display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;cursor:pointer')}
          >
            <div style={sx('font-size:12px;color:var(--muted)')}>{cartCount} ítems · {cartKg.toFixed(1).replace('.', ',')} kg</div>
            <div style={sx('display:flex;align-items:center;gap:7px')}>
              <span style={sx('font-size:18px;font-weight:600;color:var(--text)')}>{fmtPesos(cartTotal)}</span>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </div>
          </div>
          {visitC ? (
            <button
              onClick={() => { const total = cartTotal; confirmarPedido(); showToast(`Pedido confirmado · ${fmtPesos(total)}`) }}
              style={sx('width:100%;min-height:48px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:14px;cursor:pointer;border:none')}
            >Confirmar pedido y finalizar visita</button>
          ) : (
            <div style={sx('min-height:48px;display:grid;place-items:center;background:var(--surface2);color:var(--faint);border:1px solid var(--line);border-radius:12px;font-weight:600;font-size:13px')}>Hacé check-in para confirmar el pedido</div>
          )}
        </div>
      )}
    </div>
  )
}
