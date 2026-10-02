import { useState } from 'react'
import { sx } from '../lib/sx'

/**
 * EL NÚMERO DEL STEPPER, ESCRIBIBLE.
 *
 * 🩸 POR QUÉ EXISTE (01/09/2026). Hasta hoy la cantidad sólo se podía mover con el `−` y el `+`, y
 * el número era un `<div>`. Cargar 24 unidades de un fardo eran 24 toques, y el vendedor lo hace
 * con el comerciante enfrente. Peor: el mismo `<div>` estaba copiado en TRES pantallas
 * —`VisitaCatalogo`, `CarritoSheet` y `FichaProducto`—, así que hacerlo escribible en una sola
 * habría dejado dos lugares donde no se puede tipear, que es de las cosas que más desconciertan:
 * el mismo control se comporta distinto según desde dónde se llegue.
 *
 * Por eso el input vive acá y no en cada pantalla: lo delicado no es el `<input>`, es la máquina
 * de estados de escribirle un número, y esa tiene que ser una sola (regla 31).
 *
 * 🩸 LO QUE NO SE PUEDE HACER, Y ES EL ERROR OBVIO: `value={qty}` a secas. Con eso el campo no se
 * puede vaciar nunca —al borrar el "1" React lo repone en el mismo frame— así que para pasar de 1 a
 * 24 hay que posicionar el cursor y no equivocarse. Mientras se edita manda un estado LOCAL de
 * texto (`txt`), y recién al salir o al confirmar se convierte en número. `txt === null` significa
 * "no se está editando": ahí manda `qty`, y el número se actualiza solo si lo mueven el − o el +.
 *
 * props: { qty, onCambiar, alto, fuente, flex, minAncho, caja }
 *
 * 🎨 REDISEÑO C10 (01/10/2026, hoja "Catálogo Vendedor" 1h/1i y brief v2 §4.3/§4.6):
 * - `alto` pasa de 34 a 44 por defecto: el campo ES un objetivo táctil (abre el teclado numérico)
 *   y 34 quedaba debajo del mínimo de 44. En reposo es transparente y sin borde, así que en el
 *   carrito y en la edición del pedido el cambio no se ve: sólo crece el área que se puede tocar.
 * - `fuente` nunca baja de 16 px (se fuerza con `Math.max`): con menos, Safari de iPhone hace zoom
 *   de la página entera al enfocar el campo, y la PWA se usa en iPhone (decisión 5 del dueño).
 * - `caja` (nuevo, lo usa la grilla del catálogo): el número va en una caja de 52 px con borde, y
 *   "en el carrito" se marca con borde de acento + tinte + número en tinta, no sólo con color de
 *   texto. Sin `caja` el campo se ve exactamente como antes.
 * - Con `flex`, `minAncho` puede ser 0: en la tarjeta de 161 px de la grilla (360 px de pantalla)
 *   entre el − y el + de 44 quedan ~33 px para el número. Es la excepción documentada en la hoja:
 *   el campo mide 52 de alto pero menos de 44 de ancho, y alcanza para tres cifras.
 */
export default function CantidadInput({ qty, onCambiar, alto = 44, fuente = 16, flex = false, minAncho = 26, caja = false }) {
  const [txt, setTxt] = useState(null)
  // `txt !== null` es "se está editando" (ver arriba): sirve también de foco para la caja, porque
  // un borde inline le gana a `.lu-cant:focus` de index.css y la caja no se marcaría al tocarla.
  const editando = txt !== null
  const enCarrito = qty > 0

  const comprometer = () => {
    if (txt === null) return
    // Sólo dígitos: en el celular el teclado numérico igual deja meter comas, signos y espacios.
    const limpio = String(txt).replace(/[^\d]/g, '')
    setTxt(null)
    // 🩸 CAMPO VACÍO = CANCELAR, NO CERO (09/09/2026). Va de la mano con el onFocus de abajo: desde
    // que enfocar VACÍA el campo en vez de seleccionarlo, tocarlo sin querer y salir pasaba a
    // borrar la cantidad cargada. Es la falla silenciosa peor de todas — el renglón desaparece del
    // pedido y nadie lo ve hasta que el total no cierra, con el comerciante enfrente.
    // Para poner cero quedan el − y escribir un 0 explicito, que son gestos deliberados.
    if (limpio === '') return
    const n = Math.max(0, Math.floor(Number(limpio) || 0))
    if (n !== qty) onCambiar(n)
  }

  return (
    <input
      value={txt !== null ? txt : String(qty)}
      onChange={(e) => setTxt(e.target.value)}
      // 🔴 ACÁ SE VACIA, NO SE SELECCIONA — y esa ÚNICA línea es el menú "Traducir / Copiar /
      // Cortar" que reportaron el 09/09/2026. Acá decía `setTxt(String(qty)); e.target.select()`:
      // el select() deja el texto SELECCIONADO, y ante una selección el WebView de Android levanta
      // su barra flotante de sistema, que en un teléfono tapa media grilla justo cuando el vendedor
      // va a tipear. No era configuración del teléfono ni del teclado, como se sospechaba: era
      // nuestra. Vaciar el campo da el MISMO efecto de tipeo (escribis y reemplazas) sin crear
      // ninguna selección, asi que la barra no tiene de dónde salir.
      // El número anterior no se pierde de vista: sigue ahí, en gris, por el `placeholder`.
      onFocus={() => setTxt('')}
      onBlur={comprometer}
      onKeyDown={(e) => {
        // Enter confirma y CIERRA EL TECLADO. Sin el blur, en el celular el teclado se queda tapando
        // la grilla justo después de cargar la cantidad, que es cuando hay que seguir eligiendo.
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
        if (e.key === 'Escape') { setTxt(null); e.currentTarget.blur() }
      }}
      // 🔴 En el filtro "Destacados" la tarjeta ENTERA es un botón que le manda el producto a la
      // tablet del comerciante. Sin esto, tocar el número para escribir se lo mandaría. Va acá y no
      // en el llamador a propósito: olvidarlo del otro lado es un bug que se ve recién con la
      // vidriera encendida y un cliente mirando.
      onClick={(e) => e.stopPropagation()}
      placeholder={String(qty)}
      inputMode="numeric"
      enterKeyHint="done"
      aria-label="Cantidad"
      style={{
        ...sx('text-align:center;border:1px solid transparent;border-radius:8px;background:transparent;' +
              'font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600;padding:0'),
        // `min-height` y no `height`: con la letra del sistema al doble (informe 08: crece el texto,
        // no las cajas) el número no se recorta, la caja crece.
        minHeight: alto,
        fontSize: Math.max(16, fuente),
        flex: flex ? 1 : 'none',
        width: flex ? undefined : minAncho + 12,
        minWidth: minAncho,
        color: caja ? (enCarrito ? 'var(--text)' : 'var(--faint)') : (enCarrito ? 'var(--deep)' : 'var(--faint)'),
        // Sin `caja`, el borde aparece sólo al enfocar: en reposo tiene que verse como el número que
        // era antes, o el carrito se llena de cajitas. Con `caja`, el borde es parte del estado.
        ...(caja ? {
          borderRadius: 'var(--r-md)',
          borderColor: editando || enCarrito ? 'var(--primary)' : 'var(--line2)',
          background: editando ? 'var(--surface)' : (enCarrito ? 'var(--primary-tint)' : 'transparent'),
        } : null),
        outline: 'none',
      }}
      className="lu-cant"
    />
  )
}
