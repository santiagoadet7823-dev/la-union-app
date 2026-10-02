import { useId } from 'react'
import { sx } from '../../lib/sx'
import { ChevronRight } from '../icons'
import { pintarIcono } from './icono'

/**
 * LISTA AGRUPADA (01/10/2026). Brief v2 §2.9 y §3.12; hojas "Cuenta y Navegación" (4a/4b,
 * Gestión agrupada) y "Ficha de Persona" (6b/6d: Asignaciones · Teléfono · Cuenta).
 *
 * Es la forma del menú de cuenta único, de Gestión (Operación / Equipo / Sistema) y de las
 * secciones de la ficha. Hoy cada una de esas pantallas arma sus filas a mano (`acctItem` de
 * SupervisionMovil, las filas de MiCuenta, `FilaTabla` de admin en móvil…).
 *
 * Uso:
 *   <GrupoLista titulo="Operación">
 *     <FilaLista icono={<GestIcon k="pedidos" />} etiqueta="Pedidos" valor="12" valorMono onClick={…} />
 *     <FilaLista etiqueta="Eliminar persona" detalle="Borra su acceso; los pedidos quedan" destructiva onClick={…} />
 *   </GrupoLista>
 * Varios grupos seguidos van en una columna con `gap: var(--sp-6)` (24 px entre grupos, §2.9);
 * el grupo no pone margen propio para no sumar aire donde el contenedor ya lo da.
 */

/**
 * Props:
 *   - titulo     rótulo del grupo, en Title case (no mayúsculas: §1.2). Opcional.
 *   - extra      nodo a la derecha del rótulo (p. ej. la cantidad: "Vendedores · 4").
 *   - children   las FilaLista
 *   - style      va a la <section>
 */
export function GrupoLista({ titulo, extra, children, style }) {
  const id = useId()
  return (
    <section aria-labelledby={titulo ? id : undefined} style={{ ...sx('display:flex;flex-direction:column;gap:var(--sp-2);min-width:0'), ...style }}>
      {(titulo || extra != null) && (
        <div style={sx('display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-2);padding:0 4px;font-size:var(--fs-xs);color:var(--muted);line-height:1.3')}>
          {titulo && <span id={id}>{titulo}</span>}
          {extra != null && <span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>{extra}</span>}
        </div>
      )}
      {/* `flex:none` por la misma trampa que TiraContadores: overflow + columna flex = alto mínimo 0. */}
      <div style={sx('flex:none;border-radius:var(--r-md);border:1px solid var(--line);background:var(--surface);overflow:hidden')}>
        {children}
      </div>
    </section>
  )
}

/**
 * Una fila. Es <button> con `onClick`, <a> con `href` y <div> sin ninguno de los dos (fila de
 * solo lectura: "Zona · Centro"). Nunca un <div onClick>: sin foco, sin rol y TalkBack no la lee
 * (brief §4.1, eran 51 en la app).
 *
 * Mide `min-height` 48 px (3 rem), nunca `height`: con letra grande la fila crece y la etiqueta
 * parte en dos líneas en vez de cortarse (§4.5 regla 3).
 *
 * Props:
 *   - etiqueta      texto principal (14 px, 500)
 *   - detalle       segunda línea opcional (12 px, --muted): "Efectivo desde 02/09"
 *   - valor         a la derecha, --muted: "Centro", "12", "Activa"
 *   - valorMono     bool: el valor en mono tabular (números, códigos: "V-014", "62 %")
 *   - icono         componente de icons.jsx o elemento; va en un cuadrado --surface2 de 32 px
 *   - extremo       nodo a la derecha en lugar del valor (un interruptor, una PildoraEstado).
 *                   ⚠️ Si el `extremo` es INTERACTIVO (un interruptor, un botón), la fila va SIN
 *                   `onClick`/`href`: un control dentro de un <button> o <a> es HTML inválido,
 *                   TalkBack lee las dos cosas como una sola y el toque dispara las dos. La fila
 *                   queda como <div> y el control es el único tocable (que mida ≥ 44).
 *   - chevron       bool; por defecto, sí cuando la fila navega (onClick/href) y no es destructiva
 *   - destructiva   bool: texto e ícono en --danger, 600, sin chevron (acciones que no llevan a
 *                   otra pantalla sino que HACEN algo: "Cerrar sesión", "Desactivar cuenta")
 *   - deshabilitada bool (solo <button>)
 *   - actual        bool: la fila es la pantalla abierta (panel de Gestión del escritorio, 02/10/2026).
 *                   `aria-current="page"`, fondo --primary-tint, etiqueta en 600 e ícono en --primary:
 *                   el peso y el cuadrado del ícono también cambian, no solo el tono.
 *   - onClick, href, title, style
 *   - ariaLabel     solo se aplica si la fila es <button> o <a>
 */
export function FilaLista({ etiqueta, detalle, valor, valorMono = false, icono, extremo, chevron, destructiva = false, deshabilitada = false, actual = false, onClick, href, ariaLabel, title, style }) {
  const navega = !!(onClick || href)
  const conChevron = chevron ?? (navega && !destructiva)
  const tinta = destructiva ? 'var(--danger)' : 'var(--text)'

  const Tag = href ? 'a' : onClick ? 'button' : 'div'
  const props = href
    ? { href, onClick }
    : onClick ? { type: 'button', onClick, disabled: deshabilitada } : {}

  return (
    <Tag
      {...props}
      className="lu-fila"
      // Solo en <button>/<a>: en un <div> sin rol, `aria-label` no se lee (y pisaría el texto).
      aria-label={Tag === 'div' ? undefined : ariaLabel}
      aria-current={actual && Tag !== 'div' ? 'page' : undefined}
      title={title}
      style={{
        ...sx('display:flex;align-items:center;gap:var(--sp-3);width:100%;min-height:var(--row-h, 3rem);padding:var(--sp-2) var(--sp-3);margin:0;border:0;background:transparent;font-family:inherit;text-align:left;text-decoration:none;-webkit-tap-highlight-color:transparent'),
        color: tinta,
        ...(actual ? { background: 'var(--primary-tint)' } : null),
        cursor: navega && !deshabilitada ? 'pointer' : undefined,
        // Sangría del separador de arriba (ui.css): alineado con el texto, no con el borde.
        '--sep-izq': icono ? 'calc(2 * var(--sp-3) + 32px)' : 'var(--sp-3)',
        ...style,
      }}
    >
      {icono && (
        <span aria-hidden="true" style={{ ...sx('flex:none;width:32px;height:32px;border-radius:var(--r-sm);display:grid;place-items:center'), background: actual ? 'var(--surface)' : 'var(--surface2)', color: destructiva ? 'var(--danger)' : actual ? 'var(--primary)' : 'var(--muted)' }}>
          {pintarIcono(icono, 18)}
        </span>
      )}
      <span style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:2px')}>
        <span style={{ ...sx('font-size:var(--fs-md);line-height:1.3;overflow-wrap:break-word'), fontWeight: destructiva || actual ? 600 : 500 }}>{etiqueta}</span>
        {detalle && <span style={sx('font-size:var(--fs-xs);line-height:1.3;color:var(--muted);overflow-wrap:break-word')}>{detalle}</span>}
      </span>
      {extremo ?? (valor != null && valor !== '' && (
        <span style={{ ...sx('flex:none;max-width:45%;font-size:var(--fs-sm);color:var(--muted);text-align:right;overflow-wrap:break-word'), ...(valorMono ? sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums') : null) }}>{valor}</span>
      ))}
      {conChevron && <span aria-hidden="true" style={sx('flex:none;display:grid')}><ChevronRight size={18} color="var(--faint)" /></span>}
    </Tag>
  )
}
