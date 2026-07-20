import { sx } from './sx'

/**
 * Estilos de botón compartidos.
 *
 * 19/07/2026 — el par "Cancelar / Guardar" del footer estaba copiado carácter por
 * carácter en NuevoCliente, NuevoProducto, MiPerfilModal y EditarClienteVendedor,
 * y ya había empezado a divergir (min-height 44 acá, 46 allá).
 *
 * Los tres exportan estilo, no componente: los llamadores necesitan agregar
 * `flex:1`, handlers y `className="lu-press"` según el caso.
 */

const base = sx('min-height:46px;border-radius:var(--r-md);font-weight:600;cursor:pointer')

/** Acción principal del formulario. */
export const btnPrimario = { ...base, ...sx('border:none;background:var(--primary);color:var(--on-primary);font-size:var(--fs-md)') }

/** Acción secundaria (Cancelar). Sin fondo, apoyado en el borde. */
export const btnSecundario = { ...base, ...sx('border:1px solid var(--line2);background:transparent;color:var(--muted);font-size:var(--fs-sm)') }

/**
 * Estado deshabilitado. Se aplica ENCIMA del anterior: `{...btnPrimario, ...(saving ? apagado : null)}`.
 * Antes los botones deshabilitados solo cambiaban el texto ("Guardando…") y
 * seguían con el fondo primario y `cursor:pointer` — se veían clickeables.
 */
export const apagado = { opacity: 0.55, cursor: 'not-allowed' }
