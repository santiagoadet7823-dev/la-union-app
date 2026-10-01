/**
 * PRIMITIVOS DE UI (01/10/2026) — bloque C3 del rediseño (brief v2 §2.1 principio 5 y regla 31
 * de CLAUDE.md: un componente compartido vive en UN módulo, no copiado por pantalla).
 *
 *   import { Chip, PildoraEstado, Contador, GrupoLista, FilaLista, EstadoVacio, NavInferior } from '../components/ui'
 *
 * Los estilos van inline con `sx()`; lo que necesita pseudo-clases o media queries está en
 * `ui.css`, que se importa una sola vez desde main.jsx. El selector de tema (`Segmentado`) NO
 * está acá: es de otro bloque.
 */
export { default as Chip } from './Chip'
export { default as PildoraEstado } from './PildoraEstado'
export { Contador, TiraContadores } from './Contador'
export { GrupoLista, FilaLista } from './Lista'
export { default as EstadoVacio } from './EstadoVacio'
export { default as NavInferior } from './NavInferior'
export { useTecladoAbierto } from '../../hooks/useTecladoAbierto'
