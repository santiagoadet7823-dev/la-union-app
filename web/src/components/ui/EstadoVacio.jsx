import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { AlertaCirculo, Info, SinConexion } from '../icons'
import { pintarIcono } from './icono'

/**
 * ESTADOS DE UNA PANTALLA SIN CONTENIDO NORMAL (01/10/2026). Brief v2 §2.11 y hoja "Cuenta y
 * Navegación" (5a-5h). Un solo componente con cuatro variantes:
 *
 *   'vacio'        no hay nada que mostrar (5a "todavía no hay nadie", 5b "nada con ese filtro")
 *   'carga'        esqueleto con la FORMA de la lista que viene (5c); a los 8 s avisa (5d)
 *   'error'        banner en línea con causa y acción (5e red, 5f dato)
 *   'sinConexion'  chip persistente "Sin conexión · N pendientes" (5g/5h), para el header
 *
 * Reemplaza a `EmptyState` de features/admin/ui.jsx, al `Skeleton` de admin/usuarios/ui.jsx y a
 * los "Cargando…" sueltos; las pantallas se migran en otro bloque.
 *
 * Reglas que esto cumple y que no hay que romper al usarlo:
 * - Nunca un spinner solo a pantalla completa: la carga mantiene el alto del contenido (sin
 *   saltos cuando llega) y si tarda dice por qué.
 * - El error NO culpa al usuario y dice qué hacer. Cada causa tiene su forma: red = --warning
 *   ("no es tu culpa, no hay señal"), dato = --info (el servidor respondió algo raro), servidor =
 *   --danger. Los textos por defecto ya cumplen; si se pasan otros, que cumplan igual.
 * - "Sin conexión" se alimenta de las colas y de los errores de red REALES, no de
 *   `navigator.onLine` (regla 12: el WebView miente). Este componente no decide nada: pinta lo
 *   que le pasan.
 */

const CAUSAS = {
  red: {
    tinta: 'var(--warning)', fondo: 'var(--warning-tint)', Icono: SinConexion,
    titulo: 'No se pudo actualizar',
    texto: 'El teléfono no tiene señal. Cuando vuelva, tocá Reintentar.',
  },
  dato: {
    tinta: 'var(--info)', fondo: 'var(--info-tint)', Icono: Info,
    titulo: 'No pudimos leer los datos',
    texto: 'El servidor devolvió datos incompletos. Ya quedó registrado; podés volver a intentar.',
  },
  servidor: {
    tinta: 'var(--danger)', fondo: 'var(--danger-tint)', Icono: AlertaCirculo,
    titulo: 'Algo falló de nuestro lado',
    texto: 'No es nada que hayas hecho. Probá de nuevo en un momento.',
  },
}

const ESPERA_LENTA_MS = 8000

/* ── vacío ─────────────────────────────────────────────────────────────────────────────────── */
function Vacio({ icono, titulo, texto, accion, style }) {
  return (
    <div style={{ ...sx('flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-2);padding:var(--sp-6) var(--sp-4);text-align:center'), ...style }}>
      {icono && (
        <span aria-hidden="true" style={sx('width:3rem;height:3rem;border-radius:var(--r-pill);background:var(--surface2);color:var(--muted);display:grid;place-items:center')}>
          {pintarIcono(icono, 24)}
        </span>
      )}
      <span style={sx('font-size:var(--fs-lg);font-weight:600;line-height:1.25;margin-top:4px;color:var(--text)')}>{titulo}</span>
      {texto && <span style={sx('font-size:var(--fs-md);line-height:1.45;color:var(--muted);max-width:280px')}>{texto}</span>}
      {accion && (
        <button
          type="button"
          onClick={accion.onClick}
          className="lu-ui-btn"
          style={sx('margin-top:var(--sp-2);min-height:2.75rem;min-width:2.75rem;padding:0 var(--sp-4);border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface);color:var(--text);font-family:inherit;font-size:var(--fs-md);font-weight:600;display:flex;align-items:center;gap:var(--sp-2);cursor:pointer')}
        >
          {accion.icono && <span aria-hidden="true" style={sx('display:grid')}>{pintarIcono(accion.icono, 18)}</span>}
          <span>{accion.etiqueta}</span>
        </button>
      )}
    </div>
  )
}

/* ── carga ─────────────────────────────────────────────────────────────────────────────────── */
// Anchos de las barras de cada fila: distintos a propósito, para que se lea como una lista y no
// como un bloque gris. Son los de la hoja 5c.
const ANCHOS = [['62%', '38%'], ['48%', '44%'], ['70%', '30%'], ['55%', '40%'], ['44%', '34%']]

function Carga({ filas = 5, avatar = true, lento, textoLento = 'Cargando… la señal está lenta', etiqueta = 'Cargando', style }) {
  const [tarde, setTarde] = useState(false)
  // 🩸 REGIÓN VIVA (01/10/2026, revisión). Un `role="status"` que NACE con su texto no se anuncia:
  // TalkBack solo lee los CAMBIOS de una región que ya estaba en el árbol. Por eso la región se
  // monta vacía y el texto llega un render después ("Cargando equipo…", oculto a la vista), y a
  // los 8 s cambia a `textoLento`, que sí se ve. Antes eran un `status` con solo `aria-label` (no
  // se lee como anuncio) y otro que aparecía ya con el texto: ninguno de los dos se anunciaba.
  const [montada, setMontada] = useState(false)
  useEffect(() => { setMontada(true) }, [])
  useEffect(() => {
    if (lento !== undefined) return undefined
    const t = setTimeout(() => setTarde(true), ESPERA_LENTA_MS)
    return () => clearTimeout(t)
  }, [lento])
  const mostrarLento = montada && (lento ?? tarde)

  return (
    // Sin `aria-busy` en este contenedor: un ancestro "ocupado" hace que algunos lectores esperen
    // a que termine para leer la región viva, que es justo lo que no queremos.
    <div style={{ ...sx('display:flex;flex-direction:column;gap:var(--sp-3)'), ...style }}>
      {/* El esqueleto es solo forma: no tiene nada que leer. */}
      <div aria-hidden="true" style={sx('flex:none;border-radius:var(--r-md);border:1px solid var(--line);background:var(--surface);overflow:hidden')}>
        {Array.from({ length: filas }, (_, i) => {
          const [w1, w2] = ANCHOS[i % ANCHOS.length]
          return (
            <div key={i} className="lu-fila" style={{ ...sx('display:flex;align-items:center;gap:var(--sp-3);min-height:3.75rem;padding:var(--sp-2) var(--sp-3)'), '--sep-izq': avatar ? 'calc(2 * var(--sp-3) + 40px)' : 'var(--sp-3)' }}>
              {avatar && <span className="lu-ui-sk" style={sx('flex:none;width:40px;height:40px;border-radius:var(--r-pill)')} />}
              <span style={sx('flex:1;display:flex;flex-direction:column;gap:6px')}>
                <span className="lu-ui-sk" style={{ ...sx('height:12px;border-radius:6px'), width: w1 }} />
                <span className="lu-ui-sk" style={{ ...sx('height:10px;border-radius:5px'), width: w2 }} />
              </span>
              <span className="lu-ui-sk" style={sx('flex:none;width:40px;height:12px;border-radius:6px')} />
            </div>
          )
        })}
      </div>
      <div role="status" style={sx('font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--muted);text-align:center')}>
        {mostrarLento ? textoLento : montada ? <span className="lu-ui-oculto">{etiqueta}…</span> : null}
      </div>
    </div>
  )
}

/* ── error ─────────────────────────────────────────────────────────────────────────────────── */
function ErrorEnLinea({ causa = 'red', titulo, texto, onReintentar, etiquetaAccion = 'Reintentar', style }) {
  const c = CAUSAS[causa] || CAUSAS.red
  return (
    <div role="alert" style={{ ...sx('display:flex;gap:10px;padding:var(--sp-3);border-radius:var(--r-md);border-width:1px;border-style:solid'), background: c.fondo, borderColor: c.tinta, ...style }}>
      <span aria-hidden="true" style={{ ...sx('flex:none;display:grid;padding-top:1px'), color: c.tinta }}><c.Icono size={18} /></span>
      <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--sp-2)')}>
        <div style={sx('display:flex;flex-direction:column;gap:2px')}>
          <span style={sx('font-size:var(--fs-md);font-weight:600;line-height:1.3;color:var(--text)')}>{titulo || c.titulo}</span>
          <span style={sx('font-size:var(--fs-sm);line-height:1.4;color:var(--text)')}>{texto || c.texto}</span>
        </div>
        {onReintentar && (
          <button
            type="button"
            onClick={onReintentar}
            className="lu-ui-btn"
            style={{ ...sx('align-self:flex-start;min-height:2.75rem;min-width:2.75rem;padding:0 14px;border-radius:var(--r-md);border-width:1px;border-style:solid;background:transparent;font-family:inherit;font-size:var(--fs-md);font-weight:600;cursor:pointer'), borderColor: c.tinta, color: c.tinta }}
          >
            {etiquetaAccion}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── sin conexión ──────────────────────────────────────────────────────────────────────────── */
// Radio --r-lg (16) y no --r-pill: a 32 px de alto se ve igual de píldora, pero con la letra del
// sistema al doble el texto parte en varias líneas (sin `nowrap`, para no salirse del header) y
// una píldora de 999 sobre una caja alta queda un óvalo.
function ChipSinConexion({ pendientes = 0, style }) {
  const n = Number(pendientes) || 0
  const texto = n > 0 ? `Sin conexión · ${n} ${n === 1 ? 'pendiente' : 'pendientes'}` : 'Sin conexión'
  return (
    <span role="status" style={{ ...sx('display:inline-flex;align-items:center;gap:6px;min-height:2rem;padding:4px 10px;border-radius:var(--r-lg);background:var(--warning-tint);color:var(--warning);border:1px solid var(--warning);font-size:var(--fs-xs);font-weight:600;line-height:1.2'), ...style }}>
      <span aria-hidden="true" style={sx('display:grid;flex:none')}><SinConexion size={16} /></span>
      {texto}
    </span>
  )
}

/**
 * Props según `variante`:
 *   'vacio'        icono, titulo, texto, accion: { etiqueta, onClick, icono? }
 *                  (para "sin resultados" la acción es "Limpiar filtros")
 *   'carga'        filas (5), avatar (true), lento (bool; si no se pasa, se activa solo a los
 *                  8 s), textoLento, etiqueta (lo que anuncia TalkBack al empezar: "Cargando
 *                  equipo"; después anuncia `textoLento`)
 *   'error'        causa: 'red' | 'dato' | 'servidor' (defecto 'red'), titulo, texto (tienen
 *                  defaults por causa), onReintentar, etiquetaAccion ('Reintentar')
 *   'sinConexion'  pendientes (número; 0 = solo "Sin conexión")
 *   todas          style
 */
export default function EstadoVacio({ variante = 'vacio', ...props }) {
  if (variante === 'carga') return <Carga {...props} />
  if (variante === 'error') return <ErrorEnLinea {...props} />
  if (variante === 'sinConexion') return <ChipSinConexion {...props} />
  return <Vacio {...props} />
}
