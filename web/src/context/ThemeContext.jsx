import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react'
import { aplicarTemaNativo } from '../services/nativeUI'
import { escucharTemaSistema, leerSistemaOscuroSync, sistemaInformaModo } from '../services/temaSistema'

/**
 * TEMA EN TRES MODOS: Claro · Oscuro · Automático (01/10/2026, brief estético v2 §5).
 *
 * Dos valores distintos que antes eran uno solo:
 *   - `preferencia` ∈ light | dark | auto → lo que ELIGIÓ el usuario. Es lo único que se guarda.
 *   - `theme` ∈ light | dark → lo que se PINTA. Con `auto`, lo decide el teléfono en vivo
 *     (`services/temaSistema.js`). `data-theme` en <html> siempre lleva este (nunca `auto`): los
 *     tokens de `index.css` se enganchan de `html[data-theme='light'|'dark']`.
 *
 * 🩸 POR QUÉ SE REHIZO. Hasta 1.44 el efecto guardaba SIEMPRE el tema, también el que venía de leer
 * el sistema una vez en el primer arranque: una lectura del SO quedaba grabada como si fuera una
 * elección, y no había forma de distinguir "lo eligió" de "salió así". Ahora **solo
 * `setPreferencia` persiste** (un único punto de escritura de `launion-theme`), nunca un efecto.
 *
 * Decisiones del dueño (30/09/2026, tabla del brief):
 *   - 1: primer arranque → **Claro fijo** (`MODO_POR_DEFECTO`; pasarlo a `auto` es cambiar una línea,
 *        acá Y en el script de `index.html`).
 *   - 2: **reset único a Claro** de los temas ya guardados: como el código viejo guardaba siempre, un
 *        `dark` guardado no prueba que alguien lo haya elegido. La marca `launion-theme-v2` dice que
 *        el reset ya se hizo; desde ahí, lo guardado se respeta.
 *   - 11: Automático **solo sigue al teléfono** (sin horario propio de la app).
 *
 * ⚠️ LA MISMA REGLA VIVE EN TRES RUNTIMES (riesgo R5 del brief): el script inline de `index.html`
 * (resuelve antes del primer pintado y hace también el reset), este contexto y, cuando llegue, el
 * plugin nativo. Si se cambia la clave, la marca o el default, se cambia en los tres.
 */

const CLAVE = 'launion-theme'
const CLAVE_MIGRACION = 'launion-theme-v2'
export const MODO_POR_DEFECTO = 'light'
const esModo = (v) => v === 'light' || v === 'dark' || v === 'auto'
const resolver = (preferencia, sistemaOscuro) => (preferencia === 'auto' ? (sistemaOscuro ? 'dark' : 'light') : preferencia)

const ThemeContext = createContext(null)

/** Lee la preferencia guardada. Hace el reset único (decisión 2) si el script de `index.html` no lo
 * hizo ya (es idempotente: la marca se escribe una sola vez). Con `localStorage` bloqueado, default. */
function leerPreferencia() {
  try {
    let guardado = localStorage.getItem(CLAVE)
    if (localStorage.getItem(CLAVE_MIGRACION) === null) {
      if (guardado !== null) localStorage.setItem(CLAVE, MODO_POR_DEFECTO)
      localStorage.setItem(CLAVE_MIGRACION, '1')
      guardado = null
    }
    return esModo(guardado) ? guardado : MODO_POR_DEFECTO
  } catch (_) {
    return MODO_POR_DEFECTO
  }
}

/** `data-theme` (resuelto), `data-theme-mode` (preferencia), `theme-color` y barra de estado de la APK. */
function aplicarAlDOM(theme, preferencia) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.setAttribute('data-theme-mode', preferencia)
  // Best-effort, no se espera: en la APK repinta la barra de estado; en web solo toca el <meta>.
  aplicarTemaNativo(theme)
}

export function ThemeProvider({ children }) {
  const [preferencia, setPreferenciaEstado] = useState(leerPreferencia)
  const [autoDisponible] = useState(sistemaInformaModo)
  const [sistemaOscuro, setSistemaOscuro] = useState(leerSistemaOscuroSync)
  // Sin `prefers-color-scheme` no hay a quién seguir: `auto` guardado se pinta Claro (brief §5.6).
  const theme = resolver(preferencia, autoDisponible && sistemaOscuro)

  /** ÚNICO lugar que escribe `launion-theme`. */
  const setPreferencia = useCallback((p) => {
    if (!esModo(p)) return
    setPreferenciaEstado(p)
    try { localStorage.setItem(CLAVE, p) } catch (_) { /* modo privado: queda en memoria */ }
  }, [])

  // Antes del pintado: así el atributo y el `theme-color` cambian en el mismo cuadro que el render.
  // `useTemaGrafico` además lo auto-aplica (los efectos de los hijos corren antes que los del padre).
  useLayoutEffect(() => { aplicarAlDOM(theme, preferencia) }, [theme, preferencia])

  // Las señales del teléfono se escuchan SOLO en Automático: con Claro u Oscuro fijo el sistema no
  // cambia nada y no tiene sentido despertar el JS. Al entrar en `auto` se relee al instante.
  useEffect(() => {
    if (preferencia !== 'auto' || !autoDisponible) return undefined
    setSistemaOscuro(leerSistemaOscuroSync())
    return escucharTemaSistema(setSistemaOscuro)
  }, [preferencia, autoDisponible])

  // Dos pestañas de la PWA de escritorio: la elección de una llega a la otra (brief §5.7 #7).
  useEffect(() => {
    const alGuardar = (e) => { if (e.key === CLAVE && esModo(e.newValue)) setPreferenciaEstado(e.newValue) }
    window.addEventListener('storage', alGuardar)
    return () => window.removeEventListener('storage', alGuardar)
  }, [])

  // API vieja, conservada para los consumidores de antes. `setTheme` y `toggleTheme` FIJAN un tema
  // (sacan de Automático); el selector usa `setPreferencia`.
  const setTheme = useCallback((t) => setPreferencia(typeof t === 'function' ? t(theme) : t), [setPreferencia, theme])
  const toggleTheme = useCallback(() => setPreferencia(theme === 'dark' ? 'light' : 'dark'), [setPreferencia, theme])

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', setTheme, toggleTheme, preferencia, setPreferencia, sistemaOscuro, autoDisponible }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>')
  return ctx
}
