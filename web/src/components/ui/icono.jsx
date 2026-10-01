import { isValidElement } from 'react'

/**
 * Pinta el ícono que recibe un primitivo (01/10/2026). Interno de components/ui.
 *
 * Acepta las dos formas en que la app pasa íconos hoy: el COMPONENTE de `components/icons.jsx`
 * (`icono={Pin}`, lo habitual: el primitivo decide el tamaño) o un ELEMENTO ya armado
 * (`icono={<GestIcon k="zonas" />}`, para los que necesitan una prop propia). Con el componente,
 * el tamaño lo pone el primitivo y queda igual en todas las pantallas, que es la idea.
 */
export function pintarIcono(Icono, size) {
  if (!Icono) return null
  if (isValidElement(Icono)) return Icono
  return <Icono size={size} />
}
