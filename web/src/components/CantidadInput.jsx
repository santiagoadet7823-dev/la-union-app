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
 * props: { qty, onCambiar, alto, fuente, flex, minAncho }
 */
export default function CantidadInput({ qty, onCambiar, alto = 34, fuente = 14, flex = false, minAncho = 26 }) {
  const [txt, setTxt] = useState(null)

  const comprometer = () => {
    if (txt === null) return
    // Sólo dígitos: en el celular el teclado numérico igual deja meter comas, signos y espacios.
    const n = Math.max(0, Math.floor(Number(String(txt).replace(/[^\d]/g, '')) || 0))
    setTxt(null)
    if (n !== qty) onCambiar(n)
  }

  return (
    <input
      value={txt !== null ? txt : String(qty)}
      onChange={(e) => setTxt(e.target.value)}
      onFocus={(e) => { setTxt(String(qty)); e.target.select() }}
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
      inputMode="numeric"
      enterKeyHint="done"
      aria-label="Cantidad"
      style={{
        ...sx('text-align:center;border:1px solid transparent;border-radius:8px;background:transparent;' +
              'font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600;padding:0'),
        height: alto,
        fontSize: fuente,
        flex: flex ? 1 : 'none',
        width: flex ? undefined : minAncho + 12,
        minWidth: minAncho,
        color: qty > 0 ? 'var(--deep)' : 'var(--faint)',
        // El borde aparece sólo al enfocar: en reposo tiene que verse como el número que era antes,
        // o la grilla se llena de cajitas.
        outline: 'none',
      }}
      className="lu-cant"
    />
  )
}
