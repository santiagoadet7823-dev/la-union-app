import { useEffect, useId, useRef, useState } from 'react'
import { sx } from '../lib/sx'
import { useTheme } from '../context/ThemeContext'
import { Contraste, Moon, Sun } from './icons'

/**
 * SELECTOR DE TEMA: Claro · Oscuro · Automático (01/10/2026, brief estético v2 §5.6; hoja del
 * diseñador "Cuenta y Navegacion", sección SelectorTema 2a-2e, e "Ingreso" para la de íconos).
 *
 * Reemplaza a `ThemeToggle.jsx` (dos `div onClick` sin rol ni foco, de 38 px y 2 estados) y a los
 * botones sueltos de Login y Pendiente. Un solo módulo para todos los montajes (regla 31 del
 * CLAUDE.md: lo que se muestra igual no se copia).
 *
 * Variantes:
 *   - `completo`: 3 columnas con ícono arriba y rótulo abajo, más una línea de ayuda que dice qué
 *     hace la opción marcada ("Sigue el modo del teléfono · ahora: oscuro"). Menú de cuenta.
 *   - `iconos`: 3 botones de 44×44 solo con ícono (`aria-label` con el nombre). Login y Pendiente.
 *
 * Accesibilidad: `radiogroup` + `radio` con `aria-checked` y foco itinerante (solo la opción marcada
 * entra con Tab); ← → ↑ ↓ mueven Y marcan, Inicio/Fin van a los extremos; Espacio/Enter los da el
 * `<button>`. Cuando el tema cambia SOLO (Automático y el teléfono pasó de modo) se anuncia por
 * `aria-live` sin robar el foco. Cada opción mide 44×44 o más.
 *
 * ⚠️ Chrome 79 (la tablet arranca en `LoginView`): nada de `gap` en flex, `dvh` ni `inset`. La
 * variante de íconos separa con `--gx` (`index.css`); la completa es GRID, donde `gap` sí anda.
 * Sin hex: solo tokens. El borde de la opción marcada es `--line2` en Oscuro (ahí `--shadow` es
 * `none` y el borde sostiene la elevación) y transparente en Claro, como `--seg-brd` de la hoja.
 */

const OPCIONES = [
  { id: 'light', rotulo: 'Claro', Icono: Sun },
  { id: 'dark', rotulo: 'Oscuro', Icono: Moon },
  { id: 'auto', rotulo: 'Automático', Icono: Contraste },
]

function ayuda(preferencia, sistemaOscuro) {
  if (preferencia === 'auto') return `Sigue el modo del teléfono · ahora: ${sistemaOscuro ? 'oscuro' : 'claro'}`
  if (preferencia === 'dark') return 'Oscuro fijo. No cambia con el teléfono.'
  return 'Claro fijo. Es el tema por defecto.'
}

export default function SelectorTema({ variante = 'completo' }) {
  const { preferencia, setPreferencia, theme, isDark, sistemaOscuro, autoDisponible } = useTheme()
  const refs = useRef([])
  const idAyuda = useId()
  const iconos = variante === 'iconos'

  // Aviso para el lector de pantalla SOLO cuando el tema cambió sin que nadie tocara el selector:
  // seguía en Automático antes y después, y el teléfono cambió de modo.
  const [aviso, setAviso] = useState('')
  const previo = useRef({ theme, preferencia })
  useEffect(() => {
    const p = previo.current
    if (p.preferencia === 'auto' && preferencia === 'auto' && p.theme !== theme) {
      setAviso(`Tema ${theme === 'dark' ? 'oscuro' : 'claro'} activado (automático)`)
    }
    previo.current = { theme, preferencia }
  }, [theme, preferencia])
  // Se vacía a los pocos segundos: si quedara escrito, TalkBack podría leer un estado viejo al
  // recorrer la pantalla más tarde.
  useEffect(() => {
    if (!aviso) return undefined
    const t = setTimeout(() => setAviso(''), 4000)
    return () => clearTimeout(t)
  }, [aviso])

  const habilitada = (o) => o.id !== 'auto' || autoDisponible

  function elegir(i) {
    const o = OPCIONES[i]
    if (!habilitada(o)) return
    setPreferencia(o.id)
    if (refs.current[i]) refs.current[i].focus()
  }

  function alTeclear(e, i) {
    const n = OPCIONES.length
    let paso = 0
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') paso = 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') paso = -1
    else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const orden = e.key === 'Home' ? [0, 1, 2] : [2, 1, 0]
      const j = orden.find((k) => habilitada(OPCIONES[k]))
      if (j !== undefined) elegir(j)
      return
    } else return
    e.preventDefault()
    // Salta la opción deshabilitada (Automático en un equipo que no informa su modo).
    let j = i
    for (let k = 0; k < n; k++) {
      j = (j + paso + n) % n
      if (habilitada(OPCIONES[j])) break
    }
    elegir(j)
  }

  // Un `auto` guardado en un equipo que no informa su modo se pinta Claro: se marca Claro (hoja 2d).
  const efectiva = preferencia === 'auto' && !autoDisponible ? 'light' : preferencia
  const marcada = OPCIONES.findIndex((o) => o.id === efectiva)

  const grupo = iconos
    ? { ...sx('display:flex;padding:4px;border-radius:var(--r-md);background:var(--surface2)'), '--gx': '4px' }
    : sx('display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:4px;border-radius:var(--r-md);background:var(--surface2)')

  return (
    <div>
      <div role="radiogroup" aria-label="Tema" aria-describedby={iconos ? undefined : idAyuda} style={grupo}>
        {OPCIONES.map((o, i) => {
          const on = i === marcada
          const ok = habilitada(o)
          const { Icono } = o
          // Sin rótulo visible, el "deshabilitado" tiene que ir en el nombre: la opacidad sola no
          // la lee nadie.
          const nombre = ok ? o.rotulo : `${o.rotulo} (no disponible en este dispositivo)`
          return (
            <button
              key={o.id}
              ref={(el) => { refs.current[i] = el }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={ok ? undefined : true}
              aria-label={iconos ? nombre : undefined}
              title={iconos ? nombre : undefined}
              tabIndex={on || (marcada === -1 && i === 0) ? 0 : -1}
              onClick={() => elegir(i)}
              onKeyDown={(e) => alTeclear(e, i)}
              className="lu-press"
              style={{
                ...(iconos
                  ? sx('width:44px;height:44px;flex:none;display:grid;place-items:center;padding:0')
                  : sx('min-height:3.5rem;min-width:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 4px;text-align:center')),
                ...sx('box-sizing:border-box;border-radius:var(--r-sm);font-family:inherit;font-size:var(--fs-xs);line-height:1.2'),
                background: on ? 'var(--surface)' : 'transparent',
                color: on ? 'var(--text)' : 'var(--muted)',
                fontWeight: on ? 600 : 500,
                boxShadow: on ? 'var(--shadow)' : 'none',
                border: `1px solid ${on && isDark ? 'var(--line2)' : 'transparent'}`,
                opacity: ok ? 1 : 0.5,
                cursor: ok ? 'pointer' : 'not-allowed',
              }}
            >
              <span aria-hidden="true" style={sx('display:grid')}><Icono size={20} /></span>
              {!iconos && <span style={sx('margin-top:4px')}>{o.rotulo}</span>}
            </button>
          )
        })}
      </div>
      {!iconos && (
        <div id={idAyuda} style={sx('margin-top:8px;font-size:var(--fs-xs);color:var(--muted);line-height:1.4')}>
          {autoDisponible
            ? ayuda(preferencia, sistemaOscuro)
            : 'Este dispositivo no informa su modo. Automático queda deshabilitado.'}
        </div>
      )}
      <div role="status" aria-live="polite" className="lu-sr">{aviso}</div>
    </div>
  )
}
